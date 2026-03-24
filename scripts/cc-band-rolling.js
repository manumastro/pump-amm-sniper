#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REPORT_JSON = path.join(ROOT, 'logs', 'paper-report.json');
const SKIP_HISTORY_JSON = path.join(ROOT, 'logs', 'skip-analysis-history.json');
const OUT_HISTORY_JSON = path.join(ROOT, 'logs', 'cc-band-history.json');
const OUT_LATEST_JSON = path.join(ROOT, 'logs', 'cc-band-latest.json');
const OUT_LATEST_TXT = path.join(ROOT, 'logs', 'cc-band-latest.txt');

const LIQ_THRESHOLD_USD = Number(process.env.CC_BAND_LIQ_THRESHOLD_USD || 10000);
const WINDOWS_DAYS = (process.env.CC_BAND_WINDOWS_DAYS || '1,3,7,14,30')
  .split(',')
  .map((x) => Number(x.trim()))
  .filter((x) => Number.isFinite(x) && x > 0);

const GOOD_OUTCOMES = new Set(['gain', 'big_gain', 'moon']);
const BAD_OUTCOMES = new Set(['dead', 'heavy_loss', 'loss', 'rug_suspect']);

const BANDS = [
  { key: 'cc_2', label: '2', test: (cc) => cc === 2 },
  { key: 'cc_3', label: '3', test: (cc) => cc === 3 },
  { key: 'cc_4', label: '4', test: (cc) => cc === 4 },
  { key: 'cc_5', label: '5', test: (cc) => cc === 5 },
  { key: 'cc_6_7', label: '6-7', test: (cc) => cc >= 6 && cc <= 7 },
  { key: 'cc_8_15', label: '8-15', test: (cc) => cc >= 8 && cc <= 15 },
  { key: 'cc_16_30', label: '16-30', test: (cc) => cc >= 16 && cc <= 30 },
  { key: 'cc_31_60', label: '31-60', test: (cc) => cc >= 31 && cc <= 60 },
  { key: 'cc_61_100', label: '61-100', test: (cc) => cc >= 61 && cc <= 100 },
  { key: 'cc_101_150', label: '101-150', test: (cc) => cc >= 101 && cc <= 150 },
  { key: 'cc_151_200', label: '151-200', test: (cc) => cc >= 151 && cc <= 200 },
  { key: 'cc_201_300', label: '201-300', test: (cc) => cc >= 201 && cc <= 300 },
  { key: 'cc_301_plus', label: '301+', test: (cc) => cc >= 301 },
];

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseCcFromReason(reason) {
  const text = String(reason || '');
  const m = text.match(/unique counterparties\s+(\d+)\s*>=\s*\d+/i);
  if (!m) return null;
  const cc = Number(m[1]);
  return Number.isFinite(cc) ? cc : null;
}

function classifyOutcome(outcome) {
  if (GOOD_OUTCOMES.has(outcome)) return 'good';
  if (BAD_OUTCOMES.has(outcome)) return 'bad';
  if (outcome === 'no_data') return 'noData';
  return 'neutral';
}

function emptyStats() {
  return {
    total: 0,
    good: 0,
    bad: 0,
    noData: 0,
    neutral: 0,
    goodPctKnown: 0,
    goodPctTotal: 0,
  };
}

function finalizeStats(stats) {
  const known = stats.good + stats.bad;
  stats.goodPctKnown = known > 0 ? Number(((stats.good / known) * 100).toFixed(1)) : 0;
  stats.goodPctTotal = stats.total > 0 ? Number(((stats.good / stats.total) * 100).toFixed(1)) : 0;
  return stats;
}

