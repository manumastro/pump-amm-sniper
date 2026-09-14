#!/usr/bin/env node
// Legge i due file dell'osservatorio e misura le curve: quanto ci mettono a salire,
// fin dove arrivano, di quanto tornano indietro, e cosa avrebbe reso entrare a una
// soglia e uscire a un'altra. Vedi docs/stonk-fun.md.

const fs = require('fs');
const path = require('path');

const R = 2.83333; // bersaglio / virtual_quote, costante su ogni pool stonk
const LOG_DIR = path.join(process.cwd(), 'logs');
const COSTI = Number(process.env.STONK_COSTI || '0.045'); // 1,25% trading + 1% tassa, per lato

const ENTRATE = [0.005, 0.01, 0.015, 0.02, 0.03, 0.05];
const USCITE = [0.02, 0.05, 0.08, 0.10, 0.20, 0.50, 1.0];

function leggi(file) {
  const p = path.join(LOG_DIR, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((r) => {
    try { return JSON.parse(r); } catch { return null; }
  }).filter(Boolean);
}

const n = (x, d = 2) => x.toLocaleString('it', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 2) => `${(100 * x).toFixed(d)}%`;
const quantile = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * q))] : null);

// prezzo relativo al fondo della curva, in funzione di quanto e' avanzata la raccolta
const prezzo = (f) => (1 + R * f) ** 2;

function costruisci() {
  const pools = new Map();
  for (const r of leggi('stonk-pools.jsonl')) {
    if (r.tipo === 'nascita') {
      const p = pools.get(r.pool);
      if (p) { p.nascita = r.nascita; p.storiaCompleta = r.completo; }
      continue;
    }
    if (pools.has(r.pool)) continue;
    pools.set(r.pool, {
      pool: r.pool, mint: r.mint, quote: r.quote, piattaforma: r.piattaforma,
      target: r.target, primoTs: r.t, fIniziale: r.fIniziale, punti: [],
      nascita: null, storiaCompleta: null,
    });
  }
  for (const c of leggi('stonk-curva.jsonl')) {
    const p = pools.get(c.p);
    if (p) p.punti.push({ t: c.t, f: c.f, s: c.s });
  }
  for (const p of pools.values()) p.punti.sort((a, b) => a.t - b.t);
  return [...pools.values()].filter((p) => p.punti.length);
}

// una pool e' "presa dalla nascita" se abbiamo la sua creazione e l'abbiamo vista subito dopo
function dallaNascita(p) {
  return p.storiaCompleta === true && p.nascita !== null && (p.primoTs - p.nascita) <= 120000;
}

function tempoASoglia(p, soglia) {
  const punto = p.punti.find((x) => x.f >= soglia);
  if (!punto) return null;
  const zero = dallaNascita(p) ? p.nascita : p.primoTs;
  return (punto.t - zero) / 1000;
}

function simula(p, f0, f1) {
  const iEntra = p.punti.findIndex((x) => x.f >= f0);
  if (iEntra < 0) return null;
  const entra = p.punti[iEntra];
  if (entra.f > f1) return null; // gia' oltre l'uscita quando l'abbiamo vista
  for (let i = iEntra + 1; i < p.punti.length; i += 1) {
    if (p.punti[i].f >= f1) {
      return {
        esito: 'uscita', rend: (prezzo(p.punti[i].f) / prezzo(entra.f)) * (1 - COSTI) - 1,
        secondi: (p.punti[i].t - entra.t) / 1000,
      };
    }
  }
  const ultimo = p.punti[p.punti.length - 1];
  return {
    esito: 'appesa', rend: (prezzo(ultimo.f) / prezzo(entra.f)) * (1 - COSTI) - 1,
    secondi: (ultimo.t - entra.t) / 1000,
  };
}

