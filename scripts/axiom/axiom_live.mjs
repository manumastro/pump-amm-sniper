// Demone Axiom per la pagina live (bonding_live.mjs), sul modello di fomo-mcp: un processo Node con un Chrome headless
// (playwright-core di ~/fomo-mcp, il Chrome installato) che fa solo letture REST ad Axiom con la sessione esportata dalla
// scheda in cui la persona ha fatto il login (scripts/axiom/avvia_sessione.js -> servi.py -> ~/.config/axiom/sessione).
// Niente WebSocket, nessun callout, voto o trade.
//  - callout Axiom: GET api8.axiom.trade/callouts-feed?v=2 (gli ultimi 200 callout Solana, ~2 ore), una chiamata ogni
//    minuto per tutti i token; si tengono quelli dei token della lista. I callout GMGN e i commenti pump.fun arrivavano
//    solo dal WebSocket: qui non ci sono.
//  - post su X che citano il contratto: GET api8.axiom.trade/x-tweets, un token alla volta (1,5 s fra l'uno e l'altro),
//    i primi 15 della lista, ogni 2 minuti; i token appena entrati in lista (quelli aperti nella pagina vanno in testa) subito.
//  - lista dei token: GET http://127.0.0.1:8787/axiom-lista ogni 30 s, al massimo AXIOM_MAX (default 10);
//    ogni 15 s i token cambiati (ogni 2 minuti tutti) vanno a POST /axiom nel formato di bonding_live ({q, ws:{stato}, dati:{tok:{callouts, tweets}}}).
// La sessione la rinnova solo la pagina di Axiom (il refresh token non esce dalla scheda): il demone rilegge il file quando
// cambia. Su 401/403 o "Session invalid" smette di chiamare Axiom e lo scrive nello stato finche' non arriva una sessione
// nuova; se il cookie d'accesso e' scaduto aspetta il rinnovo senza chiamare; su 429 si ferma e rallenta (intervalli
// raddoppiati). Le chiamate sono sempre una alla volta.
// Uso: node scripts/axiom/axiom_live.mjs >> dati/axiom/axiom.log 2>&1   (AXIOM_MAX=10 di default; uno solo alla volta)
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const { chromium } = await import(pathToFileURL(path.join(os.homedir(), 'fomo-mcp', 'node_modules', 'playwright-core', 'index.mjs')).href);

const QUI = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(QUI, '../../dati/axiom'); fs.mkdirSync(DIR, { recursive: true });
const STATO = path.join(DIR, 'stato.json');
const SESS = process.env.AXIOM_SESSIONE || path.join(os.homedir(), '.config', 'axiom', 'sessione');
const LIVE = 'http://127.0.0.1:8787', API = 'https://api8.axiom.trade';
const MAX = +(process.env.AXIOM_MAX || 10), X_TOK = 15;
const log = m => console.log(new Date().toISOString() + ' ' + m);
const dorme = ms => new Promise(r => setTimeout(r, ms));

const S = { avvio: new Date().toISOString(), stato: 'avvio', fermo: null, chiamate: 0, per_tipo: {}, n401: 0, n429: 0, altri_errori: 0,
  feed_ogni_s: 60, x_ogni_s: 120, token: 0, ultimo_feed: null, ultimo_x: null, ultimo_invio: null, sessione: null };
let pausaFino = 0, lista = [], sessMtime = 0, sessScade = 0;
const per = {}, xs = {}, sporchi = new Set();

// ---- sessione: dal file scritto da servi.py ----
const leggiSess = () => { try { return JSON.parse(fs.readFileSync(SESS, 'utf8')); } catch (e) { return null; } };
async function caricaSessione(ctx) {
  let st; try { st = fs.statSync(SESS); } catch (e) { return false; }
  if (st.mtimeMs === sessMtime) return true;
  const j = leggiSess(); if (!j || !Array.isArray(j.cookies)) return false;
  sessMtime = st.mtimeMs;
  await ctx.clearCookies();
  await ctx.addCookies(j.cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path || '/', expires: c.expires,
    httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite: c.sameSite || 'Lax' })));
  const acc = j.cookies.find(c => c.name === 'auth-access-token');
  sessScade = acc && acc.expires > 0 ? acc.expires : 0;
  S.sessione = { esportata: j.t, scade: sessScade ? new Date(sessScade * 1000).toISOString() : null, rinnovi_pagina: j.rinnovi || null };
  if (S.fermo && /^Axiom risponde/.test(S.fermo)) { S.fermo = null; log('sessione nuova: riparto'); }
  return true;
}

