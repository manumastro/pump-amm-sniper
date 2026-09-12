#!/usr/bin/env node
/**
 * Verifica se un endpoint RPC regge questo bot, prima di metterlo in produzione.
 *
 * Il bot ha due profili di carico molto diversi:
 *   - una subscription logsSubscribe permanente per ogni DEX registrato
 *   - raffiche di getParsedTransaction/getSignaturesForAddress durante i deep
 *     check creator-risk, piu un poll di stato ogni 200ms per ogni hold attivo
 *     (con MAX_CONCURRENT_OPERATIONS=2 fanno ~10 req/s di picco solo per l'hold)
 *
 * Un free tier a 10 RPS non ha margine: satura sull'hold e va in 429 sui deep check.
 *
 * ⚠️ Un endpoint puo consegnare i log di un program e NON quelli di un altro, senza
 * dare errore: la subscription viene accettata e non arriva mai niente. Succede davvero
 * (publicnode, program Meteora DAMM v2, 2026-09-12), ed e per questo che la fase 2
 * prova TUTTI i program registrati e non solo il primo. In una sessione lunga un buco
 * del genere si vede solo come "quel DEX non produce mai eventi".
 *
 * Uso:  SVS_UNSTAKED_RPC="https://..." node scripts/rpc-smoke-test.js
 *       SVS_UNSTAKED_WS="wss://..."    per testare un WS separato dall'HTTP
 */
const { Connection, PublicKey } = require('@solana/web3.js');
// senza variabili esplicite si testa l'endpoint attualmente in uso
try { require('dotenv').config(); } catch {}

const RPC = process.env.SVS_UNSTAKED_RPC;
const WS = process.env.SVS_UNSTAKED_WS;
const PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const PROGRAMS = {
  pumpswap: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  ray_v4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  meteora_damm_v2: 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
};
const WS_WAIT_MS = Number(process.env.WS_WAIT_MS || 90000);
const BURST = Number(process.env.BURST || 60);

if (!RPC) { console.error('manca SVS_UNSTAKED_RPC (ne in ambiente ne in .env)'); process.exit(1); }

const ms = () => Date.now();
function pct(arr, p) { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }

(async () => {
  // la chiave sta nella query (Helius, Alchemy) o nel path (Chainstack): entrambe fuori dall'output
  const mask = (u) => u
    .replace(/([?&](?:api[-_]?key|apikey|access[-_]?token)=)[^&]+/gi, '$1***')
    .replace(/\/[0-9a-f]{24,}(?=\/|$)/gi, '/***')
    .replace(/\/\/[^/@]+:[^/@]+@/, '//***:***@');
  console.log('endpoint:', mask(RPC));
  if (WS) console.log('websocket:', mask(WS));
  const conn = new Connection(RPC, WS ? { commitment: 'confirmed', wsEndpoint: WS } : { commitment: 'confirmed' });

  // 1. l'endpoint risponde?
  try {
    const t0 = ms();
    const slot = await conn.getSlot();
    console.log(`\n[1] getSlot          OK  slot=${slot} (${ms() - t0}ms)`);
  } catch (e) {
    console.log('\n[1] getSlot          FALLITO:', e.message.slice(0, 120));
    console.log('\nInutilizzabile.'); process.exit(1);
  }

  // 2. logsSubscribe su OGNI program registrato: senza questo il bot non vede nulla.
  //    Un program che riceve 0 log qui e un DEX che il bot non vedrebbe mai.
  const WINDOW_MS = 45000;
  console.log(`\n[2] logsSubscribe    ${Object.keys(PROGRAMS).length} program in ascolto per ${WINDOW_MS / 1000}s`);
  const counters = {};
  const subs = [];
  for (const [name, program] of Object.entries(PROGRAMS)) {
    counters[name] = { logs: 0, createPool: 0, firstAt: null };
    const t0 = ms();
    try {
      subs.push(await conn.onLogs(new PublicKey(program), (l) => {
        const c = counters[name];
        c.logs++;
        if (c.firstAt === null) c.firstAt = ms() - t0;
        if (l.logs.some((x) => /create_?pool|initialize2|Instruction: Initialize(Customizable)?Pool/i.test(x))) c.createPool++;
      }, 'confirmed'));
    } catch (e) {
      console.log(`    ${name}: subscribe FALLITO: ${e.message.slice(0, 80)}`);
    }
  }
  await new Promise((r) => setTimeout(r, WINDOW_MS));
  const silent = [];
  for (const [name, c] of Object.entries(counters)) {
    if (c.logs === 0) {
      silent.push(name);
      console.log(`    ${name.padEnd(16)} NESSUN LOG in ${WINDOW_MS / 1000}s`);
    } else {
      console.log(`    ${name.padEnd(16)} ${String(c.logs).padStart(6)} log  (primo dopo ${c.firstAt}ms, ${c.createPool} creazioni)`);
    }
  }
  const firstLogAt = counters.pumpswap.firstAt;
  for (const id of subs) { try { await conn.removeOnLogsListener(id); } catch {} }

  // 3. raffica: simula i deep check creator-risk. Qui esce il vero limite.
  console.log(`\n[3] raffica ${BURST} getSignaturesForAddress in parallelo`);
  const lat = []; let ok = 0, rateLimited = 0, failed = 0;
  const t0 = ms();
  await Promise.all(Array.from({ length: BURST }, async () => {
    const s = ms();
    try { await conn.getSignaturesForAddress(new PublicKey(PROGRAM), { limit: 1 }); ok++; lat.push(ms() - s); }
    catch (e) {
      const m = String(e.message || '');
      if (/429|too many requests|rate/i.test(m)) rateLimited++; else { failed++; if (failed === 1) console.log('    errore:', m.slice(0, 100)); }
    }
  }));
  const elapsed = ms() - t0;
  console.log(`    ok=${ok}  429=${rateLimited}  altri errori=${failed}  in ${elapsed}ms`);
  if (ok) console.log(`    latenza p50=${pct(lat, 0.5)}ms p95=${pct(lat, 0.95)}ms`);
  console.log(`    throughput effettivo ~${(ok / (elapsed / 1000)).toFixed(1)} req/s`);

  // Verdetto
  console.log('\n--- verdetto ---');
  const problems = [];
  if (firstLogAt === null) problems.push('logsSubscribe non funziona: il bot non riceverebbe eventi');
  if (silent.length) problems.push(
    `nessun log per ${silent.join(', ')}: l'endpoint accetta la subscription ma non consegna niente. `
    + 'Quei DEX sarebbero invisibili al bot, in silenzio. Usare SVS_UNSTAKED_WS per mettere il '
    + 'WebSocket su un provider diverso da quello HTTP.');
  if (rateLimited > 0) problems.push(`${rateLimited}/${BURST} richieste rate-limited: i deep check creator-risk andrebbero in 429`);
  if (failed > 0) problems.push(
    `${failed}/${BURST} richieste fallite (non 429): l'endpoint rifiuta getSignaturesForAddress. `
    + 'I deep check creator-risk non funzionerebbero affatto.');
  if (ok === 0) problems.push('nessuna richiesta HTTP e andata a buon fine: inutilizzabile come SVS_UNSTAKED_RPC');
  if (ok && pct(lat, 0.95) > 2000) problems.push(`p95 ${pct(lat, 0.95)}ms: troppo lento per i poll di hold a 200ms`);
  if (!problems.length) console.log('Nessun problema rilevato su questo campione. Serve comunque ~10 req/s sostenuti con 2 worker attivi.');
  else problems.forEach((p) => console.log('  ⚠️ ' + p));
  process.exit(0);
})();
