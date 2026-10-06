// Studio dei token pump.fun intorno alla graduation: tutti i compratori in bonding e quelli della prima ora dopo la
// graduation (sul pool PumpSwap), con entrata (punto della curva, ora, SOL), uscite prima e dopo la graduation e
// risultato vero (incassato + quel che resta venduto adesso sulle riserve del pool); il momento esatto della
// graduation (tx Migrate); il prezzo dopo (+5m, +30m, +1h, +6h, adesso); gli utenti fomo (firmati dal co-firmatario,
// feed, tesi, i 29 migliori); la narrativa. Tutto dalla catena con Helius getTransactionsForAddress sul mint (dalla
// nascita alla graduation + DOPO secondi, al massimo MAXD pagine dopo) e sui conti token di chi a fine finestra tiene
// ancora token per almeno SOGLIA_ATA SOL (i primi MAX_ATA).
// Uscita: dati/fomo/bonding/token/<mint>.json; i report li scrivono bonding_report.py e bonding_wallet.py.
// Uso: node bonding_studio.js <mint>...           singoli token
//      node bonding_studio.js registro [n] [m]    gli n graduati piu' recenti del registro non studiati (o col vecchio
//                                                 schema) + m fermi in bonding; fuori i lanci a pacchetto (< 10 s)
//      node bonding_studio.js wallet <ind>...     storia recente di un wallet: i token comprati sulla curva (GIORNI, PAG_W)
// Ogni chiamata Helius si conta (campi "chiamate_helius"/"chiamate_altre" nel file e a fine giro); ci si ferma a LIMITE.
const fs = require('fs'); const path = require('path');
const { PublicKey } = require('@solana/web3.js');
const { DATI, rpc, leggi, scrivi, CO, USDC } = require('./comune');
process.env.FOMO_TOKEN_FILE = process.env.FOMO_TOKEN_FILE || path.join(require('os').homedir(), '.config/fomo-mcp/token');
const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const WSOL = 'So11111111111111111111111111111111111111112';
const PSWAP = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), T22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const N = 1399811149, TOT = 1e9, REALI = 793.1e6, e = process.env, MAXP = +(e.MAXP || 50);
const DOPO = +(e.DOPO || 3600), MAXD = +(e.MAXD || 50), SOGLIA_ATA = +(e.SOGLIA_ATA || 0.3), MAX_ATA = +(e.MAX_ATA || 60);
const LIMITE = +(e.LIMITE || 15000), GIORNI = +(e.GIORNI || 2), PAG_W = +(e.PAG_W || 15);
const curvaDi = m => PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(m).toBuffer()], PUMP)[0].toBase58();
const ataDi = (o, m, p) => PublicKey.findProgramAddressSync([new PublicKey(o).toBuffer(), new PublicKey(p).toBuffer(), new PublicKey(m).toBuffer()], ATA)[0].toBase58();
// pool PumpSwap canonico di un token graduato: indice 0, creatore = "pool-authority" della curva
const poolDi = m => { const au = PublicKey.findProgramAddressSync([Buffer.from('pool-authority'), new PublicKey(m).toBuffer()], PUMP)[0];
  return PublicKey.findProgramAddressSync([Buffer.from('pool'), Buffer.from([0, 0]), au.toBuffer(), new PublicKey(m).toBuffer(), new PublicKey(WSOL).toBuffer()], PSWAP)[0].toBase58(); };
const mediana = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
let chiamate = 0, altre = 0;
const rpcc = (m, p) => (altre++, rpc('helius', m, p));
const gtfa = (a, cfg) => (chiamate++, rpc('helius', 'getTransactionsForAddress', [a, { transactionDetails: 'full', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, limit: 100, ...cfg }]));
let fomo;
const cliente = async () => { if (!fomo) { const { FomoClient } = await import(path.join(require('os').homedir(), 'fomo-mcp/dist/client.js')); fomo = new FomoClient(''); } return fomo; };
// la pagina di Chrome headless ogni tanto si ricarica da sola ("Target page ... closed"): si riprova
const prova = async f => { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i >= 3 || !/closed|Execution context|navigat/i.test(e.message)) throw e; await new Promise(r => setTimeout(r, 3000)); } } };

