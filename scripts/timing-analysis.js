#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REPORT_JSON = path.join(ROOT, 'logs', 'paper-report.json');

function timeToSeconds(timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function timeDiff(start, end) {
  const startSec = timeToSeconds(start);
  const endSec = timeToSeconds(end);
  let diff = endSec - startSec;
  if (diff < 0) diff += 86400; // handle day wrap
  return diff;
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s}s`;
}

function loadReport() {
  if (!fs.existsSync(REPORT_JSON)) {
    console.error(`Report not found: ${REPORT_JSON}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
}

function analyzeWinTiming(operations) {
  const wins = operations.filter(op => op.pnlPct > 0);
  const losses = operations.filter(op => op.pnlPct < 0);

  console.log('\n=== WIN TIMING ANALYSIS ===');
  console.log(`Total wins: ${wins.length}`);
  
  if (wins.length > 0) {
    const buyToSellTimes = [];
    const holdDurations = [];
    const pnlValues = [];
    const exitReasons = {};

    for (const win of wins) {
      if (win.buyAt && win.sellAt) {
        const buyToSell = timeDiff(win.buyAt, win.sellAt);
        buyToSellTimes.push(buyToSell);
        holdDurations.push({
          buy: win.buyAt,
          sell: win.sellAt,
          duration: buyToSell,
          pnl: win.pnlPct,
          reason: win.holdLog?.exitReason || 'unknown',
        });
      }
      if (Number.isFinite(win.pnlPct)) pnlValues.push(win.pnlPct);
      const reason = win.holdLog?.exitReason || 'unknown';
      exitReasons[reason] = (exitReasons[reason] || 0) + 1;
    }

    if (buyToSellTimes.length > 0) {
      const sorted = [...buyToSellTimes].sort((a, b) => a - b);
      const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const median = sorted[Math.floor(sorted.length / 2)];
      const min = sorted[0];
      const max = sorted[sorted.length - 1];

      console.log(`\nBuy->Sell Duration:`);
      console.log(`  Min: ${formatSeconds(min)}`);
      console.log(`  Median: ${formatSeconds(median)}`);
      console.log(`  Avg: ${formatSeconds(Math.round(avg))}`);
      console.log(`  Max: ${formatSeconds(max)}`);

      const p25 = sorted[Math.floor(sorted.length * 0.25)];
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      console.log(`  P25: ${formatSeconds(p25)}`);
      console.log(`  P75: ${formatSeconds(p75)}`);
    }

    if (pnlValues.length > 0) {
      const sorted = [...pnlValues].sort((a, b) => a - b);
      const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const median = sorted[Math.floor(sorted.length / 2)];
      console.log(`\nProfit %:`);
      console.log(`  Min: ${sorted[0].toFixed(2)}%`);
      console.log(`  Median: ${median.toFixed(2)}%`);
      console.log(`  Avg: ${avg.toFixed(2)}%`);
      console.log(`  Max: ${sorted[sorted.length - 1].toFixed(2)}%`);
    }

    console.log(`\nExit Reasons (Wins):`);
    Object.entries(exitReasons)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => {
        console.log(`  ${reason}: ${count}`);
      });

    // Show early vs late wins
    const earlyWins = holdDurations.filter(h => h.duration < 60);
    const lateWins = holdDurations.filter(h => h.duration >= 300);
    console.log(`\nWin Distribution:`);
    console.log(`  <1m: ${earlyWins.length} (${(earlyWins.length / wins.length * 100).toFixed(1)}%)`);
    console.log(`  1-5m: ${holdDurations.filter(h => h.duration >= 60 && h.duration < 300).length}`);
    console.log(`  >5m: ${lateWins.length} (${(lateWins.length / wins.length * 100).toFixed(1)}%)`);

    // Show small wins vs large wins
    const smallWins = wins.filter(w => w.pnlPct < 10);
    const largeWins = wins.filter(w => w.pnlPct >= 50);
    console.log(`\nWin Size Distribution:`);
    console.log(`  <10%: ${smallWins.length} (${(smallWins.length / wins.length * 100).toFixed(1)}%)`);
    console.log(`  10-50%: ${wins.filter(w => w.pnlPct >= 10 && w.pnlPct < 50).length}`);
    console.log(`  >=50%: ${largeWins.length} (${(largeWins.length / wins.length * 100).toFixed(1)}%)`);
  }

  console.log('\n=== LOSS TIMING ANALYSIS ===');
  console.log(`Total losses: ${losses.length}`);

  if (losses.length > 0) {
    const buyToSellTimes = [];
    const holdDurations = [];
    const pnlValues = [];
    const exitReasons = {};

    for (const loss of losses) {
      if (loss.buyAt && loss.sellAt) {
        const buyToSell = timeDiff(loss.buyAt, loss.sellAt);
        buyToSellTimes.push(buyToSell);
        holdDurations.push({
          buy: loss.buyAt,
          sell: loss.sellAt,
          duration: buyToSell,
          pnl: loss.pnlPct,
          reason: loss.holdLog?.exitReason || 'unknown',
        });
      }
      if (Number.isFinite(loss.pnlPct)) pnlValues.push(loss.pnlPct);
      const reason = loss.holdLog?.exitReason || 'unknown';
      exitReasons[reason] = (exitReasons[reason] || 0) + 1;
    }

    if (buyToSellTimes.length > 0) {
      const sorted = [...buyToSellTimes].sort((a, b) => a - b);
      const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const median = sorted[Math.floor(sorted.length / 2)];
      const min = sorted[0];
      const max = sorted[sorted.length - 1];

      console.log(`\nBuy->Sell Duration:`);
      console.log(`  Min: ${formatSeconds(min)}`);
      console.log(`  Median: ${formatSeconds(median)}`);
      console.log(`  Avg: ${formatSeconds(Math.round(avg))}`);
      console.log(`  Max: ${formatSeconds(max)}`);

      const p25 = sorted[Math.floor(sorted.length * 0.25)];
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      console.log(`  P25: ${formatSeconds(p25)}`);
      console.log(`  P75: ${formatSeconds(p75)}`);
    }

    if (pnlValues.length > 0) {
      const sorted = [...pnlValues].sort((a, b) => a - b);
      const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const median = sorted[Math.floor(sorted.length / 2)];
      console.log(`\nLoss %:`);
      console.log(`  Max loss: ${sorted[0].toFixed(2)}%`);
      console.log(`  Median: ${median.toFixed(2)}%`);
      console.log(`  Avg: ${avg.toFixed(2)}%`);
      console.log(`  Min loss: ${sorted[sorted.length - 1].toFixed(2)}%`);
    }

    console.log(`\nExit Reasons (Losses):`);
    Object.entries(exitReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([reason, count]) => {
        console.log(`  ${reason}: ${count}`);
      });
  }

  // Correlation analysis
  console.log('\n=== TIMING vs PNL CORRELATION ===');
  const allOps = [...wins, ...losses].filter(op => op.buyAt && op.sellAt && Number.isFinite(op.pnlPct));
  if (allOps.length > 0) {
    const quickExits = allOps.filter(op => timeDiff(op.buyAt, op.sellAt) < 30);
    const quickExitAvgPnl = quickExits.length > 0
      ? quickExits.reduce((a, op) => a + op.pnlPct, 0) / quickExits.length
      : 0;

    const slowExits = allOps.filter(op => timeDiff(op.buyAt, op.sellAt) >= 300);
    const slowExitAvgPnl = slowExits.length > 0
      ? slowExits.reduce((a, op) => a + op.pnlPct, 0) / slowExits.length
      : 0;

    console.log(`  Quick exits (<30s): ${quickExits.length} ops, avg PnL: ${quickExitAvgPnl.toFixed(2)}%`);
    console.log(`  Slow exits (>5m): ${slowExits.length} ops, avg PnL: ${slowExitAvgPnl.toFixed(2)}%`);
  }
}

function main() {
  const report = loadReport();
  analyzeWinTiming(report.operations || []);
}

main();
