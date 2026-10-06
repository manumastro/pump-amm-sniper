// Bonding in diretta: segue di continuo i token giovani in bonding su fomo e li mostra su una pagina locale
// (http://127.0.0.1:8787, scripts/fomo/bonding_live.html). Il segnale e' il ritmo: quanti utenti fomo entrano
// in un token appena nato (4/10: Agent Capital aveva 5 wallet fomo al minuto 6 a ~$9k, si e' graduato al minuto 19).
// Un solo processo con un solo Chrome sempre aperto (le chiamate a fomo passano da li') e chiamate in parallelo:
//   - liste 'filtered-bonding' (l'app), 'bonding' (nascosta), 'new' (i 500 piu' giovani), a ogni giro;
//   - holder fomo (topHolders, 20 token per chiamata): i token nati da < 3 ore e quelli gia' candidati a ogni giro,
//     gli altri ogni 2 minuti; la serie degli holder nel tempo da' il ritmo (holder entrati negli ultimi 5 minuti);
//   - in sottofondo, per i candidati (almeno MIN_H holder fomo): tesi, feed (primo ingresso di ogni holder),
//     classifica degli holder nuovi; prima i token col ritmo piu' alto.
// Ogni token porta 'segnali' (holder: >=5 holder fomo in 5 min; tesi: >=2 tesi fomo o callout Axiom nuovi in 10 min;
// bravi: un bravo fomo fra holder o tesi, un KOL GMGN o un caller Axiom affidabile fra i callout;
// x: >=2 post su X non spam/promo in 10 min o uno di un account con >=10k follower in 30 min (da Axiom); bravi: un bravo fra
// holder o tesi; soldi: >=$300 entrati dagli utenti fomo in 5 min) e 'runner' (nato da < 6 ore con almeno 2 segnali,
// o da < 30 minuti col segnale holder): la sezione "Potenziali runner" della pagina.
// Ogni token porta 'prop' (si/forse/no): tradabile sulla prop firm della persona (mint in pump/bonk/bags/brrr).
// Solo lettura, nessuno swap.
// Uso: FOMO_TOKEN_FILE=~/.config/fomo-mcp/token nohup node scripts/fomo/bonding_live.mjs >> dati/fomo/tesi/live/live.log 2>&1 &
// Variabili: PORTA (8787), MIN_H (5), MAX_ORE (48), IN_VOLO (4 chiamate a fomo insieme).
//   -> dati/fomo/tesi/live/stato.json (letto dalla pagina e da bonding_tabella.py), storia.jsonl (holder dei candidati
//      nel tempo, una riga per token al minuto o quando cambiano), live.log.
import fs from 'fs'; import os from 'os'; import http from 'http'; import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url'; import { createRequire } from 'module';
const { FomoClient } = await import(pathToFileURL(path.join(os.homedir(), 'fomo-mcp', 'dist', 'client.js')).href);  // URL file:// anche su Windows
const QUI = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(QUI, '../../dati/fomo/tesi/live'); fs.mkdirSync(DIR, { recursive: true });
const CLASS = path.join(QUI, '../../dati/fomo/tesi/oneshot/classifica_autori.json'); fs.mkdirSync(path.dirname(CLASS), { recursive: true });  // su un PC nuovo dati/ e' vuota
const STATO = path.join(DIR, 'stato.json'), STORIA = path.join(DIR, 'storia.jsonl'), PAGINA = path.join(QUI, 'bonding_live.html');
const PORTA = +(process.env.PORTA || 8787), MIN_H = +(process.env.MIN_H || 5), MAX_ORE = +(process.env.MAX_ORE || 48);
const GIOVANE = 3 * 3600, PARALLELO = 6;
const C = new FomoClient('x'), SOLN = 1399811149;
const { curve } = createRequire(import.meta.url)('./curve.js');
const leggi = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const adesso = () => Date.now() / 1000, iso = () => new Date().toISOString();
const log = m => console.error(iso() + ' ' + m);
const R = leggi(CLASS, {});
const bravo = u => (R[u]?.pos30 ?? 1e9) <= 1000 && (R[u]?.m30 ?? 0) > 0;
const T = new Map();                       // tutti i token visti nelle liste
const S = { avvio: iso(), giri: 0, richieste: 0, err429: 0, errore: null, usciti: [] };
let solUsd = 120;

