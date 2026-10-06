// Simulazione SU CARTA dello stile di @Tekkerrss: nessun ordine vero, nessuna chiamata di swap o di quotazione.
// Prezzi da fomo (liste di scoperta Mobula e filterTokens), con l'impatto calcolato dalla liquidita' del pool
// (prodotto costante: compro V con riserva y = liq/2 -> prezzo medio p*(y+V)/y; vendo valore Vm -> incasso y*Vm/(y+Vm)).
// Tre binari, ognuno con i suoi conti:
//   regole  - entra da solo sui token appena graduati o a fine curva che passano i filtri meccanici
//   agente  - entra quando l'agente (Claude, dopo aver guardato narrativa e X) scrive una decisione in decisioni.jsonl
//   ombra   - copia gli acquisti veri di @Tekkerrss al prezzo del momento in cui li vediamo, e le sue vendite in proporzione
// Dal 4/10 pomeriggio si simulano SOLO le entrate (richiesta della persona): nessuna uscita; prima le uscite erano vende un quarto a 1,5x, un quarto a 3x, un quarto a 6x,
// il resto con uscita a -40% dal massimo dopo 3x; tutto fuori a 0,7x, o dopo 90 minuti se ancora sotto 1x, o dopo 24 ore.
// Dati in dati/fomo/simulazione/: eventi.jsonl (ogni entrata, uscita, candidato), posizioni.json, stato.json, decisioni.jsonl.
// Uso: nohup node scripts/fomo/simula.js > dati/fomo/simulazione/simula.log 2>&1 &
const fs = require('fs'); const path = require('path');
process.env.FOMO_TOKEN_FILE = process.env.FOMO_TOKEN_FILE || path.join(require('os').homedir(), '.config/fomo-mcp/token');
const DIR = path.join(__dirname, '../../dati/fomo/simulazione'); fs.mkdirSync(DIR, { recursive: true });
const TEK = '93b8c6e5-9795-59e7-8c79-77b227f78fdf', NINJA = 'b3a6932d-48ba-5ad0-9d41-04a2e7870628', USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', SOLN = 1399811149;
const MIN_LIQ_VIVO = 2000, MIN_MCAP_VIVO = 5000;
// dal 4/10 pomeriggio: niente ingressi sopra $150k (i finti marchi a $400k appena scoperti), un solo token per nome (i cloni)
// e prezzi incoerenti scartati (mcap oltre 500 volte la liquidita': fomo a volte da' un prezzo sbagliato)
const MAX_MCAP_INGRESSO = 150000, MAX_MCAP_SU_LIQ = 500;
// dal 4/10 sera, dal confronto migliori/peggiori della simulazione (nessun vincente tolto, controllato acquisto per acquisto):
// - mcap fino a 10 volte la liquidita' del pool (i peggiori Meteora: pool da $2-3k con mcap $110-180k, config DBC senza bonding)
// - pump.fun solo in bonding (dopo la graduation 1 vinto su 26: i finti marchi a ~$400k)
// - pump.fun: sviluppatore oltre il 5%, primi 10 oltre il 30%, bundler oltre il 25%
const MAX_MCAP_SU_LIQ_INGRESSO = 10, PF_MAX_DEV = 5, PF_MAX_TOP10 = 30, PF_MAX_BUNDLER = 25;
const nomeClone = s => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const coerente = p => !(p?.mcap && p?.liq && p.mcap > MAX_MCAP_SU_LIQ * p.liq);
const ORDINE = 500, COMMISSIONE = 0.01, MAX_APERTE = 6;
// filtri meccanici del binario "regole" (dai suoi giri: entra fra il 90% della curva e i primi minuti dopo la graduation)
const F = { minHolders: 100, maxTop10: 35, maxDev: 5, maxBundlers: 20, minVol5m: 15000, minLiq: 8000, maxMinDopoGrad: 5, minBp: 90, minSecNascitaGrad: 30 };
const scrivi = (f, x) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(x, null, 1));
const leggi = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { return d; } };
const evento = e => fs.appendFileSync(path.join(DIR, 'eventi.jsonl'), JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n');
const ora = () => Math.floor(Date.now() / 1000);
let C;
const S = leggi('posizioni.json', { aperte: [], chiuse: [], visti: {}, tek_ultimo: null, decisioni_lette: 0 });
const prezzoIngresso = (p, liq, V) => { const y = (liq || 0) / 2; return y > 0 ? p * (y + V) / y : p * 1.05; };
// liquidita' non nota (fomo a volte da' 0): valore al prezzo, senza impatto
const incasso = (Vm, liq) => { const y = (liq || 0) / 2; return Vm > 0 ? (y > 0 ? y * Vm / (y + Vm) : Vm) : 0; };
function apri(binario, tok, sym, p, liq, motivo, extra = {}, mcap = null) {
  if (S.aperte.some(x => x.binario === binario && x.tok === tok)) return;
  if (false && S.aperte.filter(x => x.binario === binario).length >= MAX_APERTE) { evento({ tipo: 'saltato', binario, tok, sym, motivo: 'troppe posizioni aperte' }); return; }
  const pe = prezzoIngresso(p, liq, ORDINE * (1 - COMMISSIONE));
  const x = { binario, tok, sym, t0: ora(), mcap0: mcap, p0: p, pe, q: ORDINE * (1 - COMMISSIONE) / pe, q0: ORDINE * (1 - COMMISSIONE) / pe, inv: ORDINE, incassato: 0, max: 1, prese: [], motivo, ...extra };
  S.aperte.push(x); evento({ tipo: 'entra', binario, tok, sym, prezzo: p, prezzo_pagato: pe, mcap, liq, motivo, lp: extra.lp, curva: extra.curva0, link: extra.link || null });
}
function vendi(x, quota, p, liq, perche) {
  const q = x.q * quota; const v = incasso(q * p, liq) * (1 - COMMISSIONE);
  x.q -= q; x.incassato += v; evento({ tipo: 'vende', binario: x.binario, tok: x.tok, sym: x.sym, quota: +quota.toFixed(2), multiplo: +(p / x.pe).toFixed(2), incasso: +v.toFixed(2), perche });
  if (x.q < x.q0 * 0.01) { S.aperte = S.aperte.filter(y => y !== x); S.chiuse.push({ ...x, t1: ora(), netto: x.incassato - x.inv }); evento({ tipo: 'chiude', binario: x.binario, tok: x.tok, sym: x.sym, netto: +(x.incassato - x.inv).toFixed(2) }); }
}
function gestisci(x, p, liq) {
  return;   // dal 4/10 si simulano solo le entrate: nessuna uscita (niente stop, niente prese di profitto)
  if (x.binario === 'ombra') return;
  const m = p / x.pe; x.max = Math.max(x.max, m); const min = (ora() - x.t0) / 60;
  if (m <= 0.7) return vendi(x, 1, p, liq, 'stop a 0,7x');
  if (min > 90 && m < 1 && !x.prese.length) return vendi(x, 1, p, liq, '90 minuti sotto 1x');
  if (min > 24 * 60) return vendi(x, 1, p, liq, '24 ore');
  for (const [soglia, nome] of [[1.5, '1,5x'], [3, '3x'], [6, '6x']]) if (m >= soglia && !x.prese.includes(nome)) { x.prese.push(nome); vendi(x, 0.25 / (x.q / x.q0), p, liq, 'presa a ' + nome); if (!S.aperte.includes(x)) return; }
  if (x.prese.includes('3x') && m <= x.max * 0.6) return vendi(x, 1, p, liq, '-40% dal massimo');
}
const num = v => v == null ? null : +v;
// l'originale di un token: fra i token Solana con lo stesso simbolo (ricerca per nome e per simbolo su fomo), il piu' vecchio
// che porta un link X; null se il candidato e' gia' lui o se nessuno ha il link
async function cercaOriginale(tok, p) {
  const sym = nomeClone(p.sym), visti = new Map();
  for (const q of [...new Set([p.nome, p.sym].filter(Boolean))]) {
    let R = []; try { R = await C.searchTokens(q); } catch (e) { continue; }
    for (const x of (Array.isArray(R) ? R : [])) { const t = x.token || {};
      if (t.networkId !== SOLN || !t.address || nomeClone(t.symbol) !== sym) continue;
      visti.set(t.address, { tok: t.address, sym: t.symbol, nato: num(x.createdAt), tw: t.socialLinks?.twitter || null, p: num(x.priceUSD), mcap: num(x.marketCap), liq: num(x.liquidity), lp: t.launchpad?.launchpadName || null, curva: num(t.launchpad?.graduationPercent) }); } }
  // fomo a volte risponde senza i social: il link del candidato si prende da qualunque delle due letture
  visti.set(tok, { tok, sym: p.sym, nato: p.nato || visti.get(tok)?.nato, tw: p.tw || visti.get(tok)?.tw || null, p: p.p, mcap: p.mcap, liq: p.liq, lp: p.lp, curva: p.curva });
  // l'originale e' recente (nato al massimo un'ora prima del candidato): un token omonimo di mesi fa non e' l'origine di questo
  const nc0 = visti.get(tok).nato;
  const conLink = [...visti.values()].filter(x => x.tw && x.nato && x.p && (!nc0 || x.tok === tok || nc0 - x.nato <= 3600)).sort((a, b) => a.nato - b.nato);
  return conLink.length && conLink[0].tok !== tok ? conLink[0] : null;
}
async function giro() {
  const t = ora();
  // 1) liste di scoperta: candidati del binario regole
  // dal 4/10: liste senza i filtri di fomo (bonded = tutti i graduati, bonding = tutti in curva) piu' quelle filtrate dell'app
  const daComprare = [];
  const L4 = await Promise.all(['bonded', 'filtered-bonded', 'bonding', 'filtered-bonding'].map(v => C.discoverTokens(v, ['solana:solana'], 100)));
  for (const [lista, L] of [['graduated', L4[0].concat(L4[1])], ['bonding', L4[2].concat(L4[3])]]) for (const k of L) {
    const tok = k.address; const bp = num(k.bondingPercentage), bondedAt = k.bonded_at ? Math.floor(Date.parse(k.bonded_at) / 1000) : null;
    const nato = k.created_at ? Math.floor(Date.parse(k.created_at) / 1000) : (k.createdAt ? Math.floor(Date.parse(k.createdAt) / 1000) : null);
    const minDopo = bondedAt ? (t - bondedAt) / 60 : null;
    const c = { tok, sym: k.symbol, nome: k.name, lista, bp, minDopo: minDopo && +minDopo.toFixed(1), mcap: num(k.marketCap ?? k.market_cap), liq: num(k.liquidity), holders: num(k.holdersCount), top10: num(k.top10Holdings), dev: num(k.devHoldings), bundlers: num(k.bundlersHoldings), vol5m: num(k.volume_5min), prezzo: num(k.price), socials: k.socials, desc: k.description };
    if (S.visti[tok]) continue;
    const finestra = lista === 'graduated' ? (minDopo != null && minDopo <= F.maxMinDopoGrad) : (bp != null && bp >= F.minBp);
    if (!finestra) continue;
    S.visti[tok] = t;
    const no = [];
    if ((c.holders || 0) < F.minHolders) no.push('holder'); if ((c.top10 ?? 100) > F.maxTop10) no.push('top10');
    if ((c.dev ?? 0) > F.maxDev) no.push('dev'); if ((c.bundlers ?? 0) > F.maxBundlers) no.push('bundler');
    if ((c.vol5m || 0) < F.minVol5m) no.push('volume'); if ((c.liq || 0) < F.minLiq) no.push('liquidita');
    if (nato && bondedAt && bondedAt - nato < F.minSecNascitaGrad) no.push('lancio a pacchetto');
    // dal 4/10 nessun filtro: i motivi si registrano solo come informazione ('avvisi'), si entra comunque
    evento({ tipo: 'candidato', ...c, scartato: [], avvisi: no });
    // il prezzo delle liste senza filtro a volte non e' quello del token: si entra dopo, col prezzo di filterTokens
    if (c.prezzo) daComprare.push({ tok, sym: c.sym, lista, dev: c.dev, top10: c.top10, bundlers: c.bundlers, motivo: `${lista} ${lista === 'graduated' ? c.minDopo + ' min dopo la graduation' : 'curva al ' + bp.toFixed(1) + '%'}` });
  }
  // 2) decisioni dell'agente
  const righe = (() => { try { return fs.readFileSync(path.join(DIR, 'decisioni.jsonl'), 'utf8').split('\n').filter(Boolean); } catch (e) { return []; } })();
  const nuove = righe.slice(S.decisioni_lette); S.decisioni_lette = righe.length;
  // 3) ombra: gli swap nuovi di @Tekkerrss
  // fomo non li restituisce in ordine di tempo: si tiene l'elenco degli id gia' visti
  const sw = ((await C.get(`/v2/users/${TEK}/swaps`, {}))?.swaps || []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const primaVolta = !S.tek_visti; S.tek_visti = S.tek_visti || [];
  const nuoviTek = primaVolta ? [] : sw.filter(s => !S.tek_visti.includes(s.id));
  S.tek_visti = [...new Set([...S.tek_visti, ...sw.map(s => s.id)])].slice(-500);
  // dal 4/10: secondo conto ombra, @NinjaTradeCr (copiato sempre; il risultato si guarda poi per fascia di mcap)
  const swN = ((await C.get(`/v2/users/${NINJA}/swaps`, {}))?.swaps || []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const primaN = !S.ninja_visti; S.ninja_visti = S.ninja_visti || [];
  const nuoviNinja = primaN ? [] : swN.filter(s => !S.ninja_visti.includes(s.id));
  S.ninja_visti = [...new Set([...S.ninja_visti, ...swN.map(s => s.id)])].slice(-500);
  // 4) prezzi di tutto cio' che serve, in un colpo
  const servono = new Set([...daComprare.map(d => d.tok), ...S.aperte.map(x => x.tok), ...nuove.map(r => JSON.parse(r).tok), ...[...nuoviTek, ...nuoviNinja].map(s => s.inTokenAddress === USDC ? s.outTokenAddress : s.inTokenAddress)]);
  const P = {};
  if (servono.size) for (const r of await C.filterTokens([...servono].map(m => m + ':' + SOLN))) { const a = r.token?.address; if (a) P[a] = { p: num(r.priceUSD), liq: num(r.liquidity), sym: r.token?.symbol, mcap: num(r.marketCap), lp: r.token?.launchpad?.launchpadName || null, curva: num(r.token?.launchpad?.graduationPercent), nato: num(r.createdAt ?? r.token?.createdAt), nome: r.token?.name, tw: r.token?.socialLinks?.twitter || null }; }
  // unico filtro: niente token morti (pool quasi vuoto o mcap sotto il minimo di una curva pump.fun, ~28 SOL)
  for (const d of daComprare) { const p = P[d.tok];
    if (p?.p && ((p.liq || 0) < MIN_LIQ_VIVO || (p.mcap || 0) < MIN_MCAP_VIVO)) { evento({ tipo: 'saltato', binario: 'regole', tok: d.tok, sym: p.sym || d.sym, motivo: 'token morto', liq: p.liq, mcap: p.mcap }); continue; }
    if (p?.p && !coerente(p)) { evento({ tipo: 'saltato', binario: 'regole', tok: d.tok, sym: p.sym || d.sym, motivo: 'prezzo incoerente', liq: p.liq, mcap: p.mcap }); continue; }
    if (p?.p && (p.mcap || 0) > MAX_MCAP_INGRESSO) { evento({ tipo: 'saltato', binario: 'regole', tok: d.tok, sym: p.sym || d.sym, motivo: 'mcap sopra $150k', liq: p.liq, mcap: p.mcap }); continue; }
    const no2 = [];
    if (p?.p && p.liq && p.mcap > MAX_MCAP_SU_LIQ_INGRESSO * p.liq) no2.push('mcap oltre 10 volte la liquidita\'');
    if (p?.lp === 'Pump.fun') {
      if (d.lista !== 'bonding') no2.push('pump.fun dopo la graduation');
      if ((d.dev ?? 0) > PF_MAX_DEV) no2.push('sviluppatore oltre ' + PF_MAX_DEV + '%');
      if ((d.top10 ?? 0) > PF_MAX_TOP10) no2.push('primi 10 oltre ' + PF_MAX_TOP10 + '%');
      if ((d.bundlers ?? 0) > PF_MAX_BUNDLER) no2.push('bundler oltre ' + PF_MAX_BUNDLER + '%');
    }
    if (p?.p && no2.length) { evento({ tipo: 'saltato', binario: 'regole', tok: d.tok, sym: p.sym || d.sym, motivo: no2.join(', '), lp: p.lp, liq: p.liq, mcap: p.mcap }); continue; }
    const nc = nomeClone(p?.sym || d.sym);
    if (p?.p && nc && [...S.aperte, ...S.chiuse].some(x => x.binario === 'regole' && nomeClone(x.sym) === nc)) { evento({ tipo: 'saltato', binario: 'regole', tok: d.tok, sym: p.sym || d.sym, motivo: 'clone di un nome gia\' comprato', mcap: p.mcap }); continue; }
    // dal 4/10: si cerca l'originale (stesso simbolo, nato prima, col link X): se il candidato e' una copia si compra quello
    const o = p?.p ? await cercaOriginale(d.tok, p) : null;
    // dal 4/10 sera la regola "compra l'originale" e' spenta (4 casi su 4 il mercato ha seguito un altro token):
    // l'originale si cerca e si registra solo come informazione, si compra il candidato
    if (o) evento({ tipo: 'originale_visto', binario: 'regole', copia: d.tok, tok: o.tok, sym: o.sym, nato_copia: p.nato, nato_originale: o.nato, link: o.tw, mcap: o.mcap, liq: o.liq });
    if (false && o) { evento({ tipo: 'originale', binario: 'regole', copia: d.tok, tok: o.tok, sym: o.sym, nato_copia: p.nato, nato_originale: o.nato, link: o.tw, mcap: o.mcap, liq: o.liq });
      if (o.liq < MIN_LIQ_VIVO || o.mcap < MIN_MCAP_VIVO || o.mcap > MAX_MCAP_INGRESSO || o.mcap > MAX_MCAP_SU_LIQ_INGRESSO * o.liq) { evento({ tipo: 'saltato', binario: 'regole', tok: o.tok, sym: o.sym, motivo: 'originale morto, pool vuoto o sopra $150k', liq: o.liq, mcap: o.mcap }); continue; }
      apri('regole', o.tok, o.sym, o.p, o.liq, `originale di ${p.sym || d.sym} ${d.tok.slice(0, 4)}… (${d.motivo})`, { lp: o.lp, curva0: o.curva, copia_di: d.tok, link: o.tw }, o.mcap); continue; }
    if (p?.p) apri('regole', d.tok, p.sym || d.sym, p.p, p.liq, d.motivo, { lp: p.lp, curva0: p.curva, link: p.tw }, p.mcap); else evento({ tipo: 'saltato', binario: 'regole', tok: d.tok, sym: d.sym, motivo: 'nessun prezzo da filterTokens' }); }
  for (const r of nuove) { const d = JSON.parse(r); const p = P[d.tok];
    if (d.azione === 'compra' && p?.p) apri('agente', d.tok, p.sym, p.p, p.liq, d.motivo || 'decisione dell\'agente', { lp: p.lp, curva0: p.curva }, p.mcap);
    else if (d.azione === 'vendi') for (const x of S.aperte.filter(x => x.binario === 'agente' && x.tok === d.tok)) p?.p && vendi(x, d.quota || 1, p.p, p.liq, d.motivo || 'decisione dell\'agente');
    evento({ tipo: 'decisione', ...d, prezzo: p?.p ?? null }); }
  for (const s of nuoviTek) {
    if (s.networkId !== SOLN) continue;
    const compra = s.inTokenAddress === USDC, tok = compra ? s.outTokenAddress : s.inTokenAddress, p = P[tok];
    evento({ tipo: 'tekkerrss', lato: compra ? 'compra' : 'vende', tok, sym: p?.sym, usd: s.humanUsdAmountIn, quando: s.createdAt, ritardo_s: Math.round(t - Date.parse(s.createdAt) / 1000), prezzo_ora: p?.p ?? null });
    if (!p?.p) continue;
    if (compra) apri('ombra', tok, p.sym, p.p, p.liq, `copia di @Tekkerrss ($${Math.round(s.humanUsdAmountIn)})`, { tek_q: 0, lp: p.lp, curva0: p.curva }, p.mcap);
    // solo entrate: le sue vendite si registrano (evento 'tekkerrss') ma l'ombra non vende
  }
  for (const s of nuoviNinja) {
    if (s.networkId !== SOLN) continue;
    const compra = s.inTokenAddress === USDC, tok = compra ? s.outTokenAddress : s.inTokenAddress, p = P[tok];
    evento({ tipo: 'ninja', lato: compra ? 'compra' : 'vende', tok, sym: p?.sym, usd: s.humanUsdAmountIn, quando: s.createdAt, ritardo_s: Math.round(t - Date.parse(s.createdAt) / 1000), prezzo_ora: p?.p ?? null, mcap: p?.mcap ?? null });
    if (compra && p?.p) apri('ninja', tok, p.sym, p.p, p.liq, `copia di @NinjaTradeCr ($${Math.round(s.humanUsdAmountIn)})`, { lp: p.lp, curva0: p.curva, link: p.tw }, p.mcap);
  }
  // fomo a volte non da' la liquidita': si tiene l'ultima nota
  for (const x of [...S.aperte]) { const p = P[x.tok]; if (p?.p && coerente(p)) { x.ultimo = p.p; x.lp = x.lp || p.lp; if ((p.liq || 0) >= 100) x.liq = p.liq; x.mcap_ora = p.mcap ?? x.mcap_ora; gestisci(x, p.p, p.liq); } }
  // 5) stato per binario
  const stato = { aggiornato: new Date().toISOString(), binari: {} };
  for (const b of ['regole', 'agente', 'ombra', 'ninja']) {
    const ch = S.chiuse.filter(x => x.binario === b), ap = S.aperte.filter(x => x.binario === b);
    const valoreAperte = ap.reduce((s, x) => s + x.incassato + incasso(x.q * (x.ultimo || 0), x.liq) * (1 - COMMISSIONE) - x.inv, 0);
    stato.binari[b] = { chiuse: ch.length, vinte: ch.filter(x => x.netto > 0).length, netto_chiuse: +ch.reduce((s, x) => s + x.netto, 0).toFixed(2),
      per_launchpad: ap.reduce((o, x) => { const k = x.lp || '?'; const v = x.incassato + incasso(x.q * (x.ultimo || 0), x.liq) * (1 - COMMISSIONE) - x.inv; o[k] = o[k] || { acquisti: 0, vinti: 0, se_vendo: 0 }; o[k].acquisti++; o[k].vinti += v > 0; o[k].se_vendo = +(o[k].se_vendo + v).toFixed(2); return o; }, {}),
      aperte: ap.map(x => { const v = incasso(x.q * (x.ultimo || 0), x.liq) * (1 - COMMISSIONE);
        return { sym: x.sym, tok: x.tok, lp: x.lp || null, curva0: x.curva0 ?? null, link: `https://fomo.family/tokens/solana/${x.tok}`, entrata: new Date(x.t0 * 1000).toISOString().slice(11, 19), mcap0: x.mcap0, p0: x.p0, pagato: x.pe,
          p_ora: x.ultimo, mcap_ora: x.mcap_ora, multiplo: x.ultimo ? +(x.ultimo / x.pe).toFixed(2) : null, valore_se_vendo: +v.toFixed(2), profitto_se_vendo: +(x.incassato + v - x.inv).toFixed(2) }; }),
      netto_aperte_se_vendo: +valoreAperte.toFixed(2) };
  }
  scrivi('stato.json', stato); scrivi('posizioni.json', S);
}
(async () => {
  const { FomoClient } = await import(path.join(require('os').homedir(), 'fomo-mcp/dist/client.js'));
  C = new FomoClient('x');
  console.log(new Date().toISOString(), 'simulazione avviata (solo carta)');
  for (;;) {
    try { await giro(); } catch (e) { console.log(new Date().toISOString(), 'errore', e.message.slice(0, 120)); }
    await new Promise(r => setTimeout(r, 30000));
  }
})();
