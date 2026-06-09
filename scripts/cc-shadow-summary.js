#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SHADOW_DIR = path.join(ROOT, 'logs', 'cc-shadow');
const INDEX_JSON = path.join(SHADOW_DIR, 'index.json');
const OUT_JSON = path.join(ROOT, 'logs', 'cc-shadow-summary.json');
const OUT_TXT = path.join(ROOT, 'logs', 'cc-shadow-summary.txt');

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse ${filePath}:`, e.message);
    return fallback;
  }
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function computeStats(tokens) {
  if (!tokens.length) return null;

  const peakPnls = tokens.map(t => t.peakPnlPct).filter(v => typeof v === 'number' && Number.isFinite(v));
  const maxAdversePnls = tokens.map(t => t.maxAdversePnlPct).filter(v => typeof v === 'number' && Number.isFinite(v));
  const lifetimes = tokens
    .filter(t => t.completed && t.lastSnapshot?.ageMs)
    .map(t => t.lastSnapshot.ageMs);
  const removeLiqCount = tokens.filter(t => t.removeLiquidityDetected).length;
  const completedCount = tokens.filter(t => t.completed).length;

  // First trigger counts
  const firstTriggerCounts = {};
  tokens.forEach(t => {
    const trigger = t.firstTrigger || 'none';
    firstTriggerCounts[trigger] = (firstTriggerCounts[trigger] || 0) + 1;
  });

  // Final reason counts (for completed tokens)
  const finalReasonCounts = {};
  tokens.filter(t => t.completed).forEach(t => {
    const reason = t.finalReason || 'unknown';
    finalReasonCounts[reason] = (finalReasonCounts[reason] || 0) + 1;
  });

  // Peak distribution
  const peakDist = {
    gte10: peakPnls.filter(v => v >= 10).length,
    gte25: peakPnls.filter(v => v >= 25).length,
    gte50: peakPnls.filter(v => v >= 50).length,
    gte100: peakPnls.filter(v => v >= 100).length,
    negative: peakPnls.filter(v => v < 0).length,
  };

  // Liquidity at time of removeLiquidity
  const removeLiqLiquidity = tokens
    .filter(t => t.removeLiquidityDetected && t.lastSnapshot?.solLiquidity)
    .map(t => t.lastSnapshot.solLiquidity);

  // Winners: tokens that had winnerTakeProfit trigger
  const winnerCount = tokens.filter(t => t.firstTrigger === 'winner take profit').length;

  // Check if winners got rugged after trigger
  const winnerRugged = tokens.filter(t => t.firstTrigger === 'winner take profit' && t.removeLiquidityDetected).length;

  return {
    totalTokens: tokens.length,
    activeJobs: tokens.filter(t => !t.completed).length,
    completedJobs: completedCount,
    removeLiquidityDetected: removeLiqCount,
    removeLiquidityRate: removeLiqCount / tokens.length,
    winnerCount,
    winnerRate: winnerCount / tokens.length,
    winnerRugged,
    winnerRuggedRate: winnerCount > 0 ? winnerRugged / winnerCount : 0,
    peakPnl: {
      count: peakPnls.length,
      min: peakPnls.length ? Math.min(...peakPnls) : null,
      max: peakPnls.length ? Math.max(...peakPnls) : null,
      avg: peakPnls.length ? peakPnls.reduce((a, b) => a + b, 0) / peakPnls.length : null,
      median: percentile(peakPnls, 50),
      p25: percentile(peakPnls, 25),
      p75: percentile(peakPnls, 75),
    },
    maxAdversePnl: {
      count: maxAdversePnls.length,
      min: maxAdversePnls.length ? Math.min(...maxAdversePnls) : null,
      max: maxAdversePnls.length ? Math.max(...maxAdversePnls) : null,
      avg: maxAdversePnls.length ? maxAdversePnls.reduce((a, b) => a + b, 0) / maxAdversePnls.length : null,
    },
    lifetimeMs: {
      count: lifetimes.length,
      min: lifetimes.length ? Math.min(...lifetimes) : null,
      max: lifetimes.length ? Math.max(...lifetimes) : null,
      avg: lifetimes.length ? lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length : null,
      median: percentile(lifetimes, 50),
    },
    peakDistribution: peakDist,
    firstTriggerCounts,
    finalReasonCounts,
    removeLiqLiquidity: {
      count: removeLiqLiquidity.length,
      min: removeLiqLiquidity.length ? Math.min(...removeLiqLiquidity) : null,
      max: removeLiqLiquidity.length ? Math.max(...removeLiqLiquidity) : null,
      avg: removeLiqLiquidity.length ? removeLiqLiquidity.reduce((a, b) => a + b, 0) / removeLiqLiquidity.length : null,
    },
  };
}

function formatMs(ms) {
  if (ms == null) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatPct(v) {
  if (v == null) return 'N/A';
  return `${v.toFixed(2)}%`;
}

function formatRate(v) {
  if (v == null) return 'N/A';
  return `${(v * 100).toFixed(1)}%`;
}

function generateTextReport(summary) {
  const lines = [];
  lines.push('=== CC Shadow Tracker Summary ===');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`Total CC values tracked: ${summary.byCc.length}`);
  lines.push('');

  // Overall stats
  const totalTokens = summary.byCc.reduce((s, cc) => s + (cc.stats?.totalTokens || 0), 0);
  const totalActive = summary.byCc.reduce((s, cc) => s + (cc.stats?.activeJobs || 0), 0);
  const totalRemoveLiq = summary.byCc.reduce((s, cc) => s + (cc.stats?.removeLiquidityDetected || 0), 0);
  const totalWinners = summary.byCc.reduce((s, cc) => s + (cc.stats?.winnerCount || 0), 0);
  lines.push(`Overall: ${totalTokens} tokens tracked, ${totalActive} active, ${totalRemoveLiq} rugged, ${totalWinners} winners`);
  lines.push('');

  // Per CC summary table
  lines.push('CC | Tokens | Active | Rugged | Winner | Avg Peak | Max Peak | Rugged Rate | Winner Rate');
  lines.push('--- | ------ | ------ | ------ | ------ | -------- | -------- | ----------- | -----------');
  for (const cc of summary.byCc) {
    const s = cc.stats;
    if (!s) continue;
    const avgPeak = s.peakPnl?.avg != null ? `${s.peakPnl.avg.toFixed(1)}%` : 'N/A';
    const maxPeak = s.peakPnl?.max != null ? `${s.peakPnl.max.toFixed(1)}%` : 'N/A';
    lines.push(
      `CC-${cc.cc} | ${s.totalTokens} | ${s.activeJobs} | ${s.removeLiquidityDetected} | ${s.winnerCount} | ${avgPeak} | ${maxPeak} | ${formatRate(s.removeLiquidityRate)} | ${formatRate(s.winnerRate)}`
    );
  }
  lines.push('');

  // Detailed per CC
  for (const cc of summary.byCc) {
    const s = cc.stats;
    if (!s) continue;
    lines.push(`--- CC-${cc.cc} Detailed ---`);
    lines.push(`  Tokens: ${s.totalTokens} (active: ${s.activeJobs}, completed: ${s.completedJobs})`);
    lines.push(`  Rugged: ${s.removeLiquidityDetected} (${formatRate(s.removeLiquidityRate)})`);
    lines.push(`  Winners (hit take profit): ${s.winnerCount} (${formatRate(s.winnerRate)})`);
    if (s.winnerCount > 0) {
      lines.push(`    Winners rugged after trigger: ${s.winnerRugged} (${formatRate(s.winnerRuggedRate)})`);
    }
    lines.push(`  Peak PnL: avg ${formatPct(s.peakPnl?.avg)} median ${formatPct(s.peakPnl?.median)} max ${formatPct(s.peakPnl?.max)}`);
    lines.push(`  Max adverse PnL: avg ${formatPct(s.maxAdversePnl?.avg)} min ${formatPct(s.maxAdversePnl?.min)}`);
    if (s.lifetimeMs?.count > 0) {
      lines.push(`  Lifetime: avg ${formatMs(s.lifetimeMs.avg)} median ${formatMs(s.lifetimeMs.median)} max ${formatMs(s.lifetimeMs.max)}`);
    }
    lines.push(`  Peak distribution: >=10% ${s.peakDistribution.gte10}, >=25% ${s.peakDistribution.gte25}, >=50% ${s.peakDistribution.gte50}, >=100% ${s.peakDistribution.gte100}, negative ${s.peakDistribution.negative}`);
    lines.push(`  First trigger counts: ${JSON.stringify(s.firstTriggerCounts)}`);
    if (Object.keys(s.finalReasonCounts).length > 0) {
      lines.push(`  Final reasons: ${JSON.stringify(s.finalReasonCounts)}`);
    }
    if (s.removeLiqLiquidity?.count > 0) {
      lines.push(`  Liquidity at rug: avg ${s.removeLiqLiquidity.avg.toFixed(2)} SOL, min ${s.removeLiqLiquidity.min.toFixed(2)} SOL`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function main() {
  console.log('Reading shadow tracker index...');
  const index = readJson(INDEX_JSON, null);
  if (!index || !index.byCc) {
    console.error('Index not found or invalid');
    process.exit(1);
  }

  const byCc = [];
  const ccKeys = Object.keys(index.byCc).sort((a, b) => Number(a) - Number(b));

  for (const ccKey of ccKeys) {
    const ccInfo = index.byCc[ccKey];
    const cc = Number(ccKey);
    console.log(`Processing CC-${cc}...`);

    const current = readJson(ccInfo.currentSummaryPath, null);
    const byToken = readJson(ccInfo.byTokenSummaryPath, {});

    const tokens = Object.values(byToken);
    const stats = computeStats(tokens);

    byCc.push({
      cc,
      activeJobs: ccInfo.activeJobs,
      stats,
      topPeaks: current?.topPeaks?.slice(0, 3) || [],
      worstDrawdowns: current?.worstDrawdowns?.slice(0, 3) || [],
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    byCc,
  };

  // Write JSON
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));
  console.log(`Written JSON: ${OUT_JSON}`);

  // Write TXT
  const txt = generateTextReport(summary);
  fs.writeFileSync(OUT_TXT, txt);
  console.log(`Written TXT: ${OUT_TXT}`);

  // Print summary to console
  console.log('\n' + txt);
}

main();