// al massimo IN_VOLO chiamate a fomo insieme (giro e dettagli in tutto); un 429 si ritenta dopo una pausa
const IN_VOLO = +(process.env.IN_VOLO || 4); let inVolo = 0; const attesa = [];
const pausa = ms => new Promise(r => setTimeout(r, ms));
async function chiama(f) {
  while (inVolo >= IN_VOLO) await new Promise(r => attesa.push(r));
  inVolo++;
  try {
    for (let prova = 0; ; prova++) {
      S.richieste++;
      try { return await f(); }
      catch (e) {
        if (e.name === 'NeedsReauth') S.errore = 'login fomo scaduto: rifare il login nel browser';
        if (!/429/.test(e.message) || prova >= 2) throw e;
        S.err429++; await pausa(1500 * (prova + 1));
      }
    }
  } finally { inVolo--; attesa.shift()?.(); }
}
async function inParallelo(lavori, n = PARALLELO) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < lavori.length) { const k = i++; try { out[k] = await lavori[k](); } catch (e) { out[k] = null; } } }));
  return out;
}
const aGruppi = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const vivo = (t, ora) => !t.uscito && t.nato && ora - t.nato <= MAX_ORE * 3600;
const candidati = () => { const ora = adesso(); return [...T.values()].filter(t => vivo(t, ora) && (t.holder_fomo ?? 0) >= MIN_H); };

