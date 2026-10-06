// Scarica da fomo tutto il profilo di uno o piu' utenti (profilo, classifica, spotlight, saldi, curva
// a 30 giorni, swap, trasferimenti, trade con PnL) in dati/fomo/profili/<handle>.json, passando dal
// client di fomo-mcp (Chrome headless: il fetch semplice viene bloccato). Token da ~/.config/fomo-mcp/token.
// Uso: node scripts/fomo/profilo.mjs <handle> [<handle> ...]
const fs = await import('fs');
process.env.FOMO_TOKEN_FILE = process.env.HOME + '/.config/fomo-mcp/token';
const { FomoClient } = await import(process.env.HOME + '/fomo-mcp/dist/client.js');
const c = new FomoClient('x');
const g = (p, q) => c.get(p, q);
const DIR = new URL('../../dati/fomo/profili/', import.meta.url).pathname; fs.mkdirSync(DIR, { recursive: true });
for (const h of process.argv.slice(2)) {
const u = await g(`/v2/users/userHandle/${encodeURIComponent(h)}`); const id = u.id, out = DIR + h + '.json';
const R = { id };
R.profilo = await g(`/v2/users/${id}`);
R.rank = await g(`/v2/users/${id}/leaderboard`);
R.spotlight = await g(`/v2/users/${id}/spotlight`);
R.bal = await g(`/v2/users/${id}/balances`);
R.curva = await g('/v2/userTokens/aggregatedSnapshot', { userId: id, timestamp: new Date(Date.now() - 30 * 86400e3).toISOString() });
const sw = []; let last; for (let n = 0; n < 200; n++) { const r = await g(`/v2/users/${id}/swaps`, last ? { lastSwapIdV2: last } : {}); if (!r?.swaps?.length) break; sw.push(...r.swaps); last = r.swaps.at(-1).id; if (!r.hasNextPage) break; }
R.swaps = sw;
const tr = []; let lt; for (let n = 0; n < 40; n++) { const r = await g(`/v2/users/${id}/transfers`, lt ? { lastTransferId: lt } : {}); if (!r?.transfers?.length) break; tr.push(...r.transfers); lt = r.transfers.at(-1).id; if (!r.hasNextPage) break; }
R.transfers = tr;
const td = []; let ltr; for (let n = 0; n < 40; n++) { const r = await g('/trades', { userId: id, ...(ltr ? { lastTradeId: ltr } : {}) }); const L = [...(r?.activeTrades || []), ...(r?.closedTrades || [])]; if (!L.length) break; td.push(...L); ltr = (r.closedTrades || []).at(-1)?.id; if (!r.hasNextPage || !ltr) break; }
R.trades = td;
fs.writeFileSync(out, JSON.stringify(R));
console.log(h, id, 'swap', sw.length, 'trasferimenti', tr.length, 'trade', td.length);
}
process.exit(0);
