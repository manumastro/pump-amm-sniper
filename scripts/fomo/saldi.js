// Controprova: la posizione piu' grande che fomo dichiara per ogni utente esiste sul wallet vero?
// Solana: getTokenAccountsByOwner; EVM (Robinhood, Ethereum, Base, BSC): alchemy_getTokenBalances.
// Uso: node saldi.js [id...]   (senza id: i 150 delle tre classifiche dell'ultima lettura)
const fs = require('fs'); const path = require('path');
const { DATI, rpc, leggi, scrivi, RETI_EVM } = require('./comune');
const W = leggi('wallet.json');
const cl = fs.readdirSync(path.join(DATI, 'classifiche')).sort().at(-1); const L = leggi('classifiche/' + cl);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : [...new Set(['24h', '7d', '30d'].flatMap(p => (L[p] || []).map(x => x.id)))];
(async () => {
  const out = [];
  for (const u of ids) {
    const v = leggi(`utenti/${u}.json`, null); const w = W[u]; if (!v || !w) continue;
    const bal = (v.bal || []).filter(b => b.tok && b.q > 0 && b.px > 0 && (b.net === 1399811149 ? w.sol : RETI_EVM.includes(b.net) && w.evm) && !['USDC', 'USDT', 'USDG', 'SOL'].includes((b.sym || '').toUpperCase()))
      .sort((a, b) => b.q * b.px - a.q * a.px);
    const b = bal[0]; if (!b || b.q * b.px < 1000) continue;
    try {
      let reale;
      if (b.net === 1399811149) {
        const r = await rpc('sol', 'getTokenAccountsByOwner', [w.sol, { mint: b.tok }, { encoding: 'jsonParsed' }]);
        reale = r.value.reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
      } else {
        const r = await rpc(b.net, 'alchemy_getTokenBalances', [w.evm, [b.tok]]);
        const dec = parseInt(await rpc(b.net, 'eth_call', [{ to: b.tok, data: '0x313ce567' }, 'latest']), 16);
        reale = Number(BigInt(r.tokenBalances[0].tokenBalance || '0x0')) / 10 ** dec;
      }
      out.push({ u, h: v.profilo && v.profilo.handle, net: b.net, sym: b.sym, fomo: b.q, reale, valore: b.q * b.px });
    } catch (e) { out.push({ u, net: b.net, err: e.message.slice(0, 80) }); }
  }
  scrivi(`risultati/saldi-${cl}`, out);
  const ok = out.filter(r => r.reale != null), ug = ok.filter(r => Math.abs(r.reale - r.fomo) / r.fomo < 0.01);
  const per = {}; for (const r of ok) { const k = r.net; per[k] = per[k] || [0, 0]; per[k][0]++; if (Math.abs(r.reale - r.fomo) / r.fomo < 0.01) per[k][1]++; }
  console.log(`controllati ${ok.length}, uguali entro l'1% ${ug.length}, valore $${Math.round(ok.reduce((s, r) => s + r.valore, 0)).toLocaleString('it')}, errori ${out.length - ok.length}`);
  console.log('per rete (controllati, uguali):', JSON.stringify(per));
  for (const r of ok.filter(r => Math.abs(r.reale - r.fomo) / r.fomo >= 0.01).slice(0, 10)) console.log('  diverso', r.h, r.sym, r.net, 'fomo', r.fomo, 'catena', r.reale);
})();