// 1) le tre liste
async function liste() {
  const lavori = [];
  for (const [v, fino] of [['filtered-bonding', 200], ['bonding', 500], ['new', 500]])
    for (let off = 0; off < fino; off += 100) lavori.push(async () => ({ v, L: await chiama(() => C.discoverTokens(v, ['solana:solana'], 100, off)) }));
  const ora = adesso(); let letti = 0;
  for (const r of await inParallelo(lavori)) if (r) for (const k of r.L || []) {
    letti++;
    let t = T.get(k.address);
    if (!t) { const nato = Date.parse(k.created_at || k.createdAt || '') / 1000 || null; t = { tok: k.address, nato, serie: [] }; T.set(k.address, t); }
    Object.assign(t, { sym: k.symbol, nome: k.name, mcap: +(k.marketCap ?? k.market_cap ?? 0), liq: +(k.liquidity ?? 0), holder_catena: +(k.holdersCount ?? 0), in_lista: ora });
    const c = +k.bondingPercentage; if (c > 0 || !t.curva_da) { t.curva = c; t.curva_da = null; }
    if (r.v === 'filtered-bonding') t.in_app = ora;
  }
  return letti;
}
// 2) holder fomo: i giovani e i candidati a ogni giro, gli altri ogni 2 minuti
async function holder() {
  const ora = adesso();
  const da = [...T.values()].filter(t => vivo(t, ora) && ora - t.in_lista < 600
    && (ora - t.nato < GIOVANE || (t.holder_fomo ?? 0) >= MIN_H || !t.holder_t || ora - t.holder_t > 120));
  await inParallelo(aGruppi(da, 20).map(g => async () => {
    const H = await chiama(() => C.topHolders(g.map(t => ({ address: t.tok, networkId: SOLN }))));
    const t1 = adesso();
    for (const h of H || []) {
      const t = T.get(h.tokenAddress); if (!t) continue;
      t.holder_fomo = h.totalHolders ?? h.topHolders?.length ?? 0;
      t.valore_fomo = Math.round((h.topHolders || []).reduce((s, x) => s + (x.value || 0), 0));
      t.chi = (h.topHolders || []).map(x => ({ u: x.user?.userHandle, uid: x.user?.id, val: Math.round(x.value || 0), costo: Math.round(x.costBasis || 0), pnl: Math.round(x.pnl || 0), mc_ingresso: x.averageEntryPrice ? Math.round(x.averageEntryPrice * 1e9) : null }));
      const u = t.serie.at(-1);
      if (!u || u[1] !== t.holder_fomo || t1 - u[0] > 60) t.serie.push([Math.round(t1), t.holder_fomo, t.valore_fomo]);
      while (t.serie.length > 2 && t1 - t.serie[0][0] > 3 * 3600) t.serie.shift();
      if (t.holder_fomo >= MIN_H && (!t.storia_t || t1 - t.storia_t > 60 || u?.[1] !== t.holder_fomo)) {
        t.storia_t = t1;
        fs.appendFileSync(STORIA, JSON.stringify({ q: Math.round(t1), tok: t.tok, sym: t.sym, eta_min: Math.round((t1 - t.nato) / 60), curva: +(+t.curva || 0).toFixed(1), mcap: Math.round(t.mcap), holder_fomo: t.holder_fomo, valore_fomo: t.valore_fomo }) + '\n');
      }
    }
    for (const t of g) t.holder_t = t1;
  }));
  return da.length;
}
// 3) curva sulla catena per i candidati a cui fomo da' 0% (ogni 2 minuti per token)
async function curveZero() {
  const ora = adesso();
  const z = candidati().filter(t => !(t.curva > 0 && !t.curva_da) && (!t.curva_q || ora - t.curva_q > 120));
  if (!z.length) return;
  for (const t of z) t.curva_q = ora;
  try {
    for (const r of await curve(z.map(t => t.tok), { solUsd })) {
      const t = T.get(r.mint); if (!t) continue;
      if (r.percentuale_curva != null) { t.curva = +r.percentuale_curva; t.curva_da = 'catena'; }
      if (r.graduato || r.migrato) t.graduato = true;
    }
  } catch (e) { log('curve.js ' + e.message.slice(0, 100)); }
}
// ritmo: holder fomo entrati negli ultimi 5 minuti (un token nato da meno di 5 minuti parte da 0)
function ritmo(t, ora) {
  if ((ora - t.nato) / 60 <= 5) return { in5: t.holder_fomo, parziale: false };
  let base = null; for (const p of t.serie) if (p[0] <= ora - 300) base = p; else break;
  if (base) return { in5: t.holder_fomo - base[1], parziale: false };
  if (t.serie.length && ora - t.serie[0][0] >= 60) return { in5: t.holder_fomo - t.serie[0][1], parziale: true };
  return { in5: null, parziale: true };
}
// crescita negli ultimi `fin` secondi di una serie [[q, valore]]: un token piu' giovane di `fin` parte da 0;
// se la serie e' piu' corta, dal suo primo punto (parziale)
function crescita(serie, ora, nato, attuale, fin) {
  if (attuale == null) return { d: null, parziale: true };
  if (ora - nato <= fin) return { d: attuale, parziale: false };
  let base = null; for (const p of serie || []) if (p[0] <= ora - fin) base = p; else break;
  if (base) return { d: attuale - base[1], parziale: false };
  if (serie?.length && ora - serie[0][0] >= 60) return { d: attuale - serie[0][1], parziale: true };
  return { d: null, parziale: true };
}
// Axiom (letto dal browser loggato con avvia_axiom.js e mandato qui in POST /axiom): callout da tre fonti, tutti nella
// stessa forma (src axiom = callout Axiom, gmgn = callout GMGN con KOL e follower, pump = commenti pump.fun), e post su X
// che citano il contratto (Axiom li raccoglie anche da GMGN; 'spam' e 'promo' sono marcature di Axiom).
// Un commento pump.fun conta come callout solo se chi scrive tiene almeno $50 del token (i commenti sono tanti e rumorosi).
// "Bravo" fuori da fomo: KOL secondo GMGN, o caller Axiom con almeno 20 callout, win rate >= 55% e PnL realizzato positivo.
const conta = c => c.src !== 'pump' || (c.pos || 0) >= 50;
const bravoAx = c => (c.src === 'gmgn' && c.kol) || (c.src === 'axiom' && (c.ncall || 0) >= 20 && (c.wr || 0) >= 0.55 && (c.pnl_caller || 0) > 0);
function axiomCampi(t, ora) {
  const A = t.ax; if (!A) return { ax: false };
  const da = q => (ora - Date.parse(q) / 1000) / 60;
  const C = (A.callouts || []).filter(conta);
  const xs = (A.tweets || []).filter(w => !w.spam), veri = xs.filter(w => !w.promo);
  const fonti = {}; for (const c of A.callouts || []) fonti[c.src] = (fonti[c.src] || 0) + 1;
  return {
    ax: true, ax_eta_s: Math.round(ora - A.q), ax_fonti: fonti, ax_callout: C.length, ax_callout10: C.filter(c => da(c.t) <= 10).length,
    ax_bravi: [...new Set((A.callouts || []).filter(bravoAx).map(c => c.src + ':' + c.h))],
    ax_x: xs.length, ax_x10: veri.filter(w => da(w.t) <= 10).length,
    ax_x_grande: veri.some(w => da(w.t) <= 30 && (w.followers || 0) >= SOGLIE.x_grande),
    // per la pagina: prima i callout delle fonti piu' informative e di chi tiene, poi i piu' recenti
    ax_callouts: [...C].sort((a, b) => (bravoAx(b) - bravoAx(a)) || ((b.src !== 'pump') - (a.src !== 'pump')) || b.t.localeCompare(a.t)).slice(0, 12),
    ax_tweets: xs.sort((a, b) => (b.followers || 0) - (a.followers || 0)).slice(0, 8),
  };
}
// potenziale runner: quattro segnali accesi o spenti, in chiaro (soglie scelte a mano, da tarare con storia.jsonl)
const SOGLIE = { holder5: 5, tesi10: 2, soldi5: 300, x10: 2, x_grande: 10000 };
function segnali(x) {
  const s = [];
  if ((x.in5 ?? 0) >= SOGLIE.holder5) s.push('holder');
  if ((x.tesi10 ?? 0) + (x.ax_callout10 ?? 0) >= SOGLIE.tesi10) s.push('tesi');
  if (x.bravi_holder.length + x.bravi_tesi.length + (x.ax_bravi?.length || 0) > 0) s.push('bravi');
  if ((x.valore5 ?? 0) >= SOGLIE.soldi5) s.push('soldi');
  if ((x.ax_x10 ?? 0) >= SOGLIE.x10 || x.ax_x_grande) s.push('x');
  return s;
}
// uscite: graduati (curva 100 o migrati) e spariti dalle liste per 5 minuti (per questi si chiede a fomo se sono graduati)
async function uscite() {
  const ora = adesso();
  const spariti = candidati().filter(t => !t.graduato && t.curva < 100 && ora - t.in_lista > 300);
  for (const g of aGruppi(spariti, 20)) {
    const F = await chiama(() => C.filterTokens(g.map(t => t.tok + ':' + SOLN))).catch(() => []);
    for (const f of F || []) { const t = T.get(f?.token?.address); const lp = f?.token?.launchpad; if (t && lp && (lp.migrated || +lp.graduationPercent >= 100)) t.graduato = true; }
  }
  for (const t of candidati()) {
    const grad = t.graduato || t.curva >= 100;
    if (!grad && ora - t.in_lista <= 300) continue;
    t.uscito = grad ? 'graduato' : 'fuori dalle liste';
    S.usciti.unshift({ sym: t.sym, tok: t.tok, motivo: t.uscito, q: iso(), eta_min: Math.round((ora - t.nato) / 60), holder_fomo: t.holder_fomo, mcap: Math.round(t.mcap), curva: Math.round(t.curva || 0) });
    log(`${t.sym} ${t.uscito} (${Math.round((ora - t.nato) / 60)} min, ${t.holder_fomo} holder fomo)`);
  }
  S.usciti = S.usciti.filter(u => ora - Date.parse(u.q) / 1000 < 3600).slice(0, 30);
}