function computeBandStats(rows) {
  const perBand = {};
  for (const band of BANDS) {
    const stats = emptyStats();
    const matched = rows.filter((r) => band.test(r.cc));
    for (const row of matched) {
      stats.total += 1;
      const cls = classifyOutcome(row.outcome);
      if (cls === 'good') stats.good += 1;
      else if (cls === 'bad') stats.bad += 1;
      else if (cls === 'noData') stats.noData += 1;
      else stats.neutral += 1;
    }
    perBand[band.key] = finalizeStats(stats);
  }

  const all = emptyStats();
  for (const row of rows) {
    all.total += 1;
    const cls = classifyOutcome(row.outcome);
    if (cls === 'good') all.good += 1;
    else if (cls === 'bad') all.bad += 1;
    else if (cls === 'noData') all.noData += 1;
    else all.neutral += 1;
  }

  return {
    all: finalizeStats(all),
    bands: perBand,
  };
}

function dedupeLatestRows(rows) {
  const latestByToken = new Map();
  for (const row of rows) {
    const prev = latestByToken.get(row.token);
    if (!prev || row.tsMs > prev.tsMs) {
      latestByToken.set(row.token, row);
    }
  }
  return [...latestByToken.values()];
}

function renderBandTable(title, stats) {
  const lines = [];
  lines.push(title);
  lines.push('band      total  good  bad  noData  neutral  good%known  good%total');
  lines.push('--------  -----  ----  ---  ------  -------  ----------  ----------');

  const all = stats.all;
  lines.push(
    [
      'all'.padEnd(8),
      String(all.total).padStart(5),
      String(all.good).padStart(4),
      String(all.bad).padStart(3),
      String(all.noData).padStart(6),
      String(all.neutral).padStart(7),
      `${all.goodPctKnown.toFixed(1)}%`.padStart(10),
      `${all.goodPctTotal.toFixed(1)}%`.padStart(10),
    ].join('  ')
  );

  for (const band of BANDS) {
    const s = stats.bands[band.key];
    lines.push(
      [
        band.label.padEnd(8),
        String(s.total).padStart(5),
        String(s.good).padStart(4),
        String(s.bad).padStart(3),
        String(s.noData).padStart(6),
        String(s.neutral).padStart(7),
        `${s.goodPctKnown.toFixed(1)}%`.padStart(10),
        `${s.goodPctTotal.toFixed(1)}%`.padStart(10),
      ].join('  ')
    );
  }

  return lines;
}

