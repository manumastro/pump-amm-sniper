// Tesi sui token in bonding (Solana): chi le scrive, quando, a che punto della curva, e se il token
// poi si gradua. Gira in background (nohup), log in dati/fomo/tesi/tesi.log, dati in dati/fomo/tesi/.
//
// Domanda dello studio: i token in bonding che ricevono presto tante tesi, scritte da trader con buoni
// risultati, arrivano alla graduation piu' spesso degli altri? Il report e' tesi_report.py.
//
// Ogni giro (TESI_PASSO, default 180 s):
//  1. liste di scoperta di fomo (Mobula pulse, dal Chrome headless di ~/fomo-mcp): "filtered-bonding"
//     (la scheda Bonding dell'app, ~100 token oltre ~35%), "bonding" non filtrata (3 pagine da 100: oltre
//     l'offset 300 Mobula risponde 500), "filtered-bonded" (le graduation recenti) e "new" (i nati da
//     pochi minuti: ~100 ogni 2-3 minuti, troppi per seguirli tutti: se ne segue un campione fisso del
//     TESI_NEW_QUOTA=10%, scelto dall'indirizzo, cosi' la scelta non dipende da niente di osservato).
//  2. stato dei token seguiti e fuori lista: filterTokens a gruppi di 50 (mcap, curva%, holder, migrated).
//  3. graduation anche dal registro di bonding.js (dati/fomo/bonding/registro.json), che gia' la segue
//     sulla catena: si legge il file, nessuna richiesta in piu'.
//  4. tesi (/feed/token/thesis, threshold 0) e compratori fomo (/feed/token, threshold 0) per token, con
//     una coda a priorita' e un tetto di richieste per giro (TESI_BUDGET, default 240):
//       0 chiusura (gradua/muore/scade: si scarica tutto, tesi e feed, una volta sola)
//       1 mai controllato (la prima lettura pagina tutta la storia delle tesi: le tesi vecchie non si perdono)
//       2 curva >= 30%: ogni 2 giri se ha tesi, ogni 3 se no
//       3 curva < 30%: ogni 6 giri
//     Il feed dei compratori si legge solo per i token con almeno una tesi (2 pagine, la prima volta 6) e per
//     tutti alla chiusura (fino a 40 pagine). Gli ultimi RANK_GIRO=40 posti del tetto sono per gli autori.
//     Lettura incrementale: le pagine sono dalla piu' recente, ci si ferma al primo id gia' visto.
//  5. autori: getUserRank (pnl e rank sempre/7g/30g/24h) per ogni autore nuovo e poi una volta al giorno,
//     (almeno 40 a giro, di piu' se il tetto avanza), in dati/fomo/tesi/autori.json (letture con la loro ora: la qualita' si giudica con la lettura fatta
//     prima della graduation, il rank letto dopo conterrebbe il guadagno sul token stesso).
// Un token si segue finche' gradua, muore (mcap < $5.000 per 30 minuti) o passano 24 ore dalla prima vista.
//
// Uso: nohup node scripts/fomo/tesi.js >/dev/null 2>>dati/fomo/tesi/tesi.err &
// Solo lettura: nessuna chiamata a /swaps/v2 o requestSwapQuote. Il token di fomo si rilegge dal file
// (FOMO_TOKEN_FILE) e non si stampa mai. Per fermarlo: kill <pid> (o kill -9 se resta vivo).
const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto');
const { DATI, leggi, scrivi, sleep } = require('./comune');
process.env.FOMO_TOKEN_FILE = process.env.FOMO_TOKEN_FILE || path.join(os.homedir(), '.config/fomo-mcp/token');
const N = 1399811149;
const PASSO = +(process.env.TESI_PASSO || 180) * 1000;
const BUDGET = +(process.env.TESI_BUDGET || 240);          // richieste fomo al giro, al massimo
const GAP = +(process.env.TESI_GAP_MS || 450);              // pausa minima fra due richieste fomo
const QUOTA_NEW = +(process.env.TESI_NEW_QUOTA || 0.1);
const MORTO_MCAP = 5000, MORTO_S = 1800, DURATA = 24 * 3600, RANK_OGNI = 24 * 3600, RANK_GIRO = 40;
const DIR = 'tesi', LOG = path.join(DATI, DIR, 'tesi.log');
fs.mkdirSync(path.join(DATI, DIR, 'token'), { recursive: true });
const log = s => fs.appendFileSync(LOG, `${new Date().toISOString().slice(0, 19)} ${s}\n`);
const ora = () => Math.floor(Date.now() / 1000);
const ts = x => (x == null ? null : typeof x === 'number' ? (x > 1e12 ? Math.floor(x / 1000) : x) : Math.floor(Date.parse(x) / 1000) || null);
const num = x => (x == null || x === '' ? null : +x);
const r2 = x => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);

