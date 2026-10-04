// Ritrova i wallet veri degli utenti che non li hanno ancora (dati/fomo/wallet.json).
// Solana: 1) dai saldi: fra i 20 conti maggiori del token, quello col saldo dichiarato da fomo;
//         2) dal token: le tx del mint in +-40 s dallo swap fomo (Helius getTransactionsForAddress),
//            l'owner che riceve la quantita' esatta e firma. Poi la conferma: una tx co-firmata da fomo.
// EVM (stesso indirizzo su Robinhood, Ethereum, Base, BSC): dai log Transfer del token su Robinhood
//         in +-400 blocchi dallo swap; l'indirizzo con la quantita' esatta e codice 0xef0100 (EIP-7702).
// Uso: node wallet.js [id...]   (senza id: tutti gli utenti in dati/fomo/utenti)
const fs = require('fs'); const path = require('path');
const { DATI, rpc, leggi, scrivi, CO } = require('./comune');
const W = leggi('wallet.json', {});
const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(DATI, 'utenti')).map(f => f.slice(0, -5));
const QUOTE = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112']);
async function cofirmato(w) {
  const s = await rpc('sol', 'getSignaturesForAddress', [w, { limit: 40 }]);
  for (const x of s.slice(0, 25)) {
    const t = await rpc('sol', 'getTransaction', [x.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]);
    if (t && t.transaction.message.accountKeys.some(k => k.signer && k.pubkey === CO)) return true;
  }
  return false;
}
async function solDaiSaldi(v) {
  const bal = (v.bal || []).filter(b => b.net === 1399811149 && b.q > 0 && b.mcap > 0 && b.px > 0 && !['USDC', 'SOL', 'USDT'].includes((b.sym || '').toUpperCase()))
    .sort((a, b) => b.q * b.px / b.mcap - a.q * a.px / a.mcap).slice(0, 4);
  for (const b of bal) {
    const big = await rpc('sol', 'getTokenLargestAccounts', [b.tok]);
    const hit = big.value.find(a => a.uiAmount && Math.abs(a.uiAmount - b.q) / b.q < 1e-3);
    if (!hit) continue;
    const acc = await rpc('sol', 'getAccountInfo', [hit.address, { encoding: 'jsonParsed' }]);
    return acc.value.data.parsed.info.owner;
  }
}
async function solDalToken(v) {
  const buys = (v.swaps || []).filter(s => s.net === 1399811149 && QUOTE.has(s.i) && !QUOTE.has(s.o) && s.oa > 0).reverse();
  const visti = new Set();
  for (const b of buys) {
    if (visti.has(b.o)) continue; visti.add(b.o); if (visti.size > 4) break;
    const t = Date.parse(b.t) / 1000;
    const r = await rpc('helius', 'getTransactionsForAddress', [b.o, { transactionDetails: 'full', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, sortOrder: 'asc', limit: 100,
      filters: { blockTime: { gte: Math.floor(t - 40), lte: Math.ceil(t + 40) }, status: 'succeeded' } }]);
    for (const x of r.data) {
      const per = {};
      for (const z of x.meta.preTokenBalances || []) if (z.mint === b.o) per[z.owner] = (per[z.owner] || 0) - (z.uiTokenAmount.uiAmount || 0);
      for (const z of x.meta.postTokenBalances || []) if (z.mint === b.o) per[z.owner] = (per[z.owner] || 0) + (z.uiTokenAmount.uiAmount || 0);
      const firm = x.transaction.message.accountKeys.filter(k => k.signer).map(k => k.pubkey);
      for (const [o, d] of Object.entries(per)) if (d > 0 && Math.abs(d - b.oa) / b.oa < 1e-4 && firm.includes(o)) return o;
    }
  }
}
let rif = null;
async function bloccoRh(t) {
  if (!rif) { const n1 = parseInt(await rpc(4663, 'eth_blockNumber', []), 16); const b1 = await rpc(4663, 'eth_getBlockByNumber', ['0x' + n1.toString(16), false]);
    const n0 = n1 - 5e6; const b0 = await rpc(4663, 'eth_getBlockByNumber', ['0x' + n0.toString(16), false]); rif = { n0, n1, t0: parseInt(b0.timestamp, 16), t1: parseInt(b1.timestamp, 16) }; }
  let n = Math.round(rif.n0 + (t - rif.t0) * (rif.n1 - rif.n0) / (rif.t1 - rif.t0));
  for (let k = 0; k < 4; k++) { const b = await rpc(4663, 'eth_getBlockByNumber', ['0x' + n.toString(16), false]); const bt = parseInt(b.timestamp, 16); if (Math.abs(bt - t) <= 20) break; n += Math.round((t - bt) * (rif.n1 - rif.n0) / (rif.t1 - rif.t0)); }
  return n;
}
async function evmDaiLog(v) {
  const sw = (v.swaps || []).filter(s => s.net === 4663 && (s.i || '').startsWith('0x') !== (s.o || '').startsWith('0x')).reverse();
  const visti = new Set();
  for (const s of sw) {
    const tok = (s.i || '').startsWith('0x') ? s.i : s.o; const q = tok === s.i ? s.ia : s.oa;
    if (visti.has(tok) || !q) continue; visti.add(tok); if (visti.size > 4) break;
    const b = await bloccoRh(Date.parse(s.t) / 1000);
    const logs = await rpc('rhpub', 'eth_getLogs', [{ address: tok, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'], fromBlock: '0x' + (b - 400).toString(16), toBlock: '0x' + (b + 400).toString(16) }]);
    const dec = parseInt(await rpc(4663, 'eth_call', [{ to: tok, data: '0x313ce567' }, 'latest']), 16);
    for (const l of logs) {
      if (Math.abs(Number(BigInt(l.data)) / 10 ** dec - q) / q >= 1e-4) continue;
      const w = '0x' + (tok === s.o ? l.topics[2] : l.topics[1]).slice(26);
      if ((await rpc(4663, 'eth_getCode', [w, 'latest'])).startsWith('0xef0100')) return w;
    }
  }
}
(async () => {
  let n = 0, sol = 0, evm = 0;
  for (const u of ids) {
    const v = leggi(`utenti/${u}.json`, null); if (!v) continue;
    const w = W[u] = W[u] || {};
    try {
      if (!w.sol && !w.sol_provato) {
        let s = await solDaiSaldi(v), metodo = 'saldi';
        if (!s) { s = await solDalToken(v); metodo = 'token'; }
        if (s && await cofirmato(s)) { w.sol = s; w.sol_metodo = metodo; sol++; } else w.sol_provato = new Date().toISOString();
      }
      if (!w.evm && !w.evm_provato) { const e = await evmDaiLog(v); if (e) { w.evm = e.toLowerCase(); evm++; } else w.evm_provato = new Date().toISOString(); }
    } catch (e) { console.error('ERR', u, e.message.slice(0, 120)); if (/crediti esauriti/.test(e.message)) break; }
    if (++n % 10 === 0) scrivi('wallet.json', W);
  }
  scrivi('wallet.json', W);
  console.log(`wallet nuovi: solana ${sol}, evm ${evm}; registro: solana ${Object.values(W).filter(x => x.sol).length}, evm ${Object.values(W).filter(x => x.evm).length}`);
})();