function main() {
  const report = readJson(REPORT_JSON, null);
  const skipHistory = readJson(SKIP_HISTORY_JSON, []);
  const latestSkip = skipHistory.length ? skipHistory[skipHistory.length - 1] : null;

  if (!report || !latestSkip) {
    console.error('Missing required inputs: logs/paper-report.json and logs/skip-analysis-history.json');
    process.exit(1);
  }

  const ccByToken = new Map();
  for (const op of report.operations || []) {
    const cc = parseCcFromReason(op.skipReason || op.endStatus || '');
    if (!Number.isFinite(cc)) continue;
    const token = op.tokenMint;
    if (!token || token === 'None') continue;
    ccByToken.set(token, cc);
  }

  const rowsNow = [];
  for (const tokenRow of latestSkip.tokens || []) {
    const cc = ccByToken.get(tokenRow.token);
    if (!Number.isFinite(cc)) continue;
    rowsNow.push({
      token: tokenRow.token,
      cc,
      outcome: tokenRow.outcome || 'no_data',
      liquidityUsd: Number(tokenRow.liquidityUsd) || 0,
      change24h: Number(tokenRow.change24h) || 0,
      symbol: tokenRow.symbol || '?',
    });
  }

  const runTs = new Date().toISOString();
  const history = readJson(OUT_HISTORY_JSON, []);
  const nextEntry = {
    timestamp: runTs,
    sourceSkipTimestamp: latestSkip.timestamp || null,
    sourceReportTimestamp: report.generatedAt || null,
    tokenRows: rowsNow,
  };

  if (history.length > 0) {
    const last = history[history.length - 1];
    const sameSource =
      last.sourceSkipTimestamp === nextEntry.sourceSkipTimestamp &&
      last.sourceReportTimestamp === nextEntry.sourceReportTimestamp;
    if (sameSource) {
      history[history.length - 1] = nextEntry;
    } else {
      history.push(nextEntry);
    }
  } else {
    history.push(nextEntry);
  }

  fs.mkdirSync(path.dirname(OUT_HISTORY_JSON), { recursive: true });
  fs.writeFileSync(OUT_HISTORY_JSON, JSON.stringify(history, null, 2));

  const nowStatsAll = computeBandStats(rowsNow);
  const rowsNowLiq = rowsNow.filter((r) => r.liquidityUsd >= LIQ_THRESHOLD_USD);
  const nowStatsLiq = computeBandStats(rowsNowLiq);

  const rolling = [];
  for (const days of WINDOWS_DAYS) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const windowRows = [];
    for (const entry of history) {
      const ts = Date.parse(entry.timestamp);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      for (const row of entry.tokenRows || []) {
        windowRows.push({ ...row, tsMs: ts });
      }
    }

    const dedupRows = dedupeLatestRows(windowRows);
    const dedupRowsLiq = dedupRows.filter((r) => r.liquidityUsd >= LIQ_THRESHOLD_USD);

    rolling.push({
      days,
      snapshots: history.filter((e) => {
        const ts = Date.parse(e.timestamp);
        return Number.isFinite(ts) && ts >= cutoff;
      }).length,
      uniqueTokens: dedupRows.length,
      uniqueTokensLiq: dedupRowsLiq.length,
      allLiquidity: computeBandStats(dedupRows),
      liqThreshold: computeBandStats(dedupRowsLiq),
    });
  }

  const latest = {
    generatedAt: runTs,
    historySize: history.length,
    liqThresholdUsd: LIQ_THRESHOLD_USD,
    windowsDays: WINDOWS_DAYS,
    currentSnapshot: {
      sourceSkipTimestamp: latestSkip.timestamp || null,
      sourceReportTimestamp: report.generatedAt || null,
      tokenCount: rowsNow.length,
      tokenCountLiq: rowsNowLiq.length,
      allLiquidity: nowStatsAll,
      liqThreshold: nowStatsLiq,
    },
    rolling,
  };

  fs.writeFileSync(OUT_LATEST_JSON, JSON.stringify(latest, null, 2));

  const txt = [];
  txt.push(`CC Band Rolling Report @ ${runTs}`);
  txt.push(`history snapshots: ${history.length}`);
  txt.push(`liq threshold: $${LIQ_THRESHOLD_USD}`);
  txt.push('');
  txt.push(...renderBandTable('Current Snapshot - all liquidity', nowStatsAll));
  txt.push('');
  txt.push(...renderBandTable(`Current Snapshot - liquidity >= $${LIQ_THRESHOLD_USD}`, nowStatsLiq));

  for (const w of rolling) {
    txt.push('');
    txt.push(`Rolling ${w.days}d (snapshots=${w.snapshots}, uniq_tokens=${w.uniqueTokens}, uniq_tokens_liq=${w.uniqueTokensLiq})`);
    txt.push(...renderBandTable('  all liquidity', w.allLiquidity));
    txt.push('');
    txt.push(...renderBandTable(`  liquidity >= $${LIQ_THRESHOLD_USD}`, w.liqThreshold));
  }

  fs.writeFileSync(OUT_LATEST_TXT, `${txt.join('\n')}\n`);

  console.log(`[cc-band-rolling] rows now: ${rowsNow.length} (liq>=${LIQ_THRESHOLD_USD}: ${rowsNowLiq.length})`);
  console.log(`[cc-band-rolling] history: ${OUT_HISTORY_JSON}`);
  console.log(`[cc-band-rolling] latest : ${OUT_LATEST_JSON}`);
  console.log(`[cc-band-rolling] text   : ${OUT_LATEST_TXT}`);
}

main();