// ---- fomo: un client solo, richieste in fila con pausa, conteggio per tipo ----
let fomo, ultima = 0; const conta = {}; let n429 = 0;
const cliente = async () => { if (!fomo) { const { FomoClient } = await import(require('url').pathToFileURL(path.join(os.homedir(), 'fomo-mcp', 'dist', 'client.js')).href); fomo = new FomoClient(''); } return fomo; };
async function chiama(tipo, f) {
  const c = await cliente();
  for (let i = 0; ; i++) {
    const att = ultima + GAP - Date.now(); if (att > 0) await sleep(att);
    ultima = Date.now(); conta[tipo] = (conta[tipo] || 0) + 1;
    try { return await f(c); } catch (e) {
      const m = String(e.message || e);
      if (/-> 429/.test(m)) { n429++; if (i < 3) { await sleep(10000 * (i + 1)); continue; } }
      else if (/closed|Execution context|navigat|-> 5\d\d/i.test(m) && i < 3) { await sleep(3000); continue; }
      throw e;
    }
  }
}
const spesa = () => Object.values(conta).reduce((a, b) => a + b, 0);

// ---- archivio ----
const I = leggi(`${DIR}/indice.json`, {});        // mint -> riassunto (tutti, aperti e chiusi)
const A = leggi(`${DIR}/autori.json`, {});        // userId -> { h, letture: [{t, rank, pnl, r30, p30, r7, p7, r24, p24, follower}] }
const T = {};                                       // mint -> scheda completa, solo token aperti in memoria
const sporchi = new Set();
const fileTok = m => `${DIR}/token/${m}.json`;
const tok = m => (T[m] = T[m] || leggi(fileTok(m), null));
const prendi = m => T[m] || (I[m] ? tok(m) : null);   // aperto in memoria, o dal suo file
const nelCampione = m => parseInt(crypto.createHash('sha1').update(m).digest('hex').slice(0, 8), 16) / 0xffffffff < QUOTA_NEW;

// riga di una lista pulse -> stato del momento
const daLista = (x, lista) => ({ t: ora(), lista, bp: x.bondingPercentage != null ? r2(+x.bondingPercentage) : null,
  mcap: Math.round(num(x.marketCap) || 0), holders: x.holdersCount ?? null, liq: Math.round(num(x.liquidity) || 0) });
const daFilter = x => ({ t: ora(), lista: 'filter', bp: r2(num(x.token?.launchpad?.graduationPercent)),
  mcap: Math.round(num(x.marketCap) || 0), holders: x.holders ?? null, liq: Math.round(num(x.liquidity) || 0) });
function nuovo(m, x, lista) {
  const s = x.socials || {};
  return { mint: m, sym: x.symbol, nome: x.name, launchpad: x.source || x.type || null, creato: ts(x.createdAt),
    deployer: x.deployer || null, dep_token: x.deployerTokensCount ?? null, dep_migr: x.deployerMigrationsCount ?? null,
    social: { twitter: s.twitter || null, sito: s.website || null, telegram: s.telegram || null },
    desc: (x.description || '').slice(0, 300), primo_visto: ora(), prima_lista: lista, liste: [lista], campione_new: lista === 'new',
    stato: 'bonding', stati: [], bp_max: 0, tesi: [], feed: [], controlli: 0, ultimo_controllo: 0 };
}
function aggiungiStato(r, p) {
  const u = r.stati.at(-1);
  if (p.bp != null && p.bp > r.bp_max) r.bp_max = p.bp;
  if (p.mcap >= MORTO_MCAP) r.sotto_da = null; else if (p.mcap > 0 && !r.sotto_da) r.sotto_da = p.t;
  // si tiene un passaggio se cambia qualcosa davvero, o ogni 10 minuti
  if (u && p.t - u.t < 600 && Math.abs((p.bp ?? 0) - (u.bp ?? 0)) < 0.5 && Math.abs(p.mcap - u.mcap) < 0.03 * (u.mcap || 1)) return;
  r.stati.push(p);
}
function chiudi(r, stato, quando, fonte) {
  if (r.stato !== 'bonding') return;
  r.stato = stato; r.chiuso_at = quando; r.chiusura_fonte = fonte; r.da_scaricare = true;
  if (stato === 'graduato') r.grad_at = quando;
  log(`${stato} ${r.sym} ${r.mint} (${fonte}; curva max ${r.bp_max}%, ${r.tesi.length} tesi)`);
}
function riassunto(r) {
  const autori = new Set(r.tesi.map(t => t.uid));
  return { sym: r.sym, launchpad: r.launchpad, creato: r.creato, primo_visto: r.primo_visto, prima_lista: r.prima_lista,
    campione_new: r.campione_new, stato: r.stato, chiuso_at: r.chiuso_at || null, grad_at: r.grad_at || null, fonte: r.chiusura_fonte || null,
    finito: !!r.finito, bp_max: r.bp_max, bp: r.stati.at(-1)?.bp ?? null, mcap: r.stati.at(-1)?.mcap ?? null,
    n_tesi: r.tesi.length, n_autori: autori.size, n_feed: r.feed.length, controlli: r.controlli };
}

