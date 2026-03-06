#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const LOG_PATH = path.join(ROOT, 'paper.log');
const OUT_JSON = path.join(ROOT, 'logs', 'paper-report.json');
const OUT_TXT = path.join(ROOT, 'logs', 'paper-report.txt');

const SUB_TO_DIGIT = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

function nowIso() {
  return new Date().toISOString();
}

function parseCompactSol(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const plain = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*SOL$/i);
  if (plain) return Number(plain[1]);

  const compact = s.match(/^0\.0([₀₁₂₃₄₅₆₇₈₉]+)([0-9]+(?:\.[0-9]+)?)\s*SOL$/i);
  if (compact) {
    const zeros = Number(compact[1].split('').map(c => SUB_TO_DIGIT[c] ?? '').join('') || '0');
    const digits = compact[2].replace('.', '');
    const scaleAdjust = compact[2].includes('.') ? (compact[2].length - compact[2].indexOf('.') - 1) : 0;
    const totalZeros = zeros + scaleAdjust;
    const num = Number(`0.${'0'.repeat(totalZeros)}${digits}`);
    return Number.isFinite(num) ? num : null;
  }

  return null;
}

const events = new Map();
let offset = 0;
let carry = '';
let lastWriteAt = 0;

function getEvent(id) {
  if (!events.has(id)) {
    events.set(id, {
      id,
      startedAt: null,
      endedAt: null,
      signature: null,
      tokenMint: null,
      pool: null,
      gmgn: null,
      buySpotSolPerToken: null,
      sellSpotSolPerToken: null,
      pnlSol: null,
      pnlPct: null,
      skipReason: null,
      checksPassed: false,
      endStatus: null,
      durationMs: null,
    });
  }
  return events.get(id);
}

function parseLine(line) {
  const ts = (line.match(/^\[([^\]]+)\]/) || [])[1] || null;

  let m = line.match(/🆕 NEW POOL \[([^\]]+)\]/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.startedAt = ev.startedAt || ts;
    return;
  }

  m = line.match(/Signature:\s*([A-Za-z0-9]+)/);
  if (m) {
    const latest = [...events.values()].reverse().find(e => !e.signature);
    if (latest) latest.signature = m[1];
    return;
  }

  m = line.match(/🎯 \[([^\]]+)\] Token:\s*([A-Za-z0-9]+)/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.tokenMint = m[2];
    return;
  }

  m = line.match(/📦 \[([^\]]+)\] Pool:\s*([A-Za-z0-9]+)/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.pool = m[2];
    return;
  }

  m = line.match(/GMGN:\s*(https:\/\/gmgn\.ai\/sol\/token\/[A-Za-z0-9]+)/);
  if (m) {
    const latest = [...events.values()].reverse().find(e => !e.gmgn && !e.endedAt);
    if (latest) latest.gmgn = m[1];
    return;
  }

  m = line.match(/\[([^\]]+)\] Buy Spot:\s*~([^/]+)\/token/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.buySpotSolPerToken = parseCompactSol(m[2].trim());
    return;
  }

  m = line.match(/\[([^\]]+)\] Sell Spot:\s*~([^/]+)\/token/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.sellSpotSolPerToken = parseCompactSol(m[2].trim());
    return;
  }

  m = line.match(/\[([^\]]+)\] PnL:\s*([+-]?)([^\(]+)\s*\(([-0-9.]+)%\)/);
  if (m) {
    const ev = getEvent(m[1]);
    const sign = m[2] === '-' ? -1 : 1;
    const abs = parseCompactSol(m[3].trim());
    ev.pnlSol = abs == null ? null : sign * abs;
    ev.pnlPct = Number(m[4]);
    return;
  }

  m = line.match(/🛑 \[([^\]]+)\] SKIP:\s*(.+)$/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.skipReason = m[2].trim();
    return;
  }

  m = line.match(/✅ \[([^\]]+)\] Checks passed/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.checksPassed = true;
    return;
  }

  m = line.match(/🏁 \[([^\]]+)\] END \((\d+)ms\)\s*(.+)$/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.durationMs = Number(m[2]);
    ev.endStatus = m[3].trim();
    ev.endedAt = ts || nowIso();
  }
}