// ---- Chrome headless, come fomo-mcp; la pagina e' un guscio vuoto su https://axiom.trade/ (stessa origine dell'app,
// cosi' fetch manda i cookie e passa il CORS) senza caricare l'app di Axiom ----
let sess; while (!(sess = leggiSess())) { S.stato = 'in attesa della sessione (avvia_sessione.js)'; scriviStato(); await dorme(5000); }
const browser = await chromium.launch({ channel: 'chrome', headless: true, ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled', '--window-size=1920,1080'] });
browser.on('disconnected', () => { log('Chrome chiuso: esco'); process.exit(1); });
const ctx = await browser.newContext({ userAgent: sess.ua, viewport: { width: 1920, height: 1080 }, locale: 'en-US' });
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
await ctx.route('https://axiom.trade/', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>axiom_live</title>' }));
const page = await ctx.newPage();
await page.goto('https://axiom.trade/');
await caricaSessione(ctx);

// una chiamata GET ad Axiom dalla pagina; null se non si deve/puo' leggere
async function chiama(tipo, url) {
  if (S.fermo || Date.now() < pausaFino) return null;
  if (sessScade && sessScade - Date.now() / 1000 < 30) { S.stato = 'cookie d\'accesso scaduto: in attesa del rinnovo dalla scheda'; return null; }
  S.chiamate++; S.per_tipo[tipo] = (S.per_tipo[tipo] || 0) + 1;
  let r; try { r = await page.evaluate(async u => { const x = await fetch(u, { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } }); return { status: x.status, body: await x.text() }; }, url); }
  catch (e) { S.altri_errori++; return null; }
  if (r.status === 401 || r.status === 403 || r.body.includes('Session invalid')) {
    S.n401++; S.fermo = 'Axiom risponde ' + r.status + (r.body.includes('Session invalid') ? ' (Session invalid)' : '') + ': fermo, in attesa di una sessione nuova (login o avvia_sessione.js)';
    log(S.fermo + ' [' + tipo + ']'); return null;
  }
  if (r.status === 429) {
    S.n429++; const p = 60000 * 2 ** Math.min(S.n429 - 1, 4); pausaFino = Date.now() + p;
    S.x_ogni_s = Math.min(S.x_ogni_s * 2, 960); S.feed_ogni_s = Math.min(S.feed_ogni_s * 2, 480);
    log(`429 su ${tipo}: pausa ${p / 1000} s, feed ogni ${S.feed_ogni_s} s, X ogni ${S.x_ogni_s} s`); return null;
  }
  if (r.status < 200 || r.status >= 300) { S.altri_errori++; log(`${tipo}: ${r.status}`); return null; }
  try { return r.body ? JSON.parse(r.body) : null; } catch (e) { return null; }
}

// stessa forma dei callout di avvia_axiom.js (fonte axiom)
const norm = c => ({ id: c.id, src: 'axiom', t: c.createdAt, h: c.callerHandle || c.xHandle || '(anonimo)', body: String(c.body || '').slice(0, 200),
  mc: c.marketCapUsdAtPost != null ? Math.round(c.marketCapUsdAtPost) : null, pos: (c.verifiedHoldingUsd ?? c.holdingUsd) != null ? Math.round(c.verifiedHoldingUsd ?? c.holdingUsd) : null,
  picco: c.peakMultiple != null ? +(+c.peakMultiple).toFixed(2) : null, wr: c.caller?.winRate, ncall: c.caller?.calloutCount,
  pnl_caller: c.caller?.realizedPnlUsd, verified: !!c.caller?.verified, voti: (c.agreeCount || 0) - (c.disagreeCount || 0),
  x: c.xHandle || null, pnl: c.pnlUsd != null ? Math.round(c.pnlUsd) : null, venduto: !!c.soldAt });

async function leggiFeed() {
  const j = await chiama('callouts-feed', API + '/callouts-feed?v=2'); if (!Array.isArray(j)) return;
  for (const c of j) { const tok = c.tokenAddress; if (!tok || !c.id || c.chain !== 'sol') continue;
    const A = (per[tok] ||= {}); if (!A[c.id]) { A[c.id] = norm(c); if (lista.includes(tok)) sporchi.add(tok); } }
  S.ultimo_feed = new Date().toISOString();
}
// post su X: i primi X_TOK della lista ogni x_ogni_s; i token appena entrati in lista (es. aperti nella pagina, che
// bonding_live mette in testa) subito, sempre uno alla volta
const subito = new Set();
async function leggiX(quali = lista.slice(0, X_TOK)) {
  for (const tok of quali) { subito.delete(tok);
    const j = await chiama('x-tweets', API + '/x-tweets?tokenAddress=' + tok + '&limit=50&all=1');
    if (S.fermo || Date.now() < pausaFino) return;
    if (j) { xs[tok] = (j.tweets || []).map(w => ({ t: w.tweet?.createdAt, id: w.tweet?.id, handle: w.tweet?.author?.handle, followers: w.tweet?.author?.followers || 0,
      verified: w.tweet?.author?.verified || null, text: String(w.tweet?.text || '').slice(0, 200), spam: !!w.spam, promo: !!w.promo })); sporchi.add(tok); }
    await dorme(1500);
  }
  if (quali.length > 1) S.ultimo_x = new Date().toISOString();
}
async function aggiornaLista() {
  try { const l = (await (await fetch(LIVE + '/axiom-lista')).json()).slice(0, MAX);
    for (const t of l) if (!lista.includes(t)) { sporchi.add(t); if (lista.length) subito.add(t); }
    lista = l; S.token = l.length; } catch (e) {}
}
let tPieno = 0;
async function manda() {
  // ogni 2 minuti tutti i token della lista, cosi' una dashboard riavviata si riempie di nuovo
  if (Date.now() - tPieno >= 120000) { tPieno = Date.now(); for (const t of lista) sporchi.add(t); }
  const dati = {}; for (const tok of sporchi) if (lista.includes(tok))
    dati[tok] = { callouts: Object.values(per[tok] || {}).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 80), tweets: xs[tok] || [] };
  sporchi.clear();
  const stato = S.fermo ? 'fermo: ' + S.fermo : S.stato;
  try { await fetch(LIVE + '/axiom', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: Date.now() / 1000, ws: { stato, chiamate: S.chiamate, n429: S.n429, token: S.token, sessione: S.sessione }, dati }) });
    S.ultimo_invio = new Date().toISOString(); } catch (e) {}
}
function scriviStato() { try { fs.writeFileSync(STATO, JSON.stringify({ ...S, aggiornato: new Date().toISOString(), lista }, null, 1)); } catch (e) {} }