// ---- tesi e feed di un token, incrementale (pagine dalla piu' recente) ----
async function scaricaTesi(r, maxPag) {
  const visti = new Set(r.tesi.map(t => t.id)); let lastId, nuove = 0, pag = 0;
  for (; pag < maxPag; pag++) {
    const res = await chiama('tesi', c => c.tokenThesis(r.mint, N, 50, 0, lastId));
    const it = res?.items || []; let vecchio = false;
    for (const x of it) {
      if (visti.has(x.id)) { vecchio = true; continue; }
      visti.add(x.id); nuove++;
      const cm = x.comment || {}, at = x.authorTrade || {};
      r.tesi.push({ id: x.id, t: ts(x.createdAt), uid: x.userId, h: x.userHandle, twitter: x.twitter || null,
        testo: (cm.comment || '').slice(0, 600), mcap: r2(num(cm.marketCapAtCreation)), prezzo: num(cm.priceUsdAtCreation),
        like: cm.numLikes ?? null, risposte: x.numReplies ?? null, letta: ora(),
        // posizione dell'autore cosi' com'era quando l'abbiamo letta (fomo da' solo quella di adesso)
        pos: { usd: r2(num(at.usdValue)), qta: num(at.humanTokenAmount), real: r2(num(at.realizedPnlUsd)), unreal: r2(num(at.unrealizedPnlUsd)), chiusa: at.closedAt ? ts(at.closedAt) : null },
        badge: x.badge?.metadata?.rank ?? null });
    }
    if (!res?.hasNextPage || vecchio || !it.length) break;
    lastId = it.at(-1).id;
  }
  if (nuove) r.tesi.sort((a, b) => a.t - b.t);
  return nuove;
}
async function scaricaFeed(r, maxPag) {
  const visti = new Set(r.feed.map(f => f.id)); let lastId, nuovi = 0;
  for (let pag = 0; pag < maxPag; pag++) {
    const res = await chiama('feed', c => c.tokenFeed({ tokenAddress: r.mint, networkId: N, limit: 50, threshold: 0, lastId }));
    const it = res?.items || []; let vecchio = false;
    for (const x of it) {
      if (visti.has(x.id)) { vecchio = true; continue; }
      if (x.type !== 'swap_buy' && x.type !== 'swap_sell') continue;
      visti.add(x.id); nuovi++;
      r.feed.push({ id: x.id, t: ts(x.createdAt), tipo: x.type === 'swap_buy' ? 'b' : 's', uid: x.userId, h: x.userHandle,
        usd: r2(num(x.usdAmount)), mcap: r2(num(x.marketCap)), dev: !!x.isDev });
    }
    if (!res?.hasNextPage || vecchio || !it.length) break;
    lastId = it.at(-1).id;
  }
  if (nuovi) r.feed.sort((a, b) => a.t - b.t);
  return nuovi;
}

