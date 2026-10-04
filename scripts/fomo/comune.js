// Basi comuni della pipeline fomo: chiavi da .env.fomo (mai dal .env dello sniper), cartella dati,
// chiamate RPC con un regolatore di frequenza per fornitore (Alchemy gratuito: 300 CU/s in tutto).
// Solana: Helius per tutto, Alchemy come riserva quando Helius finisce i crediti.
const fs = require('fs');
const path = require('path');
const RADICE = path.resolve(__dirname, '../..');
const DATI = process.env.FOMO_DATI || path.join(RADICE, 'dati/fomo');
const env = Object.fromEntries(fs.readFileSync(path.join(RADICE, '.env.fomo'), 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL = {
  sol: `https://solana-mainnet.g.alchemy.com/v2/${env.FOMO_ALCHEMY_KEY}`,
  helius: `https://mainnet.helius-rpc.com/?api-key=${env.FOMO_HELIUS_KEY}`,
  4663: `https://robinhood-mainnet.g.alchemy.com/v2/${env.FOMO_ALCHEMY_KEY}`,
  1: `https://eth-mainnet.g.alchemy.com/v2/${env.FOMO_ALCHEMY_KEY}`,
  8453: `https://base-mainnet.g.alchemy.com/v2/${env.FOMO_ALCHEMY_KEY}`,
  56: `https://bnb-mainnet.g.alchemy.com/v2/${env.FOMO_ALCHEMY_KEY}`,
  rhpub: 'https://rpc.mainnet.chain.robinhood.com',
};
// un regolatore per fornitore: tutte le reti Alchemy condividono lo stesso tetto
const FORNITORE = k => (k === 'helius' ? 'helius' : k === 'rhpub' ? 'rhpub' : 'alchemy');
const PASSO = { alchemy: 1000 / +(process.env.ALCHEMY_PER_SEC || 10), helius: 1000 / +(process.env.HELIUS_PER_SEC || 8), rhpub: 1000 / 3 };
const reg = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function turno(f) {
  const g = reg[f] = reg[f] || { prossimo: 0, fermo: 0 };
  for (;;) {
    const ora = Date.now();
    if (ora < g.fermo) { await sleep(g.fermo - ora); continue; }
    if (ora >= g.prossimo) { g.prossimo = Math.max(ora, g.prossimo) + PASSO[f]; return; }
    await sleep(g.prossimo - ora);
  }
}
// Solana passa da Helius (piu' veloce); a crediti finiti, da solo su Alchemy.
let heliusFinito = false;
async function rpc(rete, method, params) {
  if (rete === 'sol' && !heliusFinito) {
    try { return await rpc1('helius', method, params); }
    catch (e) { if (!/crediti esauriti/.test(e.message)) throw e; heliusFinito = true; console.error('Helius esaurito: Solana passa ad Alchemy'); }
  }
  if (rete === 'helius' && heliusFinito) throw new Error('crediti esauriti: helius');
  return rpc1(rete, method, params);
}
async function rpc1(rete, method, params) {
  const f = FORNITORE(rete);
  for (let t = 0; t < 10; t++) {
    try {
      await turno(f);
      const r = await fetch(URL[rete], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (r.status === 429) { reg[f].fermo = Date.now() + (f === 'rhpub' ? 61000 : 1500 * (t + 1)); continue; }
      const testo = await r.text(); if (!testo.startsWith('{')) { await sleep(1000 * (t + 1)); continue; }
      const j = JSON.parse(testo);
      if (j.error) {
        const m = typeof j.error === 'string' ? j.error : (j.error.message || '');
        if (/max usage reached/i.test(m)) throw new Error('crediti esauriti: ' + rete);
        if (j.error.code === 429 || /rate.?limit|too many requests/i.test(m)) { reg[f].fermo = Date.now() + (f === 'rhpub' ? 61000 : 1500 * (t + 1)); continue; }
        const err = new Error(m.slice(0, 200)); err.definitivo = true; throw err;   // errore dell'RPC: ripetere non serve
      }
      return j.result;
    } catch (e) { if (t === 9 || e.definitivo || /crediti esauriti|invalid|not enabled/i.test(e.message)) throw e; await sleep(800 * (t + 1)); }
  }
  throw new Error('troppi tentativi ' + rete + ' ' + method);
}
const leggi = (f, def) => { try { return JSON.parse(fs.readFileSync(path.join(DATI, f))); } catch (e) { if (def !== undefined) return def; throw e; } };
const scrivi = (f, v) => { fs.mkdirSync(path.dirname(path.join(DATI, f)), { recursive: true }); fs.writeFileSync(path.join(DATI, f), JSON.stringify(v)); };
const CO = 'AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RETI_EVM = [4663, 1, 8453, 56];
module.exports = { RADICE, DATI, rpc, leggi, scrivi, sleep, CO, USDC, RETI_EVM };
