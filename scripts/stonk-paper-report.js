#!/usr/bin/env node
// Legge logs/stonk-paper.jsonl e misura: quale regola d'uscita rende, quanto dura una
// posizione, quanto spesso l'uscita viene davvero raggiunta. Vedi docs/stonk-fun.md.

const fs = require('fs');
const path = require('path');

const FILE = path.join(process.cwd(), 'logs', 'stonk-paper.jsonl');
const n = (x, d = 2) => x.toLocaleString('it', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 1) => `${(100 * x).toFixed(d)}%`;
const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : null);

function leggi() {
  if (!fs.existsSync(FILE)) return { ingressi: [], chiuse: [] };
  const righe = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean)
    .map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
  return {
    ingressi: righe.filter((r) => r.tipo === 'ingresso'),
    chiuse: righe.filter((r) => r.tipo === 'chiusa'),
    viste: righe.filter((r) => r.tipo === 'vista'),
  };
}

function main() {
  const { ingressi, chiuse, viste } = leggi();
  if (!chiuse.length) { console.log('nessuna posizione chiusa in logs/stonk-paper.jsonl'); return; }

  const da = Math.min(...ingressi.map((r) => r.t), ...chiuse.map((r) => r.t));
  const a = Math.max(...chiuse.map((r) => r.t));
  const ore = (a - da) / 3600000;

  console.log('=== PAPER TRADE stonk.fun ===');
  console.log('finestra          ', n(ore, 2), 'ore');
  console.log('ingressi          ', ingressi.length, `(${n(ingressi.length / Math.max(ore, 1e-9), 1)} all ora)`);
  console.log('posizioni chiuse  ', chiuse.length);
  const dallaNascita = ingressi.filter((r) => r.dallaNascita).length;
  console.log('di cui prese dalla nascita:', dallaNascita, 'su', ingressi.length);
  const fIn = ingressi.map((r) => r.f).sort((x, y) => x - y);
  if (fIn.length) console.log('raccolta all ingresso: mediana', pct(q(fIn, 0.5), 2), ' min', pct(q(fIn, 0), 2), ' max', pct(q(fIn, 1), 2));
  const piatt = {};
  for (const r of ingressi) piatt[`${r.piattaforma} ${pct(r.tassa, 0)}`] = (piatt[`${r.piattaforma} ${pct(r.tassa, 0)}`] || 0) + 1;
  console.log('piattaforma e tassa:', JSON.stringify(piatt));

  if (viste.length) {
    console.log('\n=== A CHE PUNTO LE INCONTRIAMO ===');
    const sotto = viste.filter((v) => !v.sopra);
    const sopra = viste.filter((v) => v.sopra);
    console.log('pool incontrate      ', viste.length,
      ` (${sotto.length} sotto soglia, ${sopra.length} gia sopra = ${pct(sopra.length / viste.length, 0)})`);
    const fs_ = sopra.map((v) => v.f).sort((x, y) => x - y);
    if (fs_.length) {
      console.log('quando sono gia sopra, la raccolta e:  mediana', pct(q(fs_, 0.5), 2),
        ' 25esimo', pct(q(fs_, 0.25), 2), ' 75esimo', pct(q(fs_, 0.75), 2), ' max', pct(q(fs_, 1), 2));
      const scaglioni = [[0.015, 0.03], [0.03, 0.05], [0.05, 0.10], [0.10, 0.30], [0.30, 1.01]];
      for (const [a_, b_] of scaglioni) {
        const n_ = fs_.filter((x) => x >= a_ && x < b_).length;
        console.log(`  ${pct(a_, 1).padStart(6)} - ${pct(b_, 0).padEnd(6)} ${String(n_).padStart(5)}  ${pct(n_ / fs_.length, 0)}`);
      }
    }
    const eta = viste.filter((v) => v.secondiDallaNascita !== null && v.secondiDallaNascita !== undefined)
      .map((v) => v.secondiDallaNascita).sort((x, y) => x - y);
    if (eta.length) {
      console.log('secondi dalla nascita al primo incontro (solo le nate mentre guardavamo, n=' + eta.length + '):',
        'mediana', n(q(eta, 0.5), 1), ' 25esimo', n(q(eta, 0.25), 1), ' 75esimo', n(q(eta, 0.75), 1));
    }
  }

  console.log('\n=== PER REGOLA D USCITA ===');
  console.log('regola    n   raggiunta  ricaduta  scadenza  migrata |  rend.medio  mediano  peggiore  migliore |  secondi');
  const perRegola = {};
  for (const c of chiuse) (perRegola[c.regola] = perRegola[c.regola] || []).push(c);
  const ordine = Object.keys(perRegola).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  for (const nome of ordine) {
    const g = perRegola[nome];
    const r = g.map((c) => c.rendimento).sort((x, y) => x - y);
    const s = g.map((c) => c.secondi).sort((x, y) => x - y);
    const conta = (m) => g.filter((c) => c.motivo === m).length;
    console.log(
      nome.padEnd(7), String(g.length).padStart(4),
      String(conta('obiettivo')).padStart(10), String(conta('ricaduta')).padStart(9),
      String(conta('scadenza')).padStart(9), String(conta('migrata')).padStart(9), ' |',
      pct(r.reduce((x, y) => x + y, 0) / r.length).padStart(11),
      pct(q(r, 0.5)).padStart(8), pct(q(r, 0)).padStart(9), pct(q(r, 1)).padStart(9), ' |',
      n(q(s, 0.5), 1).padStart(8));
  }

  console.log('\n=== IL CONTO COMPLESSIVO PER REGOLA ===');
  console.log('(somma dei rendimenti: ogni posizione vale una quota uguale del capitale)');
  for (const nome of ordine) {
    const g = perRegola[nome];
    const somma = g.reduce((x, c) => x + c.rendimento, 0);
    const vincenti = g.filter((c) => c.rendimento > 0).length;
    console.log(
      nome.padEnd(7), String(g.length).padStart(4), 'posizioni  ',
      'in guadagno', `${String(vincenti).padStart(4)} (${pct(vincenti / g.length, 0).padStart(5)})`,
      '  totale', pct(somma / g.length).padStart(9), 'per posizione',
      '  cumulato', n(somma, 2).padStart(8));
  }

  const modi = [...new Set(chiuse.map((c) => c.modo || 'attraversamento'))];
  if (modi.length > 1) {
    console.log('\n=== ATTRAVERSAMENTO CONTRO COMPRARLE GIA SOPRA ===');
    console.log('modo               regola    n   raggiunta |  rend.medio  mediano  peggiore');
    for (const modo of modi.sort()) {
      for (const nome of ordine) {
        const g = chiuse.filter((c) => (c.modo || 'attraversamento') === modo && c.regola === nome);
        if (!g.length) continue;
        const r = g.map((c) => c.rendimento).sort((x, y) => x - y);
        console.log(
          modo.padEnd(18), nome.padEnd(7), String(g.length).padStart(4),
          String(g.filter((c) => c.motivo === 'obiettivo').length).padStart(10), ' |',
          pct(r.reduce((x, y) => x + y, 0) / r.length).padStart(11),
          pct(q(r, 0.5)).padStart(8), pct(q(r, 0)).padStart(9));
      }
    }
  }

  console.log('\n=== COSA SUCCEDE DOPO L INGRESSO ===');
  const perPool = {};
  for (const c of chiuse) (perPool[c.pool] = perPool[c.pool] || []).push(c);
  const mass = Object.values(perPool).map((g) => Math.max(...g.map((c) => c.fMassima))).sort((x, y) => x - y);
  const minn = Object.values(perPool).map((g) => Math.min(...g.map((c) => c.fMinima))).sort((x, y) => x - y);
  console.log('pool distinte con posizioni chiuse:', Object.keys(perPool).length);
  console.log('raccolta massima toccata dopo l ingresso: mediana', pct(q(mass, 0.5), 2), ' 75esimo', pct(q(mass, 0.75), 2), ' max', pct(q(mass, 1), 2));
  console.log('raccolta minima toccata dopo l ingresso: mediana', pct(q(minn, 0.5), 2), ' 25esimo', pct(q(minn, 0.25), 2), ' min', pct(q(minn, 0), 2));
}

main();
