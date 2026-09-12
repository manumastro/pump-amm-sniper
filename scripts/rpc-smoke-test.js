#!/usr/bin/env node
/**
 * Verifica se un endpoint RPC regge questo bot, prima di metterlo in produzione.
 *
 * Il bot ha due profili di carico molto diversi:
 *   - una subscription logsSubscribe permanente sul program PumpSwap
 *   - raffiche di getParsedTransaction/getSignaturesForAddress durante i deep
 *     check creator-risk, piu un poll di stato ogni 200ms per ogni hold attivo
 *     (con MAX_CONCURRENT_OPERATIONS=2 fanno ~10 req/s di picco solo per l'hold)
 *
 * Un free tier a 10 RPS non ha margine: satura sull'hold e va in 429 sui deep check.
 *
 * Uso:  SVS_UNSTAKED_RPC="https://..." node scripts/rpc-smoke-test.js
 */
const { Connection, PublicKey } = require('@solana/web3.js');

const RPC = process.env.SVS_UNSTAKED_RPC;
const PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const WS_WAIT_MS = Number(process.env.WS_WAIT_MS || 90000);
const BURST = Number(process.env.BURST || 60);

if (!RPC) { console.error('manca SVS_UNSTAKED_RPC'); process.exit(1); }

const ms = () => Date.now();
function pct(arr, p) { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }

(async () => {
  console.log('endpoint:', RPC.replace(/api-key=[^&]+/, 'api-key=***'));
  const conn = new Connection(RPC, { commitment: 'confirmed' });

  // 1. l'endpoint risponde?
  try {
    const t0 = ms();
    const slot = await conn.getSlot();
    console.log(`\n[1] getSlot          OK  slot=${slot} (${ms() - t0}ms)`);
  } catch (e) {
    console.log('\n[1] getSlot          FALLITO:', e.message.slice(0, 120));
    console.log('\nInutilizzabile.'); process.exit(1);
  }

  // 2. logsSubscribe: senza questo il bot non vede nulla. E' il primo motivo
  //    per cui un endpoint "gratis" va scartato: molti non espongono il WS.
  console.log(`\n[2] logsSubscribe    in ascolto su ${PROGRAM.slice(0, 8)}... (max ${WS_WAIT_MS / 1000}s)`);
  let subId = null, logCount = 0, createPoolCount = 0;
  const firstLogAt = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), WS_WAIT_MS);
    const t0 = ms();
    try {
      subId = conn.onLogs(new PublicKey(PROGRAM), (l) => {
        logCount++;
        if (l.logs.some((x) => /create_?pool/i.test(x))) createPoolCount++;
        if (logCount === 1) { clearTimeout(timer); resolve(ms() - t0); }
      }, 'confirmed');
    } catch (e) { clearTimeout(timer); resolve(null); }
  });
  if (firstLogAt === null) {
    console.log('    NESSUN LOG ricevuto: WS non supportato, filtrato, o program senza traffico.');
  } else {
    console.log(`    primo log dopo ${firstLogAt}ms`);
    await new Promise((r) => setTimeout(r, 20000));
    console.log(`    in 20s: ${logCount} log, di cui ${createPoolCount} create_pool`);
  }
  if (subId !== null) { try { await conn.removeOnLogsListener(subId); } catch {} }

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
  if (rateLimited > 0) problems.push(`${rateLimited}/${BURST} richieste rate-limited: i deep check creator-risk andrebbero in 429`);
  if (ok && pct(lat, 0.95) > 2000) problems.push(`p95 ${pct(lat, 0.95)}ms: troppo lento per i poll di hold a 200ms`);
  if (!problems.length) console.log('Nessun problema rilevato su questo campione. Serve comunque ~10 req/s sostenuti con 2 worker attivi.');
  else problems.forEach((p) => console.log('  ⚠️ ' + p));
  process.exit(0);
})();
