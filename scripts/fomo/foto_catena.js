// Fotografia dalla catena dei token che i seguiti scambiano (servi.py salva in segui/<giorno>.jsonl
// solo lato, token, rete e ora): prezzo e liquidita' all'istante dello swap e 15 minuti, 1 ora e 6 ore
// dopo, quando sono passati. Solana con prezzi_catena.js (Helius), le reti EVM con prezzi_evm.js
// (il pool si ritrova dalle transazioni del token in catena/evm). Si rilancia quando si vuole: misura
// solo i punti mancanti. Uscita: segui/<giorno>.catena.json, id dello swap -> {u, h, tok, net, lato, t, punti}
// Uso: node foto_catena.js [giorno ...]   (senza: gli ultimi 2 giorni)
const fs = require('fs'); const path = require('path');
const { DATI, leggi, scrivi } = require('./comune');
const sol = require('./prezzi_catena');
const evm = require('./prezzi_evm');
const PUNTI = { 0: 0, '15m': 900, '1h': 3600, '6h': 21600 };
const giorni = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(path.join(DATI, 'segui')).filter(f => f.endsWith('.jsonl')).sort().slice(-2).map(f => f.slice(0, -6));
// prezzo in vigore all'istante: l'ultimo scambio prima (entro 6 ore), se no il primo dopo (entro 15 minuti)
async function prezzo(r, t, txs) {
  if (r.net === 1399811149) {
    let x = await sol.punto(r.tok, t, 15, 'desc'); if (x && x.px && x.t <= t && t - x.t < 6 * 3600) return x;
    x = await sol.punto(r.tok, t, 15); return x && x.px && Math.abs(x.t - t) < 900 ? x : null;
  }
  const x = await evm.punto(r.tok, t, txs, r.net); return x && x.px ? x : null;
}
(async () => {
  const ora = Date.now() / 1000; let n = 0;
  const R = Object.fromEntries(giorni.filter(g => fs.existsSync(path.join(DATI, `segui/${g}.jsonl`)))
    .map(g => [g, fs.readFileSync(path.join(DATI, `segui/${g}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))]));
  // le transazioni dei token EVM (per ritrovarne il pool), una sola lettura di catena/evm
  const evmTok = new Set(Object.values(R).flat().filter(x => x.foto && x.foto.tok && evm.RETI[x.foto.net]).map(x => x.foto.net + ':' + x.foto.tok.toLowerCase()));
  const TX = evmTok.size ? evm.txDeiToken(evmTok) : {};
  for (const [g, righe] of Object.entries(R)) {
    const fo = `segui/${g}.catena.json`, O = leggi(fo, {});
    for (const r of righe) {
      const fo1 = r.foto; if (!fo1 || !fo1.tok || !r.s) continue;
      const net = +fo1.net, tok = net === 1399811149 ? fo1.tok : fo1.tok.toLowerCase();
      const o = O[r.s.id] = O[r.s.id] || { u: r.u, h: r.h, tok, net, lato: fo1.lato, t: Date.parse(r.s.t) / 1000, punti: {} };
      if (net !== 1399811149 && !evm.RETI[net]) { o.errore = 'rete senza modulo'; continue; }
      let txs = null;
      if (net !== 1399811149) txs = TX[net + ':' + tok] || [];   // senza ricevute il pool si cerca nelle factory
      for (const [k, dt] of Object.entries(PUNTI)) {
        if (o.punti[k] !== undefined || o.t + dt > ora - 60) continue;   // gia' misurato o non ancora passato
        try { const x = await prezzo({ tok, net }, o.t + dt, txs); o.punti[k] = x ? { t: x.t, px: x.px, liq: x.liq ?? null, liq_tot: x.liq_tot ?? null } : null; n++; }
        catch (e) { console.error('ERR', r.s.id, k, e.message.slice(0, 80)); }
      }
      delete o.errore; scrivi(fo, O);
    }
    console.log(`${fo}: ${Object.keys(O).length} swap`);
  }
  console.log(`${n} punti misurati`);
})();