// 4) dettagli in sottofondo: tesi, primo ingresso dal feed, classifica degli holder nuovi
const curvaPump = mc => { if (!mc) return null; const X = Math.sqrt(32190000 / (mc / solUsd)); return Math.max(0, Math.min(100, Math.round((1073 - X) / 793.1 * 100))); };
const k = v => v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + v;
async function dettagli(t) {
  t.det_t = adesso(); t.det_h = t.holder_fomo;
  if (!t.lp) { const [f] = await chiama(() => C.filterTokens([t.tok + ':' + SOLN])).catch(() => []); t.lp = f?.token?.launchpad?.launchpadName || null; }
  const r = await chiama(() => C.tokenThesis(t.tok, SOLN, 50, 0)).catch(() => null);
  if (r) t.tesi = (r.items || []).map(x => ({ u: x.userHandle, uid: x.userId, mc: x.comment?.marketCapAtCreation, txt: String(x.comment?.comment || '').slice(0, 200) }));
  if (r) { const ts = (t.tesi_serie ||= []), n = t.tesi.length; if (!ts.length || ts.at(-1)[1] !== n || t.det_t - ts.at(-1)[0] > 120) ts.push([Math.round(t.det_t), n]); }
  const acq = {}; let lastId;
  for (let i = 0; i < 3; i++) {
    const f = await chiama(() => C.tokenFeed({ tokenAddress: t.tok, networkId: SOLN, limit: 100, threshold: 0, lastId })).catch(() => null);
    const it = f?.items || []; for (const x of it) if (x.type === 'swap_buy' && x.userHandle) (acq[x.userHandle] ||= []).push({ q: x.createdAt, mc: x.marketCap });
    if (it.length < 100) break; lastId = it.at(-1).id;
  }
  const nuovi = [...new Set([...(t.chi || []).map(x => x.uid), ...(t.tesi || []).map(x => x.uid)])].filter(u => u && !R[u]);
  await inParallelo(nuovi.map(u => async () => { const r = await chiama(() => C.getUserRank(u)); R[u] = { sempre: r?.rank?.pnl, m30: r?.rank30d?.pnl, g1: r?.rank24h?.pnl, pos30: r?.rank30d?.rank, letto: iso() }; }), 3);
  const pf = t.tok.endsWith('pump');
  for (const x of t.chi || []) {
    const a = (acq[x.u] || []).sort((p, q) => p.q.localeCompare(q.q))[0];
    if (a) { x.primo_mc = Math.round(a.mc); x.primo_q = a.q; }
    x.primo_curva = pf ? curvaPump(x.primo_mc) : null; x.curva_ingresso = pf ? curvaPump(x.mc_ingresso) : null;
  }
  t.ingressi = (t.chi || []).filter(x => x.primo_mc || x.mc_ingresso).sort((a, b) => (a.primo_mc || a.mc_ingresso) - (b.primo_mc || b.mc_ingresso))
    .map(x => `${x.u}${bravo(x.uid) ? '*' : ''} costo $${x.costo}: primo ${x.primo_mc ? k(x.primo_mc) + (x.primo_curva != null ? ' (' + x.primo_curva + '%)' : '') : '?'}, medio ${k(x.mc_ingresso || 0)}${x.curva_ingresso != null ? ' (' + x.curva_ingresso + '%)' : ''}`);
  t.primi_presto = (t.chi || []).filter(x => x.primo_curva != null && x.primo_curva <= 30).length;
}
(async () => {
  let salvaClass = 0;
  for (;;) {
    const ora = adesso();
    const coda = candidati().filter(t => !t.det_t || (t.holder_fomo !== t.det_h && ora - t.det_t > 45) || ora - t.det_t > (ora - t.nato < GIOVANE ? 90 : 300))
      .sort((a, b) => (ritmo(b, ora).in5 ?? 0) - (ritmo(a, ora).in5 ?? 0)).slice(0, 3);
    if (coda.length) await inParallelo(coda.map(t => () => dettagli(t)), 3);
    else await new Promise(r => setTimeout(r, 2000));
    if (ora - salvaClass > 60) { salvaClass = ora; fs.writeFileSync(CLASS, JSON.stringify(R)); }
  }
})();

