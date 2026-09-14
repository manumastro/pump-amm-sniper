#!/usr/bin/env node
// Chi ha comprato, dal flusso registrato da scripts/stonk-compratori.js.
// Un argomento = un portafoglio da guardare nel dettaglio; senza, la classifica.

const fs = require('fs');
const path = require('path');

const FILE = path.join(process.cwd(), 'logs', 'stonk-compratori.jsonl');
const pct = (x, d = 2) => `${(100 * x).toFixed(d)}%`;
const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) * p)] : null);

if (!fs.existsSync(FILE)) { console.log('nessun dato: avvia scripts/stonk-compratori.js'); process.exit(0); }
const righe = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean)
  .map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
if (!righe.length) { console.log('nessun acquisto registrato'); process.exit(0); }

const solo = process.argv[2];
const ore = (Math.max(...righe.map((r) => r.t)) - Math.min(...righe.map((r) => r.t))) / 3600000;

if (solo) {
  const sue = righe.filter((r) => r.portafoglio.startsWith(solo));
  if (!sue.length) { console.log('nessun acquisto di', solo); process.exit(0); }
  console.log(`${sue[0].portafoglio}\n${sue.length} acquisti su ${new Set(sue.map((r) => r.pool)).size} curve\n`);
  console.log('ora        quota    la curva era a    dopo      pool');
  for (const r of sue) {
    console.log(new Date(r.t).toISOString().slice(11, 19),
      pct(r.quota).padStart(8), pct(r.raccolta).padStart(15), pct(r.dopo).padStart(10), '  ' + r.pool.slice(0, 12));
  }
  const qq = sue.map((r) => r.quota);
  const dove = sue.map((r) => r.raccolta);
  console.log('\nquota mediana', pct(q(qq, 0.5)), ' compra quando la curva e a', pct(q(dove, 0.5)),
    `(da ${pct(q(dove, 0))} a ${pct(q(dove, 1))})`);
  process.exit(0);
}

const per = new Map();
for (const r of righe) {
  const c = per.get(r.portafoglio) || { n: 0, quota: 0, pool: new Set(), dove: [], quote: [] };
  c.n += 1; c.quota += r.quota; c.pool.add(r.pool); c.dove.push(r.raccolta); c.quote.push(r.quota);
  per.set(r.portafoglio, c);
}
console.log('=== CHI COMPRA SU stonk.fun ===');
console.log('finestra', ore.toFixed(2), 'ore   acquisti registrati', righe.length,
  '  portafogli distinti', per.size, '  curve toccate', new Set(righe.map((r) => r.pool)).size);
console.log('\n(solo gli acquisti sopra la soglia di STONK_COMPRA_MINIMA)\n');
console.log('portafoglio      acquisti  curve   quota totale   quota mediana   compra quando la curva e a');
const ordinati = [...per.entries()].sort((a, b) => b[1].quota - a[1].quota).slice(0, 25);
for (const [w, c] of ordinati) {
  console.log(w.slice(0, 16).padEnd(17),
    String(c.n).padStart(8), String(c.pool.size).padStart(6),
    pct(c.quota, 1).padStart(14), pct(q(c.quote, 0.5)).padStart(15),
    pct(q(c.dove, 0.5)).padStart(27));
}
const ripetuti = [...per.values()].filter((c) => c.n > 1).length;
console.log(`\n${ripetuti} portafogli su ${per.size} hanno comprato piu' di una volta.`);
const dove = righe.map((r) => r.raccolta);
console.log('gli acquisti grossi arrivano quando la curva e a:', pct(q(dove, 0.5)), 'di mediana',
  `(un quarto sotto il ${pct(q(dove, 0.25))}, un quarto sopra il ${pct(q(dove, 0.75))})`);
