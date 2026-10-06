// Prezzo e liquidita' di un token Solana in un istante, solo dalla catena (Helius
// getTransactionsForAddress sul mint, dalle transazioni subito dopo l'istante).
// In ogni transazione, per ogni proprietario, le variazioni di saldo: chi scambia il token contro
// USDC da' il prezzo in dollari; contro SOL (wSOL o SOL nativo, come le curve pump.fun) il prezzo in
// SOL, convertito col prezzo del SOL letto sul pool SOL/USDC di Raydium. Il pool del token e' il
// proprietario con lo scambio opposto e il saldo di token piu' grande: le sue riserve danno la liquidita'.
const { rpc } = require('./comune');
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', WSOL = 'So11111111111111111111111111111111111111112';
const RIF_SOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';   // Raydium AMM SOL/USDC
const mediana = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
// verso 'asc': le transazioni subito dopo t; 'desc': le ultime prima di t
const txDopo = (addr, t, n, verso = 'asc') => rpc('helius', 'getTransactionsForAddress', [addr, { transactionDetails: 'full', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, sortOrder: verso, limit: n,
  filters: { blockTime: verso === 'asc' ? { gte: Math.floor(t) } : { lte: Math.floor(t) }, status: 'succeeded' } }]);
function variazioni(x) {
  const per = {}, post = {};
  const add = (o, m, v) => { (per[o] = per[o] || {})[m] = (per[o][m] || 0) + v; };
  for (const b of x.meta.preTokenBalances || []) add(b.owner, b.mint, -(b.uiTokenAmount.uiAmount || 0));
  for (const b of x.meta.postTokenBalances || []) { add(b.owner, b.mint, b.uiTokenAmount.uiAmount || 0); (post[b.owner] = post[b.owner] || {})[b.mint] = b.uiTokenAmount.uiAmount || 0; }
  // SOL nativo dei proprietari che compaiono fra gli account (curve pump.fun, wallet)
  x.transaction.message.accountKeys.forEach((k, i) => {
    if (!per[k.pubkey]) return;
    per[k.pubkey].SOL = (x.meta.postBalances[i] - x.meta.preBalances[i]) / 1e9;
    (post[k.pubkey] = post[k.pubkey] || {}).SOL = x.meta.postBalances[i] / 1e9;
  });
  return { per, post };
}
const cacheSol = {};
async function solUsd(t) {
  const k = Math.floor(t / 600);
  if (cacheSol[k] === undefined) {
    const r = await txDopo(RIF_SOL, t, 40); const px = [];
    for (const x of r.data) for (const d of Object.values(variazioni(x).per))
      if (d[USDC] && d[WSOL] && Math.sign(d[USDC]) !== Math.sign(d[WSOL]) && Math.abs(d[WSOL]) > 0.01) px.push(Math.abs(d[USDC] / d[WSOL]));
    cacheSol[k] = mediana(px);
  }
  return cacheSol[k];
}
// {t, px, liq, n}: px in dollari, liq = due volte la riserva in contante del pool, t = ora della prima tx usata.
// dove: l'indirizzo di cui leggere le transazioni (di solito il mint; per il SOL il pool di riferimento,
// perche' quelle del mint wSOL sono quasi tutte aperture e chiusure di conti)
async function punto(mint, t, n = 25, verso = 'asc', dove = mint) {
  const r = await txDopo(dove, t, n, verso); if (!r.data.length) return null;
  const usd = [], sol = [], pool = {};
  for (const x of r.data) {
    const { per, post } = variazioni(x);
    const firmatari = new Set(x.transaction.message.accountKeys.filter(k => k.signer).map(k => k.pubkey));
    for (const [o, d] of Object.entries(per)) {
      const m = d[mint]; if (!m || Math.abs(m) < 1e-9) continue;
      for (const [q, lista] of [[USDC, usd], [WSOL, sol], ['SOL', sol]]) {
        if (q === mint || (mint === WSOL && q === 'SOL')) continue;   // incartare il SOL non e' uno scambio
        const v = d[q]; if (!v || Math.sign(v) === Math.sign(m)) continue;
        lista.push(Math.abs(v / m));
        // un pool scambia senza firmare: le sue riserve dopo la tx sono la liquidita'
        const contante = (post[o] || {})[q] || 0, riserva = (post[o] || {})[mint] || 0;
        if (!firmatari.has(o) && contante > 0 && riserva > 0) pool[o + q] = { quota: q, contante };
      }
    }
  }
  const s = sol.length || Object.values(pool).some(p => p.quota !== USDC) ? await solUsd(r.data[0].blockTime) : null;
  const pxUsd = usd.length >= sol.length ? mediana(usd) : (s ? mediana(sol) * s : mediana(usd));
  const liqPool = Object.values(pool).map(p => 2 * (p.quota === USDC ? p.contante : (s || 0) * p.contante));
  return { t: r.data[0].blockTime, px: pxUsd, liq: liqPool.length ? Math.max(...liqPool) : null, liq_tot: liqPool.reduce((a, b) => a + b, 0) || null, pool: liqPool.length, n: usd.length + sol.length };
}
module.exports = { punto, solUsd, RIF_SOL, WSOL };

// Da riga di comando: riscrive dalla catena prezzo e liquidita' dei token Solana di un file prezzi
// (o di tutte le posizioni salvate). Il SOL dal pool di riferimento SOL/USDC.
// Uso: node prezzi_catena.js [prezzi/<file>.json]   (senza: un file nuovo con le posizioni di tutti)
if (require.main === module) {
  const fs = require('fs'); const path = require('path');
  const { DATI, leggi, scrivi } = require('./comune');
  (async () => {
    const f = process.argv[2];
    const P = f ? leggi(f) : {};
    const mint = new Set(Object.keys(P).filter(k => k.startsWith('1399811149:')).map(k => k.split(':')[1]));
    // solo i token di cui qualcuno tiene almeno $50 (al prezzo di fomo): il resto sono briciole e spam
    const valore = {};
    for (const u of fs.readdirSync(path.join(DATI, 'utenti'))) for (const b of (leggi('utenti/' + u).bal || []))
      if (b.net === 1399811149 && b.tok && b.q && !['USDC', 'USDT'].includes((b.sym || '').toUpperCase())) valore[b.tok] = Math.max(valore[b.tok] || 0, b.q * (b.px || 0));
    for (const m of [...mint]) if ((valore[m] || 0) < 50) mint.delete(m);
    if (!f) for (const [m, v] of Object.entries(valore)) if (v >= 50) mint.add(m);
    const ora = Math.floor(Date.now() / 1000); let n = 0, vuoti = 0;
    for (const m of mint) {
      try {
        const x = m === WSOL ? await punto(m, ora, 40, 'desc', RIF_SOL) : await punto(m, ora, 20, 'desc');
        if (x && x.px && ora - x.t < 7 * 86400) P['1399811149:' + m] = { px: x.px, liq: x.liq || 0, liq_tot: x.liq_tot || x.liq || 0, pool: x.pool, fonte: 'catena', ora: x.t };
        else { P['1399811149:' + m] = null; vuoti++; }   // nessuno scambio da una settimana: non si vende
      } catch (e) { console.error('ERR', m, e.message.slice(0, 60)); }
      if (++n % 200 === 0) console.log(n, '/', mint.size);
    }
    const out = f || `prezzi/${new Date().toISOString().slice(0, 16).replace(':', '')}.json`;
    scrivi(out, P); console.log(`${out}: ${mint.size} token Solana dalla catena, ${vuoti} morti (nessuno scambio da 7 giorni)`);
  })();
}