// prop firm della persona: "Only pump/bonk/bags/brrr tokens are tradeable" = mint che finisce in pump, bonk, BAGS o brrr.
// 'forse' = sul programma di pump.fun ma con un mint senza 'pump' (es. agencypad): da verificare con la prop firm.
const prop = t => /(pump|bonk|bags|brrr)$/i.test(t.tok) ? 'si' : t.lp === 'Pump.fun' ? 'forse' : 'no';
// stato per la pagina
function scrivi(ciclo) {
  const ora = adesso();
  const dati = candidati().map(t => {
    const r = ritmo(t, ora), eta = (ora - t.nato) / 60;
    t.cand_da ||= S.giri <= 1 ? ora - 999 : ora;
    return {
      sym: t.sym, nome: t.nome, tok: t.tok, nell_app: !!t.in_app && ora - t.in_app < 120, eta_min: +eta.toFixed(1), ore: +(eta / 60).toFixed(1),
      curva: +(+t.curva || 0).toFixed(1), curva_da: t.curva_da, mcap: Math.round(t.mcap), liq: Math.round(t.liq), holder_catena: t.holder_catena,
      holder_fomo: t.holder_fomo, valore_fomo: t.valore_fomo, in5: r.in5, in5_parziale: r.parziale, al_min: +(t.holder_fomo / Math.max(eta, 1)).toFixed(2),
      serie: t.serie.filter(p => ora - p[0] <= 3600).map(p => [p[0], p[1]]), nuovo: ora - t.cand_da < 120,
      primi_presto: t.primi_presto ?? 0, bravi_holder: (t.chi || []).filter(x => bravo(x.uid)).map(x => `${x.u} ($${x.val})`),
      tesi: t.tesi || [], bravi_tesi: [...new Set((t.tesi || []).filter(x => bravo(x.uid)).map(x => x.u))], ingressi: t.ingressi || [],
      in_verde: (t.chi || []).filter(x => x.pnl > 0).length, dettagli: !!t.det_t, lp: t.lp || null, prop: prop(t),
      tesi10: crescita(t.tesi_serie, ora, t.nato, t.tesi?.length ?? null, 600).d,
      ...axiomCampi(t, ora),
      valore5: crescita(t.serie.map(p => [p[0], p[2]]), ora, t.nato, t.valore_fomo, 300).d,
    };
  });
  for (const x of dati) { x.segnali = segnali(x); x.runner = x.eta_min < 360 && (x.segnali.length >= 2 || (x.eta_min < 30 && x.segnali.includes('holder'))); }
  Object.assign(S, { soglie: SOGLIE, aggiornato: iso(), ciclo_s: ciclo, universo: [...T.values()].filter(t => vivo(t, ora) && ora - t.in_lista < 600).length, candidati: dati.length, criteri: { MIN_H, MAX_ORE }, sol_usd: solUsd, dati });
  fs.writeFileSync(STATO + '.tmp', JSON.stringify(S)); fs.renameSync(STATO + '.tmp', STATO);
}

