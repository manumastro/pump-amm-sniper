// Come entrano ed escono i migliori, sul prezzo letto dalla catena (prezzi_catena.js, Helius).
// Per ogni giro su Solana: prezzo 3 h, 1 h e 15 min prima dell'acquisto, all'acquisto, in 6 istanti
// mentre si e' dentro, all'uscita e 1 h dopo. Ne escono: quanto era salito prima, il massimo e il
// minimo visti da dentro (campionati), l'uscita rispetto all'ingresso, quanta salita si e' presa,
// cosa fa il prezzo dopo. Il prezzo pagato viene dagli swap fomo (dollari / token).
// Uso: node entrate.js [giri_per_utente]   -> risultati/entrate-<data>.json
const fs = require('fs'); const path = require('path');
const { DATI, leggi, scrivi } = require('./comune');
const { punto } = require('./prezzi_catena');
const evm = require('./prezzi_evm');
const N = +(process.argv[2] || 12);
const RIFAI_EVM = process.argv.includes('--rifai-evm');
const ult = pref => fs.readdirSync(path.join(DATI, 'risultati')).filter(f => f.startsWith(pref)).sort().at(-1);
const B = Object.entries(leggi('risultati/' + ult('migliori-'))).filter(([, r]) => r.migliore).sort((a, b) => b[1].totale - a[1].totale);
const OUTF = `risultati/entrate-${new Date().toISOString().slice(0, 10)}.json`;
const OUT = leggi(OUTF, {});
const CASSA = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112']);
const ts = s => Date.parse(s) / 1000;
function giri(swaps) {   // stessa regola di comune.py: chiuso al 95%, 'dep' se si vende piu' del comprato
  const pos = {}, out = [];
  for (const s of [...swaps].sort((a, b) => a.t.localeCompare(b.t))) {
    let buy, net, tok, q, usd;
    if (CASSA.has(s.i) && !CASSA.has(s.o)) [buy, net, tok, q, usd] = [true, s.onet, s.o, s.oa, s.ui];
    else if (CASSA.has(s.o) && !CASSA.has(s.i)) [buy, net, tok, q, usd] = [false, s.inet, s.i, s.ia, s.uo];
    else continue;
    if (!tok || !q || usd == null) continue;
    const k = net + ':' + tok; const t = ts(s.t);
    const p = pos[k] = pos[k] || { net, tok, inv: 0, ret: 0, qb: 0, qs: 0, t0: t, dep: false };
    if (buy) { p.inv += usd; p.qb += q; }
    else { if (!p.qb) p.dep = true; p.ret += usd; p.qs += q;
      if (p.qb && p.qs >= 0.95 * p.qb) { if (p.qs > 1.05 * p.qb) p.dep = true; out.push({ ...p, t1: t, stato: 'chiuso' }); delete pos[k]; } }
  }
  return out.concat(Object.values(pos).map(p => ({ ...p, t1: null, stato: p.qb > p.qs ? 'aperto' : 'altro' })));
}
(async () => {
  for (const [u, info] of B) {
    // con --rifai-evm si rimisurano i giri EVM (il prezzo Robinhood di prima sbagliava i pool non contro ETH)
    const prima = Object.fromEntries((OUT[u] || []).filter(r => !r.errore && !(RIFAI_EVM && r.net !== 1399811149)).map(r => [r.tok + '|' + r.t0, r]));
    if (!RIFAI_EVM && OUT[u] && OUT[u].every(r => !r.errore || /nessuna transazione/.test(r.errore))) continue;
    const D = leggi(`utenti/${u}.json`); const fine = ts(D.preso);
    const G = giri(D.swaps).filter(g => g.t0 >= fine - 30 * 86400 && !g.dep && g.inv >= 10 && g.stato !== 'altro').sort((a, b) => b.inv - a.inv).slice(0, N);
    const res = [];
    for (const g of G) {
      if (prima[g.tok + '|' + g.t0]) { res.push(prima[g.tok + '|' + g.t0]); continue; }   // gia' misurato
      const r = { t0: g.t0, t1: g.t1, net: g.net, tok: g.tok, inv: g.inv, netto: g.stato === 'chiuso' ? g.ret - g.inv : null, stato: g.stato, entrata: g.inv / g.qb };
      if (![1399811149, 4663, 1, 8453, 56].includes(g.net)) { res.push({ ...r, errore: 'rete senza prezzo dalla catena' }); continue; }
      // EVM: serve una transazione col token per ritrovarne il pool (dalla storia EVM dell'utente)
      let txTok = null;
      if (g.net !== 1399811149) {
        const C = leggi(`catena/evm/${u}.json`, { righe: [] });
        // prima le consegne e i ritiri di Relay (scambi veri), poi le altre transazioni del token
        const righe = C.righe.filter(x => (x.tok || '').toLowerCase() === g.tok.toLowerCase() && (x.rete || 4663) == g.net);
        const relay = x => /^0x(b92fe925|4cd00e38)/i.test(x.contro || '');
        txTok = [...righe.filter(relay), ...righe.filter(x => !relay(x))].map(x => x.tx);
        if (!txTok.length) { res.push({ ...r, errore: 'EVM: nessuna transazione del token' }); continue; }
      }
      try {
        // prezzo in vigore all'istante: l'ultimo scambio prima (entro 6 ore), se no il primo dopo (entro 15 minuti)
        const p = async t => { let x = g.net !== 1399811149 ? await evm.punto(g.tok, t, txTok, g.net) : await punto(g.tok, t, 15, 'desc');
          if (x && x.t <= t && t - x.t < 6 * 3600) return x;
          if (g.net === 1399811149) x = await punto(g.tok, t, 15);
          return x && Math.abs(x.t - t) < 900 ? x : null; };
        const a = await p(g.t0);
        if (!a || !a.px) { res.push({ ...r, errore: 'nessun prezzo all\'acquisto' }); continue; }
        r.prezzo_catena = a.px; r.liq = a.liq; r.liq_tot = a.liq_tot;
        for (const [lab, s] of [['pre15', 900], ['pre60', 3600], ['pre180', 10800]]) { const x = await p(g.t0 - s); r[lab] = x && x.px ? a.px / x.px - 1 : null; }
        const t1 = g.t1 || fine; const dentro = [];
        for (let i = 1; i <= 6; i++) { const x = await p(g.t0 + (t1 - g.t0) * i / 7); if (x && x.px) dentro.push([x.t, x.px]); }
        if (dentro.length) { const mx = dentro.reduce((m, z) => z[1] > m[1] ? z : m); r.massimo = mx[1] / r.entrata - 1; r.t_massimo = (mx[0] - g.t0) / 60; r.minimo = Math.min(...dentro.map(z => z[1])) / r.entrata - 1; }
        if (g.stato === 'chiuso') {
          r.uscita = (g.ret / g.qs) / r.entrata - 1;
          r.massimo = Math.max(r.massimo ?? -1, r.uscita);
          if (r.massimo > 0) r.presa = r.uscita / r.massimo;
          const e = await p(g.t1), d = await p(g.t1 + 3600); r.dopo60 = e && d && e.px && d.px ? d.px / e.px - 1 : null;
        }
      } catch (e) { r.errore = e.message.slice(0, 80); }
      res.push(r);
    }
    OUT[u] = res; scrivi(OUTF, OUT);
    console.log(`@${info.h}: ${res.length} giri, ${res.filter(r => !r.errore).length} misurati`);
  }
  console.log('fine');
})();