// Una transazione → chi ha scambiato il token, a che prezzo (SOL per token, dalla sede: la curva o il
// pool che scambia senza firmare), avanzamento della curva dopo la tx, graduation.
function analizza(x, mint, curva, pool) {
  const keys = x.transaction.message.accountKeys; const firm = new Set(keys.filter(k => k.signer).map(k => k.pubkey));
  const per = {}, add = (o, k, v) => { (per[o] = per[o] || { tok: 0, wsol: 0, usdc: 0, sol: 0 })[k] += v; };
  let curvaTok = null, prog = null;
  for (const [lista, s] of [[x.meta.preTokenBalances || [], -1], [x.meta.postTokenBalances || [], 1]]) for (const b of lista) {
    const v = s * (b.uiTokenAmount.uiAmount || 0);
    if (b.mint === mint) { add(b.owner, 'tok', v); if (b.programId) prog = b.programId; if (s === 1 && b.owner === curva) curvaTok = b.uiTokenAmount.uiAmount || 0; }
    else if (b.mint === WSOL) add(b.owner, 'wsol', v); else if (b.mint === USDC) add(b.owner, 'usdc', v);
  }
  keys.forEach((k, i) => { if (per[k.pubkey]) per[k.pubkey].sol = (x.meta.postBalances[i] - x.meta.preBalances[i]) / 1e9; });
  const ci = keys.findIndex(k => k.pubkey === curva);
  if (ci >= 0 && !per[curva]) per[curva] = { tok: 0, wsol: 0, usdc: 0, sol: (x.meta.postBalances[ci] - x.meta.preBalances[ci]) / 1e9 };
  const logs = x.meta.logMessages || [];
  const migra = logs.some(l => /Instruction: Migrate(V2)?$/.test(l)) && logs.some(l => /Instruction: CreatePool$/.test(l));   // MigrateV2 + CreatePool su PumpSwap
  const crea = logs.some(l => /Instruction: Create(V2)?$/.test(l));
  // sedi: la curva, o chi scambia il token contro SOL/wSOL senza firmare (il pool PumpSwap)
  // la sede e' la curva se c'entra, poi il pool PumpSwap noto; se no chi scambia senza firmare
  const sedi = [], trader = [], tocca = o => per[o] && Math.abs(per[o].tok) > 1e-6;
  const nota = tocca(curva) ? curva : pool && tocca(pool) ? pool : null;
  for (const [o, d] of Object.entries(per)) {
    if (Math.abs(d.tok) < 1e-6) continue;
    const q = d.sol + d.wsol;
    if (nota ? o === nota : (!firm.has(o) && q && Math.sign(q) !== Math.sign(d.tok))) sedi.push([o, d.tok, o === curva ? d.sol : d.wsol + (o === pool ? 0 : 0)]);
    else trader.push([o, d]);
  }
  // nella migrazione il pool e' chi riceve i token rimasti sulla curva
  const nuovoPool = migra ? (Object.entries(per).filter(([o, d]) => o !== curva && d.tok > 0).sort((a, b) => b[1].tok - a[1].tok)[0] || [null])[0] : undefined;
  const vt = sedi.reduce((a, s) => a + s[1], 0), vs = sedi.reduce((a, s) => a + s[2], 0);
  const px = !migra && Math.abs(vt) > 1 && vs && Math.sign(vs) !== Math.sign(vt) ? Math.abs(vs / vt) : null;
  const bp = curvaTok != null ? Math.max(0, Math.min(100, 100 * (TOT - curvaTok) / REALI)) : null;
  return { sig: x.transaction.signatures[0], t: x.blockTime, slot: x.slot, prog, pool: nuovoPool, fomo: firm.has(CO), migra, crea, px, bp, sede: sedi.some(s => s[0] === curva) ? 'curva' : sedi.length ? 'pool' : null,
    tr: px ? trader.map(([o, d]) => ({ w: o, tok: d.tok, sol: -d.tok * px, usdc: d.usdc })) : trader.filter(([, d]) => d.tok).map(([o, d]) => ({ w: o, tok: d.tok, sol: 0, usdc: d.usdc, senza_prezzo: true })),
    firm: [...firm].filter(f => f !== CO) };
}
async function prezzoA(mint, curva, pool, t, verso = 'asc') {
  const r = await gtfa(mint, { sortOrder: verso, limit: 25, filters: { blockTime: verso === 'asc' ? { gte: Math.floor(t) } : { lte: Math.floor(t) }, status: 'succeeded' } });
  const p = r.data.map(x => analizza(x, mint, curva, pool)).filter(a => a.px);
  return p.length ? { px: mediana(p.map(a => a.px)), t: p[0].t, n: p.length } : null;
}
// API fomo: feed degli scambi degli utenti fomo (fino alla nascita), tesi, primi detentori fomo
async function datiFomo(mint, nascita) {
  const c = await cliente(); const out = { feed: [], tesi: [], top: null };
  let last;
  for (let p = 0; p < 40; p++) {
    const r = await prova(() => c.tokenFeed({ tokenAddress: mint, networkId: N, limit: 50, threshold: 0, excludeThesis: true, lastId: last }));
    const it = r.items || []; for (const i of it) out.feed.push({ id: i.id, tipo: i.type, t: Math.floor(Date.parse(i.createdAt) / 1000), u: i.userId, h: i.userHandle, usd: i.usdAmount, mcap: i.marketCap, dev: i.isDev });
    if (!r.hasNextPage || !it.length || Math.floor(Date.parse(it.at(-1).createdAt) / 1000) < nascita) break; last = it.at(-1).id;
  }
  last = undefined;
  for (let p = 0; p < 20; p++) {
    const r = await prova(() => c.tokenThesis(mint, N, 50, 0, last));
    const it = r.items || []; for (const i of it) out.tesi.push({ id: i.id, t: Math.floor(Date.parse(i.createdAt) / 1000), u: i.userId, h: i.userHandle, testo: (i.comment?.comment || '').slice(0, 400), mcap: i.comment?.marketCapAtCreation, likes: i.comment?.numLikes, usd_pos: i.authorTrade?.usdValue, pnl: (i.authorTrade?.realizedPnlUsd || 0) + (i.authorTrade?.unrealizedPnlUsd || 0) });
    if (!r.hasNextPage || !it.length) break; last = it.at(-1).id;
  }
  const t = await prova(() => c.topHolders([{ address: mint, networkId: N }]));
  const h = (t && t[0]) || {}; out.top = { fomo_detentori: h.totalHolders, righe: (h.topHolders || []).slice(0, 30).map(x => ({ u: x.user?.id, h: x.user?.userHandle, valore: x.value, pnl: x.pnl, costo: x.costBasis, real: x.realizedPnl, tenuta_s: x.averageHoldTimeSeconds, dev: x.isDev })) };
  return out;
}
// Narrativa: regole semplici su nome, ticker, descrizione, social, tesi. Si annota, non si giudica.
function narrativa(info, tesi) {
  const testo = [info.nome, info.sym, info.desc, info.twitter, info.sito, ...(tesi || []).slice(0, 30).map(t => t.testo)].join(' ').toLowerCase();
  const tw = (info.twitter || '').toLowerCase(), sito = (info.sito || '').toLowerCase();
  const tipi = [];
  if (/\b(ai|agent|agents|agentic|gpt|llm|claude|bot|intelligence|superintelligence|terminal|autonomous|neural|model)\b/.test(testo)) tipi.push('IA/agenti');
  if (/elonmusk|ishowspeed|trump|kanye|drake|mrbeast|cz_binance|vitalik|celebrit/.test(testo)) tipi.push('celebrita');
  if (/\b(dog|inu|cat|frog|pepe|monkey|ape|bird|pigeon|bear|bull|fish|whale|hamster|wif|bonk|doge|shiba|kitty|emu)\b/.test(testo)) tipi.push('animale/meme');
  if (/\b(app|platform|protocol|launchpad|launch|fees|earn|beta|product|tool|dashboard|trading|api|sdk|build|built|github|devs?)\b/.test(testo) || /github\.com/.test(sito)) tipi.push('prodotto/app');
  if (/\/status\//.test(tw) || /\/status\//.test(sito)) tipi.push('tweet del momento');
  if (/news|breaking|announce|today|just|elect|war|fed|etf/.test(testo)) tipi.push('notizia');
  if (/agencypad|otcdesks|stonkfun|crawlnet|reelpad|coincommunities/.test(testo)) tipi.push('lanciato da piattaforma terza');
  if (!tipi.length) tipi.push('meme/cultura');
  const segnali = [];
  if (info.twitter) segnali.push(/\/i\/communities\//.test(tw) ? 'community X' : /\/status\//.test(tw) ? 'link a un tweet' : 'account X');
  if (info.sito) segnali.push(/x\.com|twitter\.com/.test(sito) ? 'sito = link X' : 'sito proprio');
  if (info.telegram) segnali.push('telegram');
  if (!info.twitter && !info.sito && !info.telegram) segnali.push('nessun social');
  return { tipi, segnali };
}

// riserve adesso: pool PumpSwap (conti token del pool) o curva (conto della curva); servono per valutare
// "come se si vendesse adesso" con l'impatto sul pool, wallet per wallet (ognuno come se vendesse da solo)
async function riserve(mint, curva, pool, prog) {
  if (pool) {
    const r = await rpcc('getMultipleAccounts', [[ataDi(pool, mint, prog), ataDi(pool, WSOL, TOKEN)], { encoding: 'jsonParsed' }]);
    const v = (r.value || []).map(a => a?.data?.parsed?.info?.tokenAmount?.uiAmount);
    if (v[0] && v[1]) return { tipo: 'pool', B: v[0], Q: v[1] };
  }
  const r = await rpcc('getAccountInfo', [curva, { encoding: 'base64' }]);
  if (r?.value) { const b = Buffer.from(r.value.data[0], 'base64'); const vt = Number(b.readBigUInt64LE(8)) / 1e6, vs = Number(b.readBigUInt64LE(16)) / 1e9;
    if (b[48] !== 1 && vt) return { tipo: 'curva', B: vt, Q: vs }; }
  return null;
}
// SOL incassati vendendo h token adesso: prodotto costante sulle riserve, commissioni ~0,3% pool / ~1% curva
const vendi = (rv, h, px) => h <= 0 ? 0 : rv ? rv.Q * h / (rv.B + h) * (rv.tipo === 'pool' ? 0.997 : 0.99) : h * (px || 0);
const somma = (xs, k = 'sol') => xs.reduce((a, v) => a + (v[k] || 0), 0);

async function studia(mint, R) {
  const info = R[mint] || {};
  const curva = curvaDi(mint); let pool = info.pool || null;
  const cache = leggi(`bonding/grezzi/${mint}.json`, null);
  const vecchio = info.stato !== 'graduato' && info.creato && Date.now() / 1000 - info.creato > 12 * 3600 && !(cache && cache.righe[0]?.crea);
  const E = (cache && cache.extra) || { px: {}, uscite: {} };   // punti di prezzo e uscite gia' letti: non si rileggono
  const D = (cache && cache.dopo) || {};                         // fin dove e' letta la storia dopo la graduation
  const righe = []; let tok, gradIdx = -1, fine = null, parziale = false;
  if (cache && process.env.RISCARICA !== '1') { righe.push(...cache.righe); gradIdx = righe.findIndex(a => a.migra); parziale = cache.parziale; if (gradIdx >= 0) pool = righe[gradIdx].pool || pool; }
  else {
  // 0. non graduato e nato da piu' di 12 ore: contano le ultime fasi (chi e' entrato vicino al massimo), dall'ultima tx indietro
  if (vecchio) {
    const giu = [];
    for (let p = 0; p < 30; p++) { const cfg = { sortOrder: 'desc', filters: { status: 'succeeded' } }; if (tok) cfg.paginationToken = tok;
      const r = await gtfa(mint, cfg); giu.push(...r.data); tok = r.paginationToken; if (!tok) break; }
    righe.push(...giu.reverse().map(x => analizza(x, mint, curva, pool)));
    parziale = tok ? `solo le ultime ${righe.length} tx (dal ${new Date(righe[0].t * 1000).toISOString().slice(0, 16)})` : false; tok = null;
  }
  // 1. dalla nascita alla graduation + 15 secondi (il dopo lo legge il passo 1b, con un tetto di pagine)
  for (let p = 0; p < (vecchio ? 0 : MAXP); p++) {
    const cfg = { sortOrder: 'asc', filters: { status: 'succeeded' } }; if (tok) cfg.paginationToken = tok;
    if (fine) cfg.filters.blockTime = { lte: fine };
    const r = await gtfa(mint, cfg);
    for (const x of r.data) { const a = analizza(x, mint, curva, pool); righe.push(a); if (a.migra && gradIdx < 0) { gradIdx = righe.length - 1; fine = a.t + 15; pool = a.pool || pool; } }
    tok = r.paginationToken; if (!tok || (fine && righe.at(-1).t > fine) || (info.graduato_at && !fine && righe.at(-1).t > info.graduato_at + 120)) break;
    if (p === MAXP - 1) parziale = true;
  }
  if (!vecchio && (!righe.length || !righe[0].crea)) parziale = true;
  // storia troppo lunga e graduation non raggiunta: la finestra prima della graduation nota (dal registro)
  if (gradIdx < 0 && parziale && info.graduato_at) {
    const ultima = righe.at(-1).t, da = Math.max(info.graduato_at - 1800, ultima), visti = new Set(righe.map(a => a.sig)); let tk;
    for (let p = 0; p < 30; p++) { const cfg = { sortOrder: 'asc', filters: { status: 'succeeded', blockTime: { gte: da, lte: info.graduato_at + 15 } } }; if (tk) cfg.paginationToken = tk;
      const r = await gtfa(mint, cfg); for (const x of r.data) { if (visti.has(x.transaction.signatures[0])) continue; const a = analizza(x, mint, curva, pool); righe.push(a); if (a.migra && gradIdx < 0) { gradIdx = righe.length - 1; pool = a.pool || pool; } }
      tk = r.paginationToken; if (!tk) break; }
    parziale = da > ultima ? `buco dalle ${new Date(ultima * 1000).toISOString().slice(11, 19)} alle ${new Date(da * 1000).toISOString().slice(11, 19)}` : false;
  }
  if (gradIdx >= 0 && parziale === true) parziale = false;   // la fase in bonding e' tutta; tagliato solo il dopo
  scrivi(`bonding/grezzi/${mint}.json`, { righe, parziale, extra: E, dopo: D });
  }
  const nascita = vecchio ? info.creato : righe[0]?.t, creatore = righe[0]?.crea ? righe[0].firm[0] : null;
  const grad = gradIdx >= 0 ? righe[gradIdx] : null;
  const gT = grad ? grad.t : null;
  if (gT && !pool) pool = poolDi(mint);
  // 1b. dopo la graduation, dalla storia del mint (ogni tx porta i saldi di tutti quelli che scambiano): fino a
  // graduation + DOPO secondi, al massimo MAXD pagine. I token caldi fanno 20-120 tx al secondo sul pool (bot):
  // li' la finestra coperta e' di pochi minuti, e chi tiene ancora a fine finestra si segue dal suo conto token (passo 4).
  if (gT && !D.completo) {
    const da = D.fino || righe.at(-1).t, visti = new Set(righe.filter(a => a.t >= da).map(a => a.sig)); let tk, p = 0;
    const lim = Math.min(gT + DOPO, Math.floor(Date.now() / 1000) - 30);   // graduato da meno di un'ora: si legge fin qui
    for (; p < MAXD; p++) {
      const cfg = { sortOrder: 'asc', filters: { status: 'succeeded', blockTime: { gte: da, lte: lim } } }; if (tk) cfg.paginationToken = tk;
      const r = await gtfa(mint, cfg);
      for (const x of r.data) if (!visti.has(x.transaction.signatures[0])) righe.push(analizza(x, mint, curva, pool));
      tk = r.paginationToken; if (!tk) break;
    }
    D.completo = !tk && lim === gT + DOPO; D.fino = tk ? righe.at(-1).t : lim; D.pagine = (D.pagine || 0) + p + (tk ? 0 : 1);
    scrivi(`bonding/grezzi/${mint}.json`, { righe, parziale, extra: E, dopo: D });
  }
  const finDopo = gT ? Math.min(gT + DOPO, D.fino || gT) : null;
  // l'ultimo acquisto che riempie la curva (complete) e il prezzo finale della curva
  const inCurva = righe.filter(a => a.sede === 'curva' && a.px);
  const ultimoCurva = inCurva.filter(a => !gT || a.t <= gT).at(-1);
  // 2. prezzi: alla graduation (ultimo in curva), +1m dalla finestra scaricata, poi punti
  const dopo = gT ? righe.filter(a => a.t > gT && a.sede === 'pool' && a.px) : [];
  const px = { curva_fine: ultimoCurva?.px || null };
  const ora = Math.floor(Date.now() / 1000);
  if (gT) {
    const d60 = dopo.filter(a => a.t <= gT + 60);
    px.m1 = d60.length ? mediana(d60.slice(-15).map(a => a.px)) : null; px.max1 = d60.length ? Math.max(...d60.map(a => a.px)) : null;
    px.fine_finestra = dopo.length ? mediana(dopo.slice(-15).map(a => a.px)) : null;
    for (const [k, s] of [['m5', 300], ['m30', 1800], ['h1', 3600], ['h6', 21600], ['h24', 86400]]) if (ora > gT + s + 60) {
      if (E.px[k] === undefined) { const q = s <= finDopo - gT - 30 ? { px: mediana(dopo.filter(a => a.t >= gT + s).slice(0, 25).map(a => a.px)) } : await prezzoA(mint, curva, pool, gT + s); E.px[k] = q ? q.px : null; }
      px[k] = E.px[k]; }
  }
  const qa = await prezzoA(mint, curva, pool, ora, 'desc'); px.ora = qa ? qa.px : null; px.ora_t = qa ? qa.t : null;
  const prog = new PublicKey(righe.find(a => a.prog)?.prog || TOKEN.toBase58());
  const rv = await riserve(mint, curva, gT ? pool : null, prog).catch(() => null);
  // dollari per SOL dagli scambi fomo stessi (pagati in USDC, eseguiti contro SOL): commissioni comprese (~1-2% in piu')
  const rap = righe.filter(a => a.fomo && a.px).flatMap(a => a.tr.filter(r => r.usdc && r.sol && Math.sign(r.usdc) === Math.sign(r.sol)).map(r => Math.abs(r.usdc / r.sol)));
  const solu = mediana(rap.filter(x => x > 20 && x < 2000));
  // 3. per wallet: tutti i compratori in bonding, e quelli che entrano nella prima ora dopo la graduation (pool)
  const W = {};
  const wal = w => (W[w] = W[w] || { w, compre: [], vendite_b: [], vendite_d: [], compre_d: [], trasf: [], fomo: false });
  // convenzione: sol = SOL che entra nel wallet (acquisto negativo, vendita positiva), al prezzo della sede
  // token passati senza prezzo (trasferimenti: chi lancia o un compratore che distribuisce su altri wallet)
  const distrib = {};
  for (const a of righe) {
    if (a.px || a.migra || (gT && a.t > gT)) continue;
    const da = (a.tr.find(r => r.tok < 0) || {}).w || '?';
    for (const r of a.tr.filter(r => r.tok > 0 && r.w !== curva)) { const x = wal(r.w); (x.ricevuti = x.ricevuti || []).push({ t: a.t, sig: a.sig, tok: +r.tok.toFixed(0), da });
      const d = distrib[da] = distrib[da] || { wallet: new Set(), tok: 0, primo: a.t, sig: a.sig }; d.wallet.add(r.w); d.tok += r.tok; }
  }
  for (const a of righe) for (const r of a.tr) {
    if (r.w === curva || (pool && r.w === pool) || a.migra) continue;
    const rec = { t: a.t, sig: a.sig, tok: +r.tok.toFixed(2), sol: +r.sol.toFixed(4) };
    if (r.senza_prezzo) { if (gT && a.t > gT) wal(r.w).trasf.push({ ...rec, sol: 0 }); continue; }   // dopo: entra nel saldo, senza SOL
    const x = wal(r.w); if (a.fomo) x.fomo = true;
    rec.bp = a.bp != null ? +a.bp.toFixed(1) : null; if (r.usdc) rec.usdc = +r.usdc.toFixed(2);
    if (!gT || a.t <= gT) (r.tok > 0 ? x.compre : x.vendite_b).push(rec); else (r.tok < 0 ? x.vendite_d : x.compre_d).push(rec);
  }
  const pxMark = px.h1 || px.m30 || px.m5 || px.ora || px.curva_fine || 0;
  const conti = Object.values(W).filter(x => x.compre.length || (gT && x.compre_d.length && x.compre_d[0].t <= gT + DOPO)).map(x => {
    const tardi = !x.compre.length, c0 = tardi ? x.compre_d[0] : x.compre[0];
    const cin = -somma(x.compre), tin = somma(x.compre, 'tok'), sout = somma(x.vendite_b), tout = somma(x.vendite_b, 'tok');
    const resto = Math.max(0, tin + tout);   // tout negativo
    return { ...x, dopo_grad: tardi, sol_in: +cin.toFixed(4), tok_in: +tin.toFixed(0), sol_out_b: +sout.toFixed(4), tok_alla_grad: +resto.toFixed(0),
      prima: c0.t - nascita, bp_ingresso: tardi ? 'dopo' : c0.bp, min_dopo_grad: tardi ? +((c0.t - gT) / 60).toFixed(2) : null,
      nel_blocco_nascita: !tardi && c0.t === nascita && righe.find(a => a.sig === c0.sig)?.slot === righe[0].slot,
      creatore: x.w === creatore, pnl_mark: +(sout - cin + resto * pxMark).toFixed(4) };
  });
  // 4. dopo la graduation: flussi dalla storia del mint fino a fine finestra; chi a fine finestra tiene ancora token per
  // almeno SOGLIA_ATA SOL si segue dal conto token (i primi MAX_ATA per valore); gli altri restano "tenuti" al prezzo di adesso
  for (const c of conti) {
    const d1 = [...c.vendite_d, ...c.compre_d, ...c.trasf];
    c.tok_fine_finestra = Math.max(0, c.tok_alla_grad + somma(d1, 'tok'));
  }
  if (gT) {
    const pf = px.fine_finestra || px.ora || 0;
    const da = conti.filter(c => c.tok_fine_finestra > 1).map(c => [c, Math.max(c.tok_fine_finestra * pf, vendi(rv, c.tok_fine_finestra, px.ora))])
      .filter(([, v]) => v >= SOGLIA_ATA).sort((a, b) => b[1] - a[1]).slice(0, MAX_ATA).map(([c]) => c);
    for (const c of da) {
      const u = E.uscite[c.w] = E.uscite[c.w] || { fino: finDopo, righe: [] };
      if (u.fino < finDopo && !u.righe.length) u.fino = finDopo;
      if (!u.completo && !(ora - u.letto < 3 * 3600)) {
        const r = await gtfa(ataDi(c.w, mint, prog), { sortOrder: 'asc', limit: 100, filters: { status: 'succeeded', blockTime: { gt: Math.min(u.fino, ora - 60) } } }).catch(() => null);
        if (!r) { c.seguito = true; continue; }
        for (const x of r.data) { const an = analizza(x, mint, curva, pool); const m = an.tr.find(q => q.w === c.w); if (m) u.righe.push({ t: an.t, sig: an.sig, tok: +m.tok.toFixed(0), sol: m.senza_prezzo ? 0 : +m.sol.toFixed(4), trasf: m.senza_prezzo || undefined }); }
        u.completo = !r.paginationToken; u.letto = ora; if (r.data.length) u.fino = r.data.at(-1).blockTime;
      }
      c.seguito = true;
    }
  }
  for (const c of conti) {
    const d1 = [...c.vendite_d, ...c.compre_d, ...c.trasf], visti = new Set(d1.map(v => v.sig));
    const u = c.seguito ? (E.uscite[c.w].righe || []).filter(v => !visti.has(v.sig) && v.t > finDopo - 1) : [];
    if (c.seguito) { c.uscite = u; c.uscite_complete = !!E.uscite[c.w].completo; }
    const tutti = [...d1, ...u], resto = Math.max(0, c.tok_alla_grad + somma(tutti, 'tok'));
    c.incasso_dopo = +somma(tutti).toFixed(4); c.tok_ora = +resto.toFixed(0);
    c.valore_ora = +vendi(rv, resto, px.ora).toFixed(4);
    c.sol_in_tot = +(c.sol_in - somma(tutti.filter(v => v.sol < 0))).toFixed(4);
    c.sol_out_tot = +(c.sol_out_b + somma(tutti.filter(v => v.sol > 0))).toFixed(4);
    c.pnl_vero = +(c.sol_out_b - c.sol_in + c.incasso_dopo + c.valore_ora).toFixed(4);
    c.trasferiti = somma([...c.trasf, ...u.filter(v => v.trasf)], 'tok') || undefined;
    // uscita: venduto (quasi) tutto prima della graduation, subito dopo (5 min), entro l'ora, piu' tardi; o tiene
    const comprati = c.tok_in + somma([...c.compre_d, ...u.filter(v => v.tok > 0 && !v.trasf)], 'tok');
    const vend = [...c.vendite_b, ...c.vendite_d, ...u.filter(v => v.tok < 0)].sort((a, b) => a.t - b.t).at(-1);
    c.quota_tenuta = comprati > 0 ? +Math.min(1, resto / comprati).toFixed(3) : 0;
    const fuori = -somma([...c.trasf, ...u.filter(v => v.trasf)].filter(v => v.tok < 0), 'tok');   // token passati ad altri wallet
    if (c.quota_tenuta > 0.05) c.uscita = gT ? (c.seguito ? 'tiene' : 'tiene (non seguito)') : 'tiene (curva)';
    else if (!vend || fuori > 0.5 * comprati) c.uscita = 'trasferito';   // il risultato non si sa: i token sono altrove
    else { const dt = gT ? vend.t - gT : null; c.uscita = !gT ? 'venduto in curva' : dt <= 0 ? 'prima' : dt <= 300 ? 'subito dopo' : dt <= 3600 ? 'entro 1h' : 'dopo 1h'; c.t_uscita = vend.t; c.sig_uscita = vend.sig; }
  }
  conti.sort((a, b) => b.pnl_vero - a.pnl_vero);
  // 5. fomo: API, e il ponte fra wallet e utente (wallet.json, poi feed alla stessa ora)
  let F = null; try { F = await datiFomo(mint, nascita || 0); } catch (e) { F = { errore: e.message.slice(0, 120) }; }
  const WJ = leggi('wallet.json', {}), perWallet = {}; for (const [u, v] of Object.entries(WJ)) if (v.sol) perWallet[v.sol] = u;
  const MIG = migliori();
  const utente = {};
  for (const c of conti) if (perWallet[c.w]) utente[c.w] = perWallet[c.w];
  if (F && F.feed) for (const c of conti.filter(c => c.fomo && !utente[c.w])) {
    const voti = {};
    for (const b of [...c.compre, ...c.vendite_b, ...c.vendite_d, ...c.compre_d]) for (const f of F.feed) if (Math.abs(f.t - b.t) <= 3 && ((b.tok > 0) === (f.tipo === 'swap_buy'))) voti[f.u] = (voti[f.u] || 0) + 1;
    const best = Object.entries(voti).sort((a, b) => b[1] - a[1])[0]; if (best && best[1] >= 1) utente[c.w] = best[0];
  }
  const handle = {}; if (F && F.feed) for (const f of [...F.feed, ...(F.tesi || [])]) handle[f.u] = f.h;
  for (const c of conti) { const u = utente[c.w]; if (u) { c.fomo_id = u; c.handle = handle[u] || MIG[u]?.h || null; c.migliore = !!MIG[u]?.migliore; } }
  const migl = F && F.feed ? [...new Set(F.feed.filter(f => MIG[f.u]?.migliore).map(f => f.u))].map(u => ({ u, h: MIG[u].h, swap: F.feed.filter(f => f.u === u) })) : [];
  // conteggi e concentrazione (niente medie): chi guadagna, quanto pesano i primi, per fascia d'ingresso (risultato vero)
  const pos = conti.filter(c => c.pnl_vero > 0), tot = xs => +xs.reduce((a, c) => a + c.pnl_vero, 0).toFixed(3);
  const fasce = {}; for (const c of conti) { const k = fascia(c.bp_ingresso);
    const f = fasce[k] = fasce[k] || { n: 0, in_utile: 0, sol_in: 0, pnl: 0 }; f.n++; if (c.pnl_vero > 0) f.in_utile++; f.sol_in = +(f.sol_in + c.sol_in_tot).toFixed(3); f.pnl = +(f.pnl + c.pnl_vero).toFixed(3); }
  const inB = conti.filter(c => !c.dopo_grad);
  const riassunto = { compratori: inB.length, compratori_dopo: conti.length - inB.length, in_utile: pos.length, utile_tot: tot(pos), perdita_tot: tot(conti.filter(c => c.pnl_vero < 0)),
    quota_primo: pos.length ? +(pos[0].pnl_vero / tot(pos)).toFixed(3) : null, quota_primi10: pos.length ? +(tot(pos.slice(0, 10)) / tot(pos)).toFixed(3) : null,
    sol_in_tot: +inB.reduce((a, c) => a + c.sol_in, 0).toFixed(3), fasce, prezzo_mark: pxMark, riserve_ora: rv,
    finestra_dopo_s: gT ? finDopo - gT : null, finestra_completa: gT ? !!D.completo : null, seguiti: conti.filter(c => c.seguito).length,
    tenuti_non_seguiti: conti.filter(c => c.uscita === 'tiene (non seguito)').length, valore_non_seguiti: +conti.filter(c => c.uscita === 'tiene (non seguito)').reduce((a, c) => a + c.valore_ora, 0).toFixed(3),
    fomo: { wallet: conti.filter(c => c.fomo).length, in_utile: conti.filter(c => c.fomo && c.pnl_vero > 0).length, pnl: tot(conti.filter(c => c.fomo)) } };
  riassunto.distribuzioni = Object.entries(distrib).map(([da, d]) => ({ da, wallet: d.wallet.size, tok: Math.round(d.tok), quota_offerta: +(d.tok / TOT).toFixed(4), primo: d.primo, sig: d.sig, creatore: da === creatore }))
    .filter(d => d.wallet >= 3).sort((a, b) => b.tok - a.tok).slice(0, 5);
  riassunto.solo_ricevuti = Object.values(W).filter(x => !x.compre.length && !x.compre_d.length && x.ricevuti).length;
  const soglie = {}; for (const s of [25, 50, 80, 90, 95]) { const a = inCurva.find(a => a.bp >= s); if (a) soglie[s] = { t: a.t, px: a.px, sig: a.sig }; }
  const nar = narrativa(info, F?.tesi);
  scrivi(`bonding/grezzi/${mint}.json`, { righe, parziale, extra: E, dopo: D });
  // tutti i wallet in forma corta (bonding_wallet.py); il dettaglio scambio per scambio per i primi 60, i fomo e gli ultimi 10
  const corto = c => ({ w: c.w, bp: c.bp_ingresso, t0: (c.compre[0] || c.compre_d[0]).t, dt: c.prima, min_dopo: c.min_dopo_grad, sol_in: c.sol_in_tot, sol_out: c.sol_out_tot,
    sol_out_b: c.sol_out_b, tok_grad: c.tok_alla_grad, tok_ora: c.tok_ora, valore_ora: c.valore_ora, pnl: c.pnl_vero, uscita: c.uscita, t_uscita: c.t_uscita, sig_uscita: c.sig_uscita,
    quota_tenuta: c.quota_tenuta, seguito: c.seguito || undefined, completo: c.uscite_complete, trasf: c.trasferiti, n_compre: c.compre.length + c.compre_d.length,
    n_vendite: c.vendite_b.length + c.vendite_d.length + (c.uscite || []).filter(v => v.tok < 0).length, sig_in: (c.compre[0] || c.compre_d[0]).sig,
    fomo: c.fomo || undefined, fomo_id: c.fomo_id, handle: c.handle, migliore: c.migliore || undefined, creatore: c.creatore || undefined, blocco: c.nel_blocco_nascita || undefined });
  const out = { mint, sym: info.sym, nome: info.nome, fonte: info.fonte, desc: info.desc, twitter: info.twitter, sito: info.sito, telegram: info.telegram, versione: 2,
    registro: { primo_visto: info.primo_visto, prima_lista: info.prima_lista, stato: info.stato, bp_max: info.bp_max, graduato_at_lista: info.graduato_at, in_graduated: info.in_graduated },
    nascita, creatore, curva, pool, grad: grad ? { t: gT, sig: grad.sig, durata_s: gT - nascita, ultimo_acquisto_curva: ultimoCurva && { t: ultimoCurva.t, sig: ultimoCurva.sig } } : null,
    bp_max_catena: Math.max(0, ...righe.map(a => a.bp || 0)), ultima_tx: righe.at(-1)?.t, n_tx: righe.length, parziale, px, soglie, sol_usd: solu, narrativa: nar,
    compratori: inB.length, riassunto, conti: conti.slice(0, 60), fomo_conti: conti.filter(c => c.fomo), perdenti: conti.slice(-10), tutti: conti.map(corto),
    fomo: F, migliori_fomo: migl, chiamate_helius: 0 };
  return out;
}
const fascia = b => b === 'dopo' ? 'dopo' : b == null ? '?' : b < 25 ? '0-25' : b < 50 ? '25-50' : b < 80 ? '50-80' : b < 95 ? '80-95' : '95-100';
const migliori = () => { try { const f = fs.readdirSync(path.join(DATI, 'risultati')).filter(x => /^migliori-.*\.json$/.test(x)).sort().at(-1); return leggi('risultati/' + f); } catch (e) { return {}; } };

// Storia recente di un wallet (Helius, ultimi GIORNI giorni, al massimo PAG_W pagine da 100 tx): ogni token pump.fun
// comprato sulla curva, a che punto, se si e' graduato, quanto ha incassato, quanto tiene e quanto vale adesso.
// Misura il wallet sui token che non abbiamo scelto noi. Uscita: dati/fomo/bonding/wallet/<indirizzo>.json
async function storiaWallet(w) {
  const vecchia = leggi(`bonding/wallet/${w}.json`, null), ora = Math.floor(Date.now() / 1000);
  if (vecchia && ora - vecchia.letto < 6 * 3600 && process.env.RISCARICA !== '1') return vecchia;
  const da = ora - GIORNI * 86400, tx = []; let tk, p = 0;
  for (; p < PAG_W; p++) { const cfg = { sortOrder: 'desc', filters: { status: 'succeeded', blockTime: { gte: da } } }; if (tk) cfg.paginationToken = tk;
    const r = await gtfa(w, cfg); tx.push(...r.data); tk = r.paginationToken; if (!tk) break; }
  const M = {};
  for (const x of tx.reverse()) {
    const logs = x.meta.logMessages || []; if (!logs.some(l => l.includes(PUMP.toBase58()) || l.includes(PSWAP.toBase58()))) continue;
    const mints = new Set([...(x.meta.preTokenBalances || []), ...(x.meta.postTokenBalances || [])].filter(b => b.owner === w && b.mint !== WSOL && b.mint !== USDC).map(b => b.mint));
    for (const m of mints) {
      const a = analizza(x, m, curvaDi(m), null), r = a.tr.find(q => q.w === w); if (!r || r.senza_prezzo) continue;
      const s = M[m] = M[m] || { mint: m, scambi: [] };
      if (!s.scambi.length && !(r.tok > 0 && a.sede === 'curva')) { delete M[m]; continue; }   // si conta solo chi parte da un acquisto sulla curva
      s.scambi.push({ t: a.t, sig: a.sig, tok: +r.tok.toFixed(0), sol: +r.sol.toFixed(4), bp: a.bp != null ? +a.bp.toFixed(1) : null, sede: a.sede, migra: a.migra || undefined });
    }
  }
  // fuori le briciole (meno di 0,01 SOL: token arrivati quasi gratis, airdrop o scambi strani): non sono acquisti
  const lista = Object.values(M).filter(s => -somma(s.scambi.filter(v => v.sol < 0)) >= 0.01);
  // stato di ogni curva adesso (complete = graduato) e riserve per valutare quel che resta
  const curve = lista.map(s => curvaDi(s.mint));
  for (let i = 0; i < curve.length; i += 100) {
    const r = await rpcc('getMultipleAccounts', [curve.slice(i, i + 100), { encoding: 'base64' }]);
    r.value.forEach((v, j) => { const s = lista[i + j]; if (!v) return; const b = Buffer.from(v.data[0], 'base64');
      s.graduato = b[48] === 1; s.curva_ora = { B: Number(b.readBigUInt64LE(8)) / 1e6, Q: Number(b.readBigUInt64LE(16)) / 1e9 }; });
  }
  for (const s of lista) {
    const tin = somma(s.scambi.filter(v => v.tok > 0), 'tok'), resto = Math.max(0, somma(s.scambi, 'tok'));
    s.bp = s.scambi[0].bp; s.t0 = s.scambi[0].t; s.sol_in = +-somma(s.scambi.filter(v => v.sol < 0)).toFixed(4); s.sol_out = +somma(s.scambi.filter(v => v.sol > 0)).toFixed(4);
    s.tok_ora = Math.round(resto); s.quota_tenuta = tin ? +(resto / tin).toFixed(3) : 0;
    s.venduto_in_curva = s.scambi.some(v => v.tok < 0 && v.sede === 'curva'); s.venduto_dopo = s.scambi.some(v => v.tok < 0 && v.sede !== 'curva');
  }
  // il resto: sulla curva se non graduato (riserve lette), sul pool PumpSwap se graduato (riserve del pool canonico)
  const daPool = lista.filter(s => s.graduato && s.tok_ora > 1);
  const pools = daPool.map(s => poolDi(s.mint)), conti = [];
  daPool.forEach((s, i) => { s.pool = pools[i]; conti.push(ataDi(pools[i], s.mint, TOKEN), ataDi(pools[i], s.mint, T22), ataDi(pools[i], WSOL, TOKEN)); });
  for (let i = 0; i < conti.length; i += 99) {
    const r = await rpcc('getMultipleAccounts', [conti.slice(i, i + 99), { encoding: 'jsonParsed' }]);
    r.value.forEach((v, j) => { const k = i + j, s = daPool[Math.floor(k / 3)], q = v?.data?.parsed?.info?.tokenAmount?.uiAmount; if (q == null) return; if (k % 3 === 2) s.Q = q; else s.B = s.B || q; });
  }
  for (const s of lista) {
    const rv = s.graduato ? (s.B && s.Q ? { tipo: 'pool', B: s.B, Q: s.Q } : null) : s.curva_ora ? { tipo: 'curva', ...s.curva_ora } : null;
    s.valore_ora = +vendi(rv, s.tok_ora, 0).toFixed(4); s.valutato = !!rv || s.tok_ora <= 1;
    s.pnl = +(s.sol_out - s.sol_in + s.valore_ora).toFixed(4); delete s.curva_ora; delete s.B; delete s.Q;
  }
  const o = { w, letto: ora, da: tx.length ? tx[0].blockTime : da, tx: tx.length, completa: !tk, pagine: p + (tk ? 0 : 1), token: lista.sort((a, b) => b.pnl - a.pnl) };
  scrivi(`bonding/wallet/${w}.json`, o); return o;
}

(async () => {
  const R = leggi('bonding/registro.json', {});
  let mints = process.argv.slice(2);
  if (mints[0] === 'wallet') {
    for (const w of mints.slice(1)) { const c0 = chiamate;
      try { const o = await storiaWallet(w); const g = o.token.filter(s => s.graduato);
        console.log(`${w.slice(0, 6)}: ${o.tx} tx${o.completa ? '' : ' (tagliata)'}, ${o.token.length} token comprati in curva, graduati ${g.length}, in utile ${o.token.filter(s => s.pnl > 0).length}, ${o.token.reduce((a, s) => a + s.pnl, 0).toFixed(2)} SOL, ${chiamate - c0} chiamate`);
      } catch (e) { console.error('ERR', w, e.stack.slice(0, 300)); if (/crediti esauriti/.test(e.message)) break; }
      if (chiamate + altre >= LIMITE) { console.log('limite di chiamate raggiunto'); break; }
    }
    console.log('chiamate Helius in tutto', chiamate, 'gTFA +', altre, 'altre'); process.exit(0);
  }
  if (mints[0] === 'registro') {
    // graduati pump.fun non ancora studiati o studiati col vecchio schema (versione < 2), i piu' recenti prima;
    // fuori i lanci a pacchetto (nati e graduati in meno di 10 secondi: in bonding non c'era nulla da comprare)
    const n = +(mints[1] || 15), m = +(mints[2] || 0), ora = Date.now() / 1000;
    const ver = mt => { try { return leggi(`bonding/token/${mt}.json`).versione || 1; } catch (e) { return 0; } };
    const g = Object.values(R).filter(r => r.stato === 'graduato' && r.fonte === 'pumpfun' && r.graduato_at && r.creato && r.graduato_at - r.creato >= 10 && ver(r.mint) < 2)
      .sort((a, b) => b.graduato_at - a.graduato_at).slice(0, n);
    const f = Object.values(R).filter(r => r.stato !== 'graduato' && r.fonte === 'pumpfun' && r.creato && ora - r.creato > 12 * 3600 && r.bp_max >= 75 && !ver(r.mint))
      .sort((a, b) => b.creato - a.creato).slice(0, m);
    mints = [...g, ...f].map(r => r.mint);
    console.log(`da studiare ${mints.length}; lanci a pacchetto esclusi ${Object.values(R).filter(r => r.stato === 'graduato' && r.fonte === 'pumpfun' && r.graduato_at - r.creato < 10).length}`);
  }
  for (const m of mints) {
    if (chiamate + altre >= LIMITE - 150) { console.log(`limite di chiamate vicino (${chiamate} gTFA + ${altre} altre): mi fermo prima di ${m}`); break; }
    const c0 = chiamate, a0 = altre;
    try {
      const o = await studia(m, R); o.chiamate_helius = chiamate - c0; o.chiamate_altre = altre - a0; o.studiato = Math.floor(Date.now() / 1000);
      scrivi(`bonding/token/${m}.json`, o); const ra = o.riassunto;
      console.log(`${o.sym || m.slice(0, 6)}: ${o.n_tx} tx, graduation ${o.grad ? new Date(o.grad.t * 1000).toISOString().slice(11, 19) + ' dopo ' + Math.round(o.grad.durata_s / 60) + ' min' : 'no'}, ${o.compratori} compratori in bonding + ${ra.compratori_dopo} dopo (finestra ${ra.finestra_dopo_s}s${ra.finestra_completa ? '' : ', tagliata'}), seguiti ${ra.seguiti}, ${o.fomo_conti.length} wallet fomo, ${o.chiamate_helius} chiamate${o.parziale ? ' (parziale: ' + o.parziale + ')' : ''}`);
    } catch (e) { console.error('ERR', m, e.stack.slice(0, 300)); if (/crediti esauriti/.test(e.message)) break; }
  }
  console.log('chiamate Helius in tutto', chiamate, 'gTFA +', altre, 'altre');
  process.exit(0);
})();