// ---- un giro ----
let nGiro = 0;
async function giro() {
  nGiro++; for (const k in conta) delete conta[k]; n429 = 0;
  const t0 = ora(); const visti = new Set(); let nuovi = 0;
  // 1. liste
  const liste = [['filtered-bonding', 0], ['bonding', 0], ['bonding', 100], ['bonding', 200], ['new', 0], ['filtered-bonded', 0]];
  for (const [v, off] of liste) {
    let righe = [];
    try { righe = await chiama('liste', c => c.discoverTokens(v, ['solana:solana'], 100, off)); } catch (e) { log(`lista ${v}+${off}: ${String(e.message).slice(0, 120)}`); continue; }
    for (const x of righe) {
      const m = x.address; if (!m) continue;
      if (v === 'filtered-bonded') {        // graduati recenti: chiude chi seguiamo
        const r = (T[m] || I[m]?.stato === 'bonding') ? prendi(m) : null;
        if (r && r.stato === 'bonding') { aggiungiStato(r, daLista(x, v)); chiudi(r, 'graduato', ts(x.bonded_at) || t0, 'lista graduati'); sporchi.add(m); }
        continue;
      }
      if (v === 'new' && !T[m] && !I[m] && !nelCampione(m)) continue;
      if (!T[m] && I[m] && I[m].stato !== 'bonding') continue;   // gia' chiuso: non si riapre
      let r = prendi(m);
      if (!r && I[m]) continue;             // file sparito: si lascia stare
      if (!r) { r = T[m] = nuovo(m, x, v); nuovi++; }
      if (r.stato !== 'bonding') continue;
      if (!r.liste.includes(v)) r.liste.push(v);
      visti.add(m); aggiungiStato(r, daLista(x, v)); r.ultimo_in_lista = t0; sporchi.add(m);
      if (x.bonded) chiudi(r, 'graduato', ts(x.bonded_at) || t0, 'lista (bonded)');
    }
  }
  const aperti = () => Object.keys(T).filter(m => T[m] && T[m].stato === 'bonding');
  // 2. graduation dal registro di bonding.js (nessuna richiesta)
  const RB = leggi('bonding/registro.json', {});
  for (const m of aperti()) { const b = RB[m]; if (b && b.stato === 'graduato') chiudi(T[m], 'graduato', b.graduato_at || b.grad_visto || b.in_graduated || t0, 'registro bonding.js'); }
  // 3. stato dei fuori lista: filterTokens a gruppi di 50 (curva < 30% una volta ogni 3 giri)
  const fuori = aperti().filter(m => !visti.has(m) && ((T[m].stati.at(-1)?.bp ?? 0) >= 30 || nGiro % 3 === 0 || !T[m].stati.length));
  for (let i = 0; i < fuori.length; i += 50) {
    const parte = fuori.slice(i, i + 50);
    let f = [];
    try { f = await chiama('stato', c => c.filterTokens(parte.map(m => `${m}:${N}`))); } catch (e) { log(`filterTokens: ${String(e.message).slice(0, 120)}`); continue; }
    for (const x of f || []) {
      const m = x.token?.address; const r = T[m]; if (!r || r.stato !== 'bonding') continue;
      aggiungiStato(r, daFilter(x)); sporchi.add(m);
      const lp = x.token?.launchpad; if (lp?.launchpadName) r.launchpad_nome = lp.launchpadName;
      const sl = x.token?.socialLinks; if (sl) r.social = { twitter: sl.twitter || r.social.twitter, sito: sl.website || r.social.sito, telegram: sl.telegram || r.social.telegram };
      if (lp?.migrated) chiudi(r, 'graduato', t0, 'fomo migrated');
    }
  }
  // 4. morti e scaduti
  for (const m of aperti()) {
    const r = T[m];
    if (r.sotto_da && t0 - r.sotto_da >= MORTO_S) chiudi(r, 'morto', t0, `mcap < $${MORTO_MCAP} da ${Math.round((t0 - r.sotto_da) / 60)} min`);
    else if (t0 - r.primo_visto >= DURATA) chiudi(r, 'scaduto', t0, '24 ore senza graduation');
  }
  // 5. coda delle tesi
  const cand = [];
  for (const m of Object.keys(T)) {
    const r = T[m]; if (!r || r.finito) continue;
    const bp = r.stati.at(-1)?.bp ?? 0; let cl, ogni;
    if (r.da_scaricare) { cl = 0; ogni = 0; }
    else if (r.stato !== 'bonding') continue;
    else if (!r.controlli) { cl = 1; ogni = 0; }
    else if (bp >= 30) { cl = 2; ogni = r.tesi.length ? 2 : 3; }
    else { cl = 3; ogni = 6; }
    // in giri di ritardo, misurati sull'orologio (cosi' vale anche dopo un riavvio)
    const ritardo = (t0 - r.ultimo_controllo) / (PASSO / 1000) + 0.1 - ogni;
    if (ritardo >= 0) cand.push({ r, cl, ritardo, bp });
  }
  cand.sort((a, b) => a.cl - b.cl || b.ritardo - a.ritardo || b.bp - a.bp);
  let tesiNuove = 0, feedNuovi = 0, controllati = 0, rimasti = 0;
  for (const { r, cl } of cand) {
    if (spesa() >= BUDGET - RANK_GIRO) { rimasti++; continue; }   // il resto e' per gli autori
    try {
      const fine = cl === 0;
      tesiNuove += await scaricaTesi(r, fine || cl === 1 ? 30 : 4);
      if (fine || r.tesi.length) feedNuovi += await scaricaFeed(r, fine ? 40 : r.feed.length ? 2 : 6);
      r.controlli++; r.ultimo_controllo = ora(); controllati++; sporchi.add(r.mint);
      if (fine) { r.da_scaricare = false; r.finito = true; r.scaricato_at = ora(); }
    } catch (e) { log(`tesi ${r.sym} ${r.mint}: ${String(e.message).slice(0, 120)}`); }
  }
  // 6. autori: rank una volta al giorno, prima i mai letti
  // prima i mai letti, e fra questi gli autori dei token piu' avanti sulla curva (chiudono prima: la lettura
  // deve arrivare prima della graduation)
  const uids = new Map();
  for (const m of Object.keys(T)) {
    const bp = T[m]?.stati.at(-1)?.bp ?? 0;
    for (const t of T[m]?.tesi || []) { const u = uids.get(t.uid); if (!u || bp > u[1]) uids.set(t.uid, [t.h, bp]); }
  }
  const daLeggere = [...uids].filter(([u]) => { const l = A[u]?.letture?.at(-1); return !l || t0 - l.t >= RANK_OGNI; })
    .sort((a, b) => (A[a[0]] ? 1 : 0) - (A[b[0]] ? 1 : 0) || b[1][1] - a[1][1]).map(([u, [h]]) => [u, h]);
  let rank = 0;
  for (const [u, h] of daLeggere) {
    if ((rank >= RANK_GIRO && spesa() >= BUDGET) || spesa() >= BUDGET + 10) break;   // il tetto avanzato va agli autori
    try {
      const x = await chiama('rank', c => c.getUserRank(u)); rank++;
      const a = A[u] = A[u] || { h, letture: [] }; a.h = x.userHandle || h;
      a.letture.push({ t: ora(), rank: x.rank?.rank ?? null, pnl: r2(x.rank?.pnl), r30: x.rank30d?.rank ?? null, p30: r2(x.rank30d?.pnl),
        r7: x.rank7d?.rank ?? null, p7: r2(x.rank7d?.pnl), r24: x.rank24h?.rank ?? null, p24: r2(x.rank24h?.pnl), follower: x.followers ?? null });
    } catch (e) { log(`rank ${h}: ${String(e.message).slice(0, 120)}`); break; }
  }
  // 7. salvataggio: schede cambiate, indice, autori; i token finiti escono dalla memoria
  for (const m of sporchi) { const r = T[m]; if (!r) continue; scrivi(fileTok(m), r); I[m] = riassunto(r); }
  sporchi.clear();
  for (const m of Object.keys(T)) if (!T[m] || T[m].finito) delete T[m];
  scrivi(`${DIR}/indice.json`, I); scrivi(`${DIR}/autori.json`, A);
  const st = Object.values(I).reduce((a, r) => (a[r.stato] = (a[r.stato] || 0) + 1, a), {});
  const durata = ora() - t0;
  const riga = { t: t0, giro: nGiro, s: durata, richieste: spesa(), per_tipo: { ...conta }, r429: n429, nuovi, aperti: aperti().length,
    controllati, rimasti, tesi_nuove: tesiNuove, feed_nuovi: feedNuovi, rank_letti: rank, autori: Object.keys(A).length, indice: st };
  fs.appendFileSync(path.join(DATI, DIR, 'giri.jsonl'), JSON.stringify(riga) + '\n');
  log(`giro ${nGiro} ${durata}s: ${spesa()} richieste ${JSON.stringify(conta)}${n429 ? ` 429x${n429}` : ''} | nuovi ${nuovi}, aperti ${riga.aperti}, controllati ${controllati}, in coda ${rimasti}, tesi +${tesiNuove}, feed +${feedNuovi}, rank ${rank} | ${JSON.stringify(st)}`);
}

(async () => {
  // all'avvio si ricaricano in memoria i token ancora aperti
  for (const [m, r] of Object.entries(I)) if (r.stato === 'bonding' || !r.finito) tok(m);
  log(`avvio pid ${process.pid}: ${Object.keys(I).length} token nell'indice, ${Object.keys(T).length} aperti, ${Object.keys(A).length} autori`);
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { log(`fermato (${s})`); process.exit(0); });
  for (;;) {
    const t = Date.now();
    try { await giro(); } catch (e) { log('errore ' + String(e.stack || e).slice(0, 300)); }
    await sleep(Math.max(5000, PASSO - (Date.now() - t)));
  }
})();
