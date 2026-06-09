#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REPORT_JSON = path.join(ROOT, 'logs', 'paper-report.json');
const WSOL = 'So11111111111111111111111111111111111111112';

function parseArgs(argv) {
  const args = { cc: null, batchSize: 20, delayMs: 1200 };
  for (const raw of argv) {
    if (raw.startsWith('--cc=')) {
      args.cc = Number(raw.slice('--cc='.length));
      continue;
    }
    if (raw.startsWith('--batch=')) {
      args.batchSize = Number(raw.slice('--batch='.length));
      continue;
    }
    if (raw.startsWith('--delay-ms=')) {
      args.delayMs = Number(raw.slice('--delay-ms='.length));
      continue;
    }
  }
  if (!Number.isFinite(args.cc)) {
    console.error('Usage: node scripts/cc-dex-analysis.js --cc=<number> [--batch=20] [--delay-ms=1200]');
    process.exit(1);
  }
  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) args.batchSize = 20;
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) args.delayMs = 1200;
  args.cc = Math.floor(args.cc);
  return args;
}

function loadReport() {
  if (!fs.existsSync(REPORT_JSON)) {
    console.error(`Report not found: ${REPORT_JSON}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function classify(change24h, liqUsd) {
  const c = n(change24h) ?? 0;
  const l = n(liqUsd) ?? 0;
  if (l === 0) return 'no_liquidity';
  if (c <= -50) return 'dead';
  if (c <= -30) return 'heavy_loss';
  if (c <= -10) return 'loss';
  if (c <= 10) return 'flat';
  if (c <= 100) return 'gain';
  if (c <= 1000) return 'big_gain';
  return 'moon';
}

async function fetchDexPairs(tokens) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokens.join(',')}`;
  try {
    const resp = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      return { pairs: [], error: `http_${resp.status}` };
    }
    const data = await resp.json();
    return { pairs: Array.isArray(data.pairs) ? data.pairs : [], error: null };
  } catch (error) {
    return { pairs: [], error: error?.message || 'fetch_error' };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = loadReport();
  const ops = report.operations || [];

  const byToken = new Map();
  const rx = new RegExp(`creator risk \\(unique counterparties\\s+${args.cc}\\s*>=\\s*2\\)`, 'i');
  for (const op of ops) {
    const reason = String(op.skipReason || '');
    if (!rx.test(reason)) continue;
    const token = op.tokenMint;
    if (!token || token === 'None') continue;
    const prev = byToken.get(token);
    if (!prev) {
      byToken.set(token, {
        token,
        gmgn: op.gmgn || `https://gmgn.ai/sol/token/${token}`,
        occurrences: 1,
        firstEventId: op.id || null,
        firstStartedAt: op.startedAt || null,
        lastEventId: op.id || null,
        lastStartedAt: op.startedAt || null,
        sampleReason: reason,
      });
    } else {
      prev.occurrences += 1;
      prev.lastEventId = op.id || prev.lastEventId;
      prev.lastStartedAt = op.startedAt || prev.lastStartedAt;
    }
  }

  const rows = [...byToken.values()];
  const pairMap = new Map();
  const fetchErrors = [];

  for (let i = 0; i < rows.length; i += args.batchSize) {
    const batch = rows.slice(i, i + args.batchSize).map((r) => r.token);
    const { pairs, error } = await fetchDexPairs(batch);
    if (error) fetchErrors.push({ batchStart: i, size: batch.length, error });

    for (const token of batch) pairMap.set(token, []);
    for (const pair of pairs) {
      const base = pair?.baseToken?.address;
      const quote = pair?.quoteToken?.address;
      if (base && pairMap.has(base)) pairMap.get(base).push(pair);
      if (quote && pairMap.has(quote)) pairMap.get(quote).push(pair);
    }

    if (i + args.batchSize < rows.length && args.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, args.delayMs));
    }
  }

  const analyzed = [];
  for (const row of rows) {
    const pairs = (pairMap.get(row.token) || []).filter(Boolean);
    const wsolPairs = pairs.filter(
      (pair) => pair?.baseToken?.address === WSOL || pair?.quoteToken?.address === WSOL,
    );

    const bestPair = [...pairs].sort((a, b) => (n(b?.liquidity?.usd) || 0) - (n(a?.liquidity?.usd) || 0))[0] || null;
    const bestWsolPair = [...wsolPairs].sort((a, b) => (n(b?.liquidity?.usd) || 0) - (n(a?.liquidity?.usd) || 0))[0] || null;
    const ref = bestWsolPair || bestPair;
    const liq = n(ref?.liquidity?.usd) || 0;
    const chg = n(ref?.priceChange?.h24);

    analyzed.push({
      ...row,
      dex: {
        pairCount: pairs.length,
        wsolPairCount: wsolPairs.length,
        bestPair: bestPair
          ? {
              pairAddress: bestPair.pairAddress || null,
              dexId: bestPair.dexId || null,
              liquidityUsd: n(bestPair?.liquidity?.usd),
              priceChange24h: n(bestPair?.priceChange?.h24),
              fdv: n(bestPair?.fdv ?? bestPair?.marketCap),
              url: bestPair.url || null,
            }
          : null,
        bestWsolPair: bestWsolPair
          ? {
              pairAddress: bestWsolPair.pairAddress || null,
              dexId: bestWsolPair.dexId || null,
              liquidityUsd: n(bestWsolPair?.liquidity?.usd),
              priceChange24h: n(bestWsolPair?.priceChange?.h24),
              fdv: n(bestWsolPair?.fdv ?? bestWsolPair?.marketCap),
              url: bestWsolPair.url || null,
            }
          : null,
        classification: classify(chg, liq),
      },
    });
  }

  analyzed.sort(
    (a, b) => (b.dex?.bestWsolPair?.liquidityUsd || 0) - (a.dex?.bestWsolPair?.liquidityUsd || 0),
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    reportGeneratedAt: report.generatedAt || null,
    cc: args.cc,
    totalTokens: analyzed.length,
    withAnyPairs: analyzed.filter((x) => x.dex.pairCount > 0).length,
    withWsolPairs: analyzed.filter((x) => x.dex.wsolPairCount > 0).length,
    withWsolLiq1k: analyzed.filter((x) => (x.dex.bestWsolPair?.liquidityUsd || 0) >= 1000).length,
    withWsolLiq10k: analyzed.filter((x) => (x.dex.bestWsolPair?.liquidityUsd || 0) >= 10000).length,
    fetchErrors,
  };

  const outJson = path.join(ROOT, 'logs', `cc${args.cc}-dex-analysis.json`);
  const outTxt = path.join(ROOT, 'logs', `cc${args.cc}-dex-analysis.txt`);
  fs.writeFileSync(outJson, JSON.stringify({ summary, tokens: analyzed }, null, 2));

  const lines = [];
  lines.push(`generatedAt=${summary.generatedAt}`);
  lines.push(`reportGeneratedAt=${summary.reportGeneratedAt}`);
  lines.push(`cc=${summary.cc}`);
  lines.push(`totalTokens=${summary.totalTokens}`);
  lines.push(`withAnyPairs=${summary.withAnyPairs}`);
  lines.push(`withWsolPairs=${summary.withWsolPairs}`);
  lines.push(`withWsolLiq1k=${summary.withWsolLiq1k}`);
  lines.push(`withWsolLiq10k=${summary.withWsolLiq10k}`);
  lines.push('');
  lines.push('token | occurrences | wsolPairs | bestWsolLiqUsd | change24h | class | gmgn');
  for (const t of analyzed) {
    const bw = t.dex.bestWsolPair;
    lines.push(
      `${t.token} | ${t.occurrences} | ${t.dex.wsolPairCount} | ${bw?.liquidityUsd ?? '-'} | ${bw?.priceChange24h ?? '-'} | ${t.dex.classification} | ${t.gmgn}`,
    );
  }
  fs.writeFileSync(outTxt, `${lines.join('\n')}\n`);

  console.log(JSON.stringify({ summary, outJson, outTxt }, null, 2));
  for (const t of analyzed) {
    const bw = t.dex.bestWsolPair;
    const liq = typeof bw?.liquidityUsd === 'number' ? bw.liquidityUsd : 0;
    const chg = typeof bw?.priceChange24h === 'number' ? bw.priceChange24h : '-';
    console.log(`${t.token} | liq=${liq} | chg=${chg} | class=${t.dex.classification} | ${t.gmgn}`);
  }
}

main();
