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

function fmtNum(v, digits = 12) {
  return typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(digits)) : null;
}

const events = new Map();
let offset = 0;
let carry = '';
let lastWriteAt = 0;
let eventSeq = 0;
let currentEventId = null;

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
      buyAt: null,
      sellAt: null,
      pnlAt: null,
      buySpotSolPerToken: null,
      sellSpotSolPerToken: null,
      pnlSol: null,
      pnlPct: null,
      skipReason: null,
      checksPassed: false,
      endStatus: null,
      durationMs: null,
      sawRelayFunding: false,
      relayFundingRoot: null,
      relayFundingFunder: null,
      relayFundingInboundSol: null,
      relayFundingOutboundSol: null,
      relayFundingWindowSec: null,
      creatorRiskFunder: null,
      creatorRiskRefundSol: null,
      creatorRiskMicroTransfers: 0,
      creatorRiskMicroSources: 0,
      creatorCashoutTotalSol: null,
      creatorCashoutMaxSol: null,
      creatorCashoutRelPct: null,
      creatorCashoutScore: null,
      creatorCashoutDest: null,
    });
  }
  return events.get(id);
}

function classifyOperation(e) {
  const status = `${e.skipReason || ''} ${e.endStatus || ''}`.toLowerCase();
  const hostile =
    (typeof e.pnlPct === 'number' && e.pnlPct <= -80) ||
    status.includes('paper simulation guard') ||
    status.includes('exit returned 0 sol') ||
    status.includes('liquidity stop') ||
    status.includes('creator risk') ||
    status.includes('token security');
  if (hostile) return 'hostile';

  const greyZone =
    e.sawRelayFunding ||
    (typeof e.creatorCashoutScore === 'number' && e.creatorCashoutScore >= 0.5) ||
    e.creatorRiskMicroTransfers >= 4 ||
    (!!e.creatorRiskFunder && e.creatorRiskFunder !== '-');
  if (greyZone) return 'grey-zone';

  return 'clean';
}

function getCurrentEvent() {
  if (currentEventId && events.has(currentEventId)) return events.get(currentEventId);
  const latestOpen = [...events.values()].reverse().find(e => !e.endedAt);
  return latestOpen || null;
}