// giro principale: liste e holder di continuo
(async () => {
  let solQ = 0;
  for (;;) {
    const t0 = Date.now();
    try {
      if (Date.now() - solQ > 300000) { solQ = Date.now(); const [s] = await chiama(() => C.filterTokens(['So11111111111111111111111111111111111111112:' + SOLN])).catch(() => []); if (+s?.priceUSD > 0) solUsd = +s.priceUSD; }
      const letti = await liste();
      if (!letti) S.errore ||= 'nessuna lista letta: login scaduto o API giu\'';
      else { S.errore = null; await holder(); await curveZero(); await uscite(); }
      S.giri++;
    } catch (e) { S.errore = e.message.slice(0, 200); log('giro: ' + e.message.slice(0, 200)); }
    const ciclo = +((Date.now() - t0) / 1000).toFixed(1);
    scrivi(ciclo);
    if (S.giri % 30 === 1) log(`giro ${S.giri}: ${ciclo} s, ${S.candidati} candidati su ${S.universo}, richieste ${S.richieste}, 429 ${S.err429}`);
    await pausa(S.errore ? 10000 : Math.max(0, 5000 - (Date.now() - t0)));  // un giro ogni 5 s al massimo
  }
})();

http.createServer((q, r) => {
  if (q.method === 'POST' && q.url.startsWith('/axiom')) {
    let b = ''; q.on('data', d => { b += d; if (b.length > 5e6) q.destroy(); });
    return q.on('end', () => {
      try { const J = JSON.parse(b); let n = 0; for (const [tok, v] of Object.entries(J.dati || {})) { const t = T.get(tok); if (t) { t.ax = { ...v, q: J.q || adesso() }; n++; } } S.axiom_q = iso(); S.axiom_ws = J.ws || null; r.writeHead(200); r.end(JSON.stringify({ ok: n })); }
      catch (e) { r.writeHead(400); r.end('{}'); }
    });
  }
  if (q.url.startsWith('/axiom-lista')) { const ora = adesso(); r.writeHead(200, { 'content-type': 'application/json' });
    // token da leggere su Axiom: i candidati tradabili nati da meno di 6 ore, prima i runner
    return r.end(JSON.stringify(candidati().filter(t => prop(t) !== 'no' && ora - t.nato < 6 * 3600).sort((a, b) => (ritmo(b, ora).in5 ?? 0) - (ritmo(a, ora).in5 ?? 0)).slice(0, 60).map(t => t.tok))); }
  if (q.url.startsWith('/stato.json')) { r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return r.end(fs.existsSync(STATO) ? fs.readFileSync(STATO) : '{}'); }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); r.end(fs.readFileSync(PAGINA));
}).listen(PORTA, '127.0.0.1', () => log(`pagina su http://127.0.0.1:${PORTA}`));
