#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REPORT_JSON = path.join(ROOT, 'logs', 'paper-report.json');
const OUT_JSON = path.join(ROOT, 'logs', 'wins-report.json');
const OUT_TXT = path.join(ROOT, 'logs', 'wins-report.txt');

function loadReport() {
  if (!fs.existsSync(REPORT_JSON)) {
    console.error(`Report not found: ${REPORT_JSON}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
}

function toNumberOrNull(value, decimals = 6) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function getCc(operation) {
  const cc = Number(operation?.entryFilters?.cr_uniqueCounterparties?.observed);
  if (Number.isFinite(cc)) return cc;
  return null;
}

function buildWins(report) {
  const ops = report.operations || [];
  const wins = ops
    .filter((op) => typeof op.pnlPct === 'number' && Number.isFinite(op.pnlPct) && op.pnlPct > 0)
    .map((op) => ({
      id: op.id,
      signature: op.signature,
      tokenMint: op.tokenMint,
      gmgn: op.gmgn || (op.tokenMint ? `https://gmgn.ai/sol/token/${op.tokenMint}` : null),
      startedAt: op.startedAt || null,
      buyAt: op.buyAt || null,
      sellAt: op.sellAt || null,
      pnlAt: op.pnlAt || null,
      endedAt: op.endedAt || null,
      endStatus: op.endStatus || null,
      pnlSol: toNumberOrNull(op.pnlSol, 6),
      pnlPct: toNumberOrNull(op.pnlPct, 2),
      exitReason: op?.holdLog?.exitReason || null,
      cc: getCc(op),
    }));

  return wins;
}

function writeTxt(report, rows) {
  const lines = [];
  lines.push(`generatedAt=${report.generatedAt || '-'}`);
  lines.push(`winsCount=${rows.length}`);
  lines.push('');
  lines.push('id | startedAt | buyAt | sellAt | pnlAt | endedAt | pnlPct | pnlSol | cc | exitReason | gmgn');

  for (const row of rows) {
    lines.push(
      `${row.id || '-'} | ${row.startedAt || '-'} | ${row.buyAt || '-'} | ${row.sellAt || '-'} | ${row.pnlAt || '-'} | ${row.endedAt || '-'} | ${row.pnlPct ?? '-'} | ${row.pnlSol ?? '-'} | ${row.cc ?? '-'} | ${row.exitReason || '-'} | ${row.gmgn || '-'}`
    );
  }

  fs.writeFileSync(OUT_TXT, `${lines.join('\n')}\n`);
}

function main() {
  const report = loadReport();
  const wins = buildWins(report);
  const payload = {
    generatedAt: report.generatedAt || null,
    winsCount: wins.length,
    wins,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));
  writeTxt(report, wins);

  console.log(JSON.stringify({
    winsCount: wins.length,
    outJson: OUT_JSON,
    outTxt: OUT_TXT,
  }, null, 2));
}

main();