function parseLine(line) {
  const ts = (line.match(/^\[([^\]]+)\]/) || [])[1] || null;
  const stageLine = line.match(/^\[[^\]]+\]\s+(?:([^\s|]+)\s+\|\s+)?([^|]+?)\s+\|\s+(.+)$/);
  if (stageLine) {
    const maybeId = stageLine[1] ? stageLine[1].replace(/^\[|\]$/g, '') : null;
    const stage = stageLine[2].trim();
    const message = stageLine[3].trim();

    let ev = null;
    if (maybeId && maybeId.includes('...')) {
      ev = getEvent(maybeId);
      currentEventId = maybeId;
    } else {
      ev = getCurrentEvent();
    }

    if (stage === 'NEW') {
      if (!ev) {
        const id = `evt-${String(++eventSeq).padStart(6, '0')}`;
        ev = getEvent(id);
      }
      currentEventId = ev.id;
      ev.startedAt = ev.startedAt || ts;
      return;
    }

    if (stage === 'SIGNATURE') {
      ev.signature = message;
      return;
    }

    if (stage === 'TOKEN') {
      ev.tokenMint = message;
      return;
    }

    if (stage === 'POOL') {
      ev.pool = message;
      return;
    }

    if (stage === 'GMGN') {
      ev.gmgn = message;
      return;
    }

    if (stage === 'BUY_SPOT') {
      ev.buyAt = ts || ev.buyAt;
      ev.buySpotSolPerToken = parseCompactSol(message.replace(/^\~/, '').replace(/\/token$/i, '').trim());
      return;
    }

    if (stage === 'SELL_SPOT') {
      ev.sellAt = ts || ev.sellAt;
      ev.sellSpotSolPerToken = parseCompactSol(message.replace(/^\~/, '').replace(/\/token$/i, '').trim());
      return;
    }

    if (stage === 'PNL') {
      const m = message.match(/^([+-]?)(.+)\s+\(([-0-9.]+)%\)$/);
      if (m) {
        ev.pnlAt = ts || ev.pnlAt;
        const pct = Number(m[3]);
        const sign = m[1] === '-' ? -1 : (pct < 0 ? -1 : 1);
        const abs = parseCompactSol(m[2].trim());
        ev.pnlSol = abs == null ? null : sign * abs;
        ev.pnlPct = pct;
      }
      return;
    }

    if (stage === 'CRISK') {
      const funder = (message.match(/funder=([^\s]+)/) || [])[1] || null;
      const refund = Number((message.match(/refund=([0-9.]+)/) || [])[1] || '0');
      const micro = (message.match(/micro=(\d+)\/(\d+)/) || []);
      ev.creatorRiskFunder = funder && funder !== '-' ? funder : ev.creatorRiskFunder;
      ev.creatorRiskRefundSol = refund;
      ev.creatorRiskMicroTransfers = micro[1] ? Number(micro[1]) : ev.creatorRiskMicroTransfers;
      ev.creatorRiskMicroSources = micro[2] ? Number(micro[2]) : ev.creatorRiskMicroSources;
      return;
    }

    if (stage === 'RRELAY') {
      const root = (message.match(/root=([^\s]+)/) || [])[1] || null;
      const funder = (message.match(/funder=([^\s]+)/) || [])[1] || null;
      const inbound = Number((message.match(/in=([0-9.]+)/) || [])[1] || '0');
      const outbound = Number((message.match(/out=([0-9.]+)/) || [])[1] || '0');
      const windowSec = Number((message.match(/window=([0-9.]+|n\/a)s/) || [])[1]);
      ev.sawRelayFunding = true;
      ev.relayFundingRoot = root && root !== '-' ? root : ev.relayFundingRoot;
      ev.relayFundingFunder = funder && funder !== '-' ? funder : ev.relayFundingFunder;
      ev.relayFundingInboundSol = inbound || ev.relayFundingInboundSol;
      ev.relayFundingOutboundSol = outbound || ev.relayFundingOutboundSol;
      ev.relayFundingWindowSec = Number.isFinite(windowSec) ? windowSec : ev.relayFundingWindowSec;
      return;
    }

    if (stage === 'CCASH') {
      const total = Number((message.match(/total=([0-9.]+)/) || [])[1] || '0');
      const max = Number((message.match(/max=([0-9.]+)/) || [])[1] || '0');
      const rel = Number((message.match(/rel=([0-9.]+)/) || [])[1] || '0');
      const score = Number((message.match(/score=([0-9.]+)/) || [])[1] || '0');
      const dest = (message.match(/dest=([^\s]+)/) || [])[1] || null;
      ev.creatorCashoutTotalSol = total;
      ev.creatorCashoutMaxSol = max;
      ev.creatorCashoutRelPct = rel;
      ev.creatorCashoutScore = score;
      ev.creatorCashoutDest = dest && dest !== '-' ? dest : ev.creatorCashoutDest;
      return;
    }

    if (stage === 'CHECKS' && message === 'passed') {
      ev.checksPassed = true;
      return;
    }

    if (stage === 'END') {
      if (!ev) return;
      const m = message.match(/^(.*?)\s+\((\d+)ms(?:,\s*active=\d+)?\)$/);
      ev.endStatus = m ? m[1].trim() : message;
      ev.durationMs = m ? Number(m[2]) : ev.durationMs;
      ev.endedAt = ts || nowIso();
      currentEventId = null;
      return;
    }
    if (!ev) return;
  }

  let m = line.match(/🆕 NEW POOL \[([^\]]+)\]/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.startedAt = ev.startedAt || ts;
    return;
  }

  m = line.match(/Signature:\s*([A-Za-z0-9]+)/);
  if (m) {
    const latest = getCurrentEvent() || [...events.values()].reverse().find(e => !e.signature);
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

  m = line.match(/🔗 \[([^\]]+)\] GMGN:\s*(https:\/\/gmgn\.ai\/sol\/token\/[A-Za-z0-9]+)/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.gmgn = m[2];
    return;
  }

  m = line.match(/GMGN:\s*(https:\/\/gmgn\.ai\/sol\/token\/[A-Za-z0-9]+)/);
  if (m) {
    const latest = getCurrentEvent() || [...events.values()].reverse().find(e => !e.gmgn && !e.endedAt);
    if (latest) latest.gmgn = m[1];
    return;
  }

  m = line.match(/\[([^\]]+)\] Buy Spot:\s*~([^/]+)\/token/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.buyAt = ts || ev.buyAt;
    ev.buySpotSolPerToken = parseCompactSol(m[2].trim());
    return;
  }

  m = line.match(/\[([^\]]+)\] Sell Spot:\s*~([^/]+)\/token/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.sellAt = ts || ev.sellAt;
    ev.sellSpotSolPerToken = parseCompactSol(m[2].trim());
    return;
  }

  m = line.match(/\[([^\]]+)\] PnL:\s*([+-]?)([^\(]+)\s*\(([-0-9.]+)%\)/);
  if (m) {
    const ev = getEvent(m[1]);
    ev.pnlAt = ts || ev.pnlAt;
    const pct = Number(m[4]);
    const sign = m[2] === '-' ? -1 : (pct < 0 ? -1 : 1);
    const abs = parseCompactSol(m[3].trim());
    ev.pnlSol = abs == null ? null : sign * abs;
    ev.pnlPct = pct;
    return;
  }

  m = line.match(/🛑 (?:\[([^\]]+)\]|([^\s]+))? ?SKIP:\s*(.+)$/);
  if (m) {
    const ev = m[1] || m[2] ? getEvent(m[1] || m[2]) : getCurrentEvent();
    if (ev) ev.skipReason = m[3].trim();
    return;
  }

  m = line.match(/✅ (?:\[([^\]]+)\]|([^\s]+))? ?Checks passed/);
  if (m) {
    const ev = m[1] || m[2] ? getEvent(m[1] || m[2]) : getCurrentEvent();
    if (ev) ev.checksPassed = true;
    return;
  }

  m = line.match(/🏁 (?:\[([^\]]+)\]|([^\s]+))? ?END \((\d+)ms\)\s*(.+)$/);
  if (m) {
    const ev = m[1] || m[2] ? getEvent(m[1] || m[2]) : getCurrentEvent();
    if (ev) {
      ev.durationMs = Number(m[3]);
      ev.endStatus = m[4].trim();
      ev.endedAt = ts || nowIso();
      currentEventId = null;
    }
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
  const isRugPull = (e) => {
    const s = `${e.skipReason || ''} ${e.endStatus || ''}`.toLowerCase();
    return (typeof e.pnlPct === 'number' && e.pnlPct <= -80) ||
      s.includes('paper simulation guard') ||
      s.includes('exit returned 0 sol') ||
      s.includes('liquidity stop');
  };
  const rugPulls = finished.filter(isRugPull);

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
    operations: finished.map(e => ({
      id: e.id,
      startedAt: e.startedAt,
      buyAt: e.buyAt,
      sellAt: e.sellAt,
      pnlAt: e.pnlAt,
      endedAt: e.endedAt,
      signature: e.signature,
      tokenMint: e.tokenMint,
      pool: e.pool,
      gmgn: e.gmgn || (e.tokenMint ? `https://gmgn.ai/sol/token/${e.tokenMint}` : null),
      buySpotSolPerToken: fmtNum(e.buySpotSolPerToken),
      sellSpotSolPerToken: fmtNum(e.sellSpotSolPerToken),
      pnlSol: e.pnlSol,
      pnlPct: e.pnlPct,
      checksPassed: e.checksPassed,
      skipReason: e.skipReason,
      endStatus: e.endStatus,
      durationMs: e.durationMs,
      rugPull: isRugPull(e),
      classification: classifyOperation(e),
      sawRelayFunding: e.sawRelayFunding,
      relayFundingRoot: e.relayFundingRoot,
      relayFundingFunder: e.relayFundingFunder,
      relayFundingInboundSol: e.relayFundingInboundSol,
      relayFundingOutboundSol: e.relayFundingOutboundSol,
      relayFundingWindowSec: e.relayFundingWindowSec,
      creatorRiskFunder: e.creatorRiskFunder,
      creatorRiskRefundSol: e.creatorRiskRefundSol,
      creatorRiskMicroTransfers: e.creatorRiskMicroTransfers,
      creatorRiskMicroSources: e.creatorRiskMicroSources,
      creatorCashoutTotalSol: e.creatorCashoutTotalSol,
      creatorCashoutMaxSol: e.creatorCashoutMaxSol,
      creatorCashoutRelPct: e.creatorCashoutRelPct,
      creatorCashoutScore: e.creatorCashoutScore,
      creatorCashoutDest: e.creatorCashoutDest,
    })),
    last10: finished.slice(-10).map(e => ({
      id: e.id,
      signature: e.signature,
      tokenMint: e.tokenMint,
      pnlSol: e.pnlSol,
      pnlPct: e.pnlPct,
      skipReason: e.skipReason,
      endStatus: e.endStatus,
      durationMs: e.durationMs,
      classification: classifyOperation(e),
    })),
    rugPullEvents: rugPulls.slice(-20).map(e => ({
      id: e.id,
      startedAt: e.startedAt,
      buyAt: e.buyAt,
      sellAt: e.sellAt,
      pnlAt: e.pnlAt,
      endedAt: e.endedAt,
      signature: e.signature,
      tokenMint: e.tokenMint,
      pool: e.pool,
      gmgn: e.gmgn || (e.tokenMint ? `https://gmgn.ai/sol/token/${e.tokenMint}` : null),
      buySpotSolPerToken: fmtNum(e.buySpotSolPerToken),
      sellSpotSolPerToken: fmtNum(e.sellSpotSolPerToken),
      pnlSol: e.pnlSol,
      pnlPct: e.pnlPct,
      skipReason: e.skipReason,
      endStatus: e.endStatus,
      classification: classifyOperation(e),
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
    'All operations:',
    ...report.operations.map((e, i) =>
      (() => {
        const rugReason = `${e.skipReason || ''} ${e.endStatus || ''}`.trim() || '-';
        return `${String(i + 1).padStart(4, '0')}. ${e.id} ${e.tokenMint || ''} ` +
          `start=${e.startedAt || '-'} buy_ts=${e.buyAt || '-'} sell_ts=${e.sellAt || '-'} end=${e.endedAt || '-'} ` +
          `buy_spot=${e.buySpotSolPerToken ?? 'n/a'} sell_spot=${e.sellSpotSolPerToken ?? 'n/a'} ` +
          `pnl=${e.pnlSol ?? 'n/a'} (${e.pnlPct ?? 'n/a'}%) ` +
          `class=${e.classification} ` +
          `status=${e.endStatus || 'n/a'} skip=${e.skipReason || '-'} ` +
          `rug=${e.rugPull ? 'YES' : 'NO'} rug_reason=${e.rugPull ? rugReason : '-'} ` +
          `gmgn=${e.gmgn || '-'}`;
      })()
    ),
    '',
    'Rug pull events:',
    ...(report.rugPullEvents.length
      ? report.rugPullEvents.map((e, i) =>
        `${String(i + 1).padStart(3, '0')}. ${e.id} ${e.tokenMint || ''} ` +
        `buy_ts=${e.buyAt || '-'} sell_ts=${e.sellAt || '-'} pnl_ts=${e.pnlAt || '-'} ` +
        `buy_spot=${e.buySpotSolPerToken ?? 'n/a'} sell_spot=${e.sellSpotSolPerToken ?? 'n/a'} ` +
        `pnl=${e.pnlSol ?? 'n/a'} (${e.pnlPct ?? 'n/a'}%) ` +
        `class=${e.classification} ` +
        `reason=${e.skipReason || e.endStatus || '-'} ` +
        `gmgn=${e.gmgn || '-'}`
      )
      : ['(none)']),
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
