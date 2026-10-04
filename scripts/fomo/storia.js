// Storie on-chain incrementali, da dove si erano fermate (campo "fino").
// Solana: il conto USDC del wallet (ogni swap fomo, gamba Relay e pagamento passa di li', lo spam no),
//   con Helius getTransactionsForAddress filtrato per orario (100 tx complete per chiamata);
//   se Helius non risponde, Alchemy getSignaturesForAddress + getTransaction (lento: 300 CU/s).
// EVM: alchemy_getAssetTransfers in entrata e in uscita su Robinhood, Ethereum, Base e BSC.
// Uso: node storia.js [sol|evm] [id...]   (senza id: tutti quelli col wallet)
const { PublicKey } = require('@solana/web3.js');
const { rpc, leggi, scrivi, USDC, RETI_EVM } = require('./comune');
const [quale = 'tutte', ...scelti] = process.argv.slice(2);
const W = leggi('wallet.json');
const ids = scelti.length ? scelti : Object.keys(W);
const ORA = Math.floor(Date.now() / 1000), INIZIO = ORA - 30 * 86400;
const conto = w => PublicKey.findProgramAddressSync([new PublicKey(w).toBuffer(), new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(), new PublicKey(USDC).toBuffer()], new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0].toBase58();
function riga(t, w) {
  const keys = t.transaction.message.accountKeys; const idx = keys.findIndex(k => k.pubkey === w);
  const tok = {};
  for (const b of t.meta.preTokenBalances || []) if (b.owner === w) tok[b.mint] = (tok[b.mint] || 0) - (b.uiTokenAmount.uiAmount || 0);
  for (const b of t.meta.postTokenBalances || []) if (b.owner === w) tok[b.mint] = (tok[b.mint] || 0) + (b.uiTokenAmount.uiAmount || 0);
  for (const k of Object.keys(tok)) if (Math.abs(tok[k]) < 1e-9) delete tok[k];
  return { sig: t.transaction.signatures[0], t: t.blockTime, firm: keys.find(k => k.signer).pubkey, sol: idx >= 0 ? (t.meta.postBalances[idx] - t.meta.preBalances[idx]) / 1e9 : 0, tok };
}
let helius = true;
async function nuoveSol(w, da) {
  const a = conto(w), out = [];
  if (helius) {
    try {
      let tok;
      for (let p = 0; p < 300; p++) {
        const cfg = { transactionDetails: 'full', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, sortOrder: 'asc', limit: 100, filters: { blockTime: { gte: da + 1, lte: ORA }, status: 'succeeded' } };
        if (tok) cfg.paginationToken = tok;
        const r = await rpc('helius', 'getTransactionsForAddress', [a, cfg]);
        for (const x of r.data) out.push(riga(x, w));
        tok = r.paginationToken; if (!tok) return out;
      }
      return out;
    } catch (e) { if (/crediti esauriti/.test(e.message)) { helius = false; console.error('Helius esaurito: passo ad Alchemy'); } else throw e; }
  }
  let before; const firme = [];
  for (let p = 0; p < 100; p++) {
    const r = await rpc('sol', 'getSignaturesForAddress', [a, { limit: 1000, before }]);
    let stop = !r.length;
    for (const s of r) { if (s.blockTime && s.blockTime <= da) { stop = true; break; } if (!s.err) firme.push(s.signature); }
    if (stop || r.length < 1000) break; before = r.at(-1).signature;
  }
  for (const s of firme) { const x = await rpc('sol', 'getTransaction', [s, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]); if (x && !x.meta.err) out.push(riga(x, w)); }
  return out;
}
async function nuoveEvm(w, rete, da) {
  const out = [];
  for (const lato of [1, -1]) {
    let pageKey;
    for (let p = 0; p < 50; p++) {
      const par = { fromBlock: '0x0', toBlock: 'latest', category: ['erc20'], withMetadata: true, excludeZeroValue: true, maxCount: '0x3e8', order: 'desc' };
      par[lato === 1 ? 'toAddress' : 'fromAddress'] = w; if (pageKey) par.pageKey = pageKey;
      const r = await rpc(rete, 'alchemy_getAssetTransfers', [par]);
      let stop = false;
      for (const x of r.transfers) {
        const t = Date.parse(x.metadata.blockTimestamp) / 1000; if (t <= da) { stop = true; break; }
        const dec = x.rawContract.decimal ? parseInt(x.rawContract.decimal, 16) : 18;
        out.push({ rete, tok: x.rawContract.address, sym: x.asset, q: lato * Number(BigInt(x.rawContract.value)) / 10 ** dec, t, b: parseInt(x.blockNum, 16), tx: x.hash, contro: lato === 1 ? x.from : x.to });
      }
      pageKey = r.pageKey; if (stop || !pageKey) break;
    }
  }
  return out;
}
(async () => {
  let n = 0, righe = 0;
  for (const u of ids) {
    const w = W[u]; if (!w) continue;
    try {
      if (w.sol && quale !== 'evm') {
        const f = `catena/sol/${u}.json`; const c = leggi(f, { wallet: w.sol, righe: [], fino: INIZIO });
        const nuove = await nuoveSol(w.sol, Math.max(c.fino || 0, INIZIO));
        const viste = new Set(c.righe.map(r => r.sig)); for (const r of nuove) if (!viste.has(r.sig)) { c.righe.push(r); righe++; }
        c.fino = ORA; c.n = c.righe.length; scrivi(f, c);
      }
      if (w.evm && quale !== 'sol') {
        const f = `catena/evm/${u}.json`; const c = leggi(f, { wallet: w.evm, righe: [], fino: {} });
        if (typeof c.fino !== 'object') c.fino = {};
        for (const rete of RETI_EVM) {
          const nuove = await nuoveEvm(w.evm, rete, Math.max(c.fino[rete] || 0, INIZIO));
          const viste = new Set(c.righe.map(r => `${r.tx}|${r.tok}|${r.q}`)); for (const r of nuove) if (!viste.has(`${r.tx}|${r.tok}|${r.q}`)) { c.righe.push(r); righe++; }
          c.fino[rete] = ORA;
        }
        scrivi(f, c);
      }
    } catch (e) { console.error('ERR', u, e.message.slice(0, 120)); }
    if (++n % 25 === 0) console.log(n, '/', ids.length, 'righe nuove', righe, new Date().toISOString());
  }
  console.log('fine', n, 'utenti, righe nuove', righe);
})();
