#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REPORT_JSON = path.join(ROOT, 'logs', 'paper-report.json');
const OUT_JSON = path.join(ROOT, 'logs', 'loss-controls-report.json');
const OUT_TXT = path.join(ROOT, 'logs', 'loss-controls-report.txt');

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

function isLoss(operation) {
  if (typeof operation.pnlPct === 'number' && Number.isFinite(operation.pnlPct)) {
    return operation.pnlPct <= 0;
  }
  return String(operation.endStatus || '').toUpperCase().includes('PAPER LOSS');
}

function buildLosses(report) {
  const ops = report.operations || [];
  return ops
    .filter((op) => isLoss(op))
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
      skipReason: op.skipReason || null,
      pnlSol: toNumberOrNull(op.pnlSol, 6),
      pnlPct: toNumberOrNull(op.pnlPct, 2),
      cc: getCc(op),
      exitReason: op?.holdLog?.exitReason || null,
      preBuyControls: {
        entryFilters: op.entryFilters || null,
        preBuyUltraGuard: op.preBuyUltraGuard || null,
        noWsolRetryCount: Number(op.noWsolRetryCount || 0),
        noWsolRetryRecovered: !!op.noWsolRetryRecovered,
        noWsolRetryExhausted: !!op.noWsolRetryExhausted,
      },
      holdControls: {
        holdLog: op.holdLog || null,
        guards: op?.holdLog?.guards || null,
        triggers: op?.holdLog?.triggers || null,
      },
    }));
}

function writeTxt(report, rows) {
  const lines = [];
  lines.push(`generatedAt=${report.generatedAt || '-'}`);
  lines.push(`lossCount=${rows.length}`);
  lines.push('');

  for (const row of rows) {
    lines.push(`id=${row.id || '-'}`);
    lines.push(`token=${row.tokenMint || '-'}`);
    lines.push(`gmgn=${row.gmgn || '-'}`);
    lines.push(`timestamps start=${row.startedAt || '-'} buy=${row.buyAt || '-'} sell=${row.sellAt || '-'} pnl=${row.pnlAt || '-'} end=${row.endedAt || '-'}`);
    lines.push(`status=${row.endStatus || '-'} skipReason=${row.skipReason || '-'} exitReason=${row.exitReason || '-'}`);
    lines.push(`pnlPct=${row.pnlPct ?? '-'} pnlSol=${row.pnlSol ?? '-'} cc=${row.cc ?? '-'}`);
    lines.push(`preBuy.noWsol retryCount=${row.preBuyControls.noWsolRetryCount} recovered=${row.preBuyControls.noWsolRetryRecovered} exhausted=${row.preBuyControls.noWsolRetryExhausted}`);
    lines.push(`preBuy.entryFilters=${JSON.stringify(row.preBuyControls.entryFilters)}`);
    lines.push(`preBuy.ultraGuard=${JSON.stringify(row.preBuyControls.preBuyUltraGuard)}`);
    lines.push(`hold.guards=${JSON.stringify(row.holdControls.guards)}`);
    lines.push(`hold.triggers=${JSON.stringify(row.holdControls.triggers)}`);
    lines.push('---');
  }

  fs.writeFileSync(OUT_TXT, `${lines.join('\n')}\n`);
}

function main() {
  const report = loadReport();
  const losses = buildLosses(report);
  const payload = {
    generatedAt: report.generatedAt || null,
    lossesCount: losses.length,
    losses,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));
  writeTxt(report, losses);

  console.log(JSON.stringify({
    lossesCount: losses.length,
    outJson: OUT_JSON,
    outTxt: OUT_TXT,
  }, null, 2));
}

main();