function main() {
  const pools = costruisci();
  if (!pools.length) { console.log('nessun dato in logs/stonk-curva.jsonl'); return; }
  const nate = pools.filter(dallaNascita);
  const finestra = (Math.max(...pools.map((p) => p.punti[p.punti.length - 1].t))
    - Math.min(...pools.map((p) => p.primoTs))) / 3600000;

  console.log('=== OSSERVATORIO stonk.fun ===');
  console.log('finestra osservata      ', n(finestra, 2), 'ore');
  console.log('pool viste              ', pools.length);
  console.log('  prese dalla nascita   ', nate.length);
  console.log('  gia in corso          ', pools.length - nate.length);
  console.log('campioni di curva       ', pools.reduce((a, p) => a + p.punti.length, 0));

  console.log('\n=== FIN DOVE ARRIVANO (massimo osservato) ===');
  const maxF = pools.map((p) => Math.max(...p.punti.map((x) => x.f)));
  for (const s of [0.01, 0.02, 0.05, 0.10, 0.20, 0.50, 0.99]) {
    const c = maxF.filter((x) => x >= s).length;
    console.log(`  oltre ${pct(s, 0).padStart(4)}: ${String(c).padStart(5)}  ${pct(c / pools.length, 1).padStart(7)}`);
  }

  if (nate.length) {
    console.log('\n=== QUANTO CI METTONO, DALLA NASCITA (solo pool prese dall inizio) ===');
    console.log('  soglia   quante ci arrivano   secondi: mediana   25%      75%');
    for (const s of [0.01, 0.02, 0.05, 0.10, 0.20]) {
      const t = nate.map((p) => tempoASoglia(p, s)).filter((x) => x !== null).sort((a, b) => a - b);
      if (!t.length) { console.log(`  ${pct(s, 0).padStart(6)}                    0`); continue; }
      console.log(`  ${pct(s, 0).padStart(6)} ${String(t.length).padStart(18)}   ${n(quantile(t, 0.5), 1).padStart(14)} ${n(quantile(t, 0.25), 1).padStart(8)} ${n(quantile(t, 0.75), 1).padStart(8)}`);
    }
  }

  console.log('\n=== DI QUANTO TORNANO INDIETRO ===');
  const ritorni = pools.map((p) => {
    const max = Math.max(...p.punti.map((x) => x.f));
    const fine = p.punti[p.punti.length - 1].f;
    return max > 0 ? { max, fine, giu: 1 - fine / max } : null;
  }).filter((x) => x && x.max >= 0.01);
  if (ritorni.length) {
    const g = ritorni.map((x) => x.giu).sort((a, b) => a - b);
    console.log('  pool arrivate almeno all 1%:', ritorni.length);
    console.log('  scesa dal massimo: mediana', pct(quantile(g, 0.5), 1),
      '  25%', pct(quantile(g, 0.25), 1), '  75%', pct(quantile(g, 0.75), 1));
    console.log('  ancora sul massimo (scesa < 5%):', g.filter((x) => x < 0.05).length);
  }

  console.log('\n=== SIMULAZIONE: entri alla riga, esci alla colonna ===');
  console.log(`(costi ${pct(COSTI, 1)} andata e ritorno; "appesa" = non ha mai toccato l uscita)`);
  for (const f0 of ENTRATE) {
    const riga = [];
    for (const f1 of USCITE) {
      if (f1 <= f0) { riga.push('       -'); continue; }
      const r = pools.map((p) => simula(p, f0, f1)).filter(Boolean);
      if (!r.length) { riga.push('       .'); continue; }
      const usciti = r.filter((x) => x.esito === 'uscita');
      const medio = r.reduce((a, x) => a + x.rend, 0) / r.length;
      riga.push(`${pct(medio, 0).padStart(6)}/${String(Math.round(100 * usciti.length / r.length)).padStart(2)}`);
    }
    console.log(`  ${pct(f0, 1).padStart(6)} ` + riga.map((x) => x.padStart(10)).join(''));
  }
  console.log('  (ogni cella: rendimento medio per posizione / % che ha raggiunto l uscita)');
  console.log('   colonne: ' + USCITE.map((x) => pct(x, 0)).join('  '));
}

main();