log(`avvio: max ${MAX} token, feed ogni ${S.feed_ogni_s} s, X ogni ${S.x_ogni_s} s, sessione da ${SESS}`);
let tLista = 0, tFeed = 0, tX = 0, tInvio = 0, tLog = 0;
for (;;) {
  const ora = Date.now();
  await caricaSessione(ctx).catch(() => {});
  if (!S.fermo && Date.now() >= pausaFino && !(sessScade && sessScade - ora / 1000 < 30)) S.stato = `REST ok (${S.token} token, feed ogni ${S.feed_ogni_s} s, X ogni ${S.x_ogni_s} s)`;
  else if (!S.fermo && Date.now() < pausaFino) S.stato = `pausa per 429 fino alle ${new Date(pausaFino).toISOString().slice(11, 19)}`;
  if (ora - tLista >= 30000) { tLista = ora; await aggiornaLista(); }
  if (ora - tFeed >= S.feed_ogni_s * 1000) { tFeed = ora; await leggiFeed(); }
  if (ora - tX >= S.x_ogni_s * 1000) { tX = ora; await leggiX(); }
  else if (subito.size) await leggiX([...subito].slice(0, 3));
  if (Date.now() - tInvio >= 15000) { tInvio = Date.now(); await manda(); scriviStato(); }
  if (Date.now() - tLog >= 300000) { tLog = Date.now(); log(`${S.fermo ? 'fermo: ' + S.fermo : S.stato}; chiamate ${S.chiamate}, 401/403 ${S.n401}, 429 ${S.n429}, altri ${S.altri_errori}; rinnovi pagina ${JSON.stringify(S.sessione?.rinnovi_pagina)}`); }
  await dorme(1000);
}