function summarize() {
  const finished = [...events.values()].filter(e => e.endedAt);
  const pnlKnown = finished.filter(e => typeof e.pnlSol === 'number');
  const totalPnl = pnlKnown.reduce((a, e) => a + e.pnlSol, 0);
  const avgPnlPct = pnlKnown.length ? pnlKnown.reduce((a, e) => a + (e.pnlPct || 0), 0) / pnlKnown.length : 0;
  const wins = pnlKnown.filter(e => e.pnlSol > 0).length;
  const losses = pnlKnown.filter(e => e.pnlSol < 0).length;
  const checksPassed = finished.filter(e => e.checksPassed).length;
  const skipped = finished.filter(e => e.skipReason || (e.endStatus && e.endStatus.startsWith('SKIP'))).length;
  const rugPulls = finished.filter(e => {
    const s = `${e.skipReason || ''} ${e.endStatus || ''}`.toLowerCase();
    return (typeof e.pnlPct === 'number' && e.pnlPct <= -80) ||
      s.includes('paper simulation guard') ||
      s.includes('exit returned 0 sol') ||
      s.includes('liquidity stop');
  });

  return {
    generatedAt: nowIso(),
    eventsSeen: events.size,
    finishedEvents: finished.length,
    checksPassed,
    skipped,
    rugPullCount: rugPulls.length,
    totalPnlSol: Number(totalPnl.toFixed(9)),
    avgPnlPct: Number(avgPnlPct.toFixed(4)),
    wins,
    losses,
    winRatePct: pnlKnown.length ? Number(((wins / pnlKnown.length) * 100).toFixed(2)) : 0,
    last10: finished.slice(-10).map(e => ({
      id: e.id,
      signature: e.signature,
      tokenMint: e.tokenMint,
      pnlSol: e.pnlSol,
      pnlPct: e.pnlPct,
      skipReason: e.skipReason,
      endStatus: e.endStatus,
      durationMs: e.durationMs,
    })),
    rugPullEvents: rugPulls.slice(-20).map(e => ({
      id: e.id,
      signature: e.signature,
      tokenMint: e.tokenMint,
      pnlPct: e.pnlPct,
      skipReason: e.skipReason,
      endStatus: e.endStatus,
    })),
  };
}

function writeReports(force = false) {
  const now = Date.now();
  if (!force && now - lastWriteAt < 1000) return;
  lastWriteAt = now;

  const report = summarize();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const txt = [
    `Paper Trade Report @ ${report.generatedAt}`,
    `events seen: ${report.eventsSeen}`,
    `finished: ${report.finishedEvents}`,
    `checks passed: ${report.checksPassed}`,
    `skipped: ${report.skipped}`,
    `rug pulls: ${report.rugPullCount}`,
    `total pnl (SOL): ${report.totalPnlSol}`,
    `avg pnl (%): ${report.avgPnlPct}`,
    `wins/losses: ${report.wins}/${report.losses}`,
    `win rate: ${report.winRatePct}%`,
    '',
    'Recent events:',
    ...report.last10.map(e => `- ${e.id} ${e.tokenMint || ''} pnl=${e.pnlSol ?? 'n/a'} (${e.pnlPct ?? 'n/a'}%) status=${e.endStatus || 'n/a'}`),
  ].join('\n');
  fs.writeFileSync(OUT_TXT, txt + '\n');
}

function processChunk(chunk) {
  const combined = carry + chunk;
  const lines = combined.split(/\r?\n/);
  carry = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    parseLine(line);
  }
  writeReports();
}

function initialLoad() {
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, '');
  }
  const content = fs.readFileSync(LOG_PATH, 'utf8');
  offset = Buffer.byteLength(content);
  processChunk(content);
  writeReports(true);
}

function pollLoop() {
  setInterval(() => {
    try {
      const stat = fs.statSync(LOG_PATH);
      if (stat.size < offset) {
        offset = 0;
        carry = '';
      }
      if (stat.size === offset) return;

      const stream = fs.createReadStream(LOG_PATH, { start: offset, end: stat.size - 1, encoding: 'utf8' });
      let chunk = '';
      stream.on('data', (d) => { chunk += d; });
      stream.on('end', () => {
        offset = stat.size;
        if (chunk) processChunk(chunk);
      });
    } catch (e) {
      // keep daemon alive; write heartbeat report
      writeReports(true);
    }
  }, 1000);
}

initialLoad();
pollLoop();
console.log(`[paper-report-daemon] watching ${LOG_PATH}`);
console.log(`[paper-report-daemon] writing ${OUT_JSON} and ${OUT_TXT}`);
