#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SUPERVISOR_LOG_PATH = path.join(ROOT, 'paper.log');
const LOG_DIR = path.join(ROOT, 'logs');
const OUT_JSON = path.join(ROOT, 'logs', 'paper-report.json');
const OUT_TXT = path.join(ROOT, 'logs', 'paper-report.txt');
const OUT_OUTCOMES_JSON = path.join(ROOT, 'logs', 'paper-report-outcomes.json');
const OUT_OUTCOMES_TXT = path.join(ROOT, 'logs', 'paper-report-outcomes.txt');

const SUB_TO_DIGIT = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const DEFAULT_TRADE_AMOUNT_SOL = Number(process.env.TRADE_AMOUNT_SOL || '0.01');

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

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function summarizeEntryFilters(entryFilters, preBuyUltraGuard) {
  if (!entryFilters && !preBuyUltraGuard) return '-';
  const parts = [];
  if (entryFilters?.liquidity) {
    const liq = entryFilters.liquidity;
    parts.push(`liq ${liq.observedSol ?? 'n/a'}>=${liq.minSol ?? 'n/a'} (${liq.pass ? 'PASS' : 'FAIL'})`);
  }
  if (entryFilters?.tokenSecurity) {
    parts.push(`token ${entryFilters.tokenSecurity.pass ? 'PASS' : 'FAIL'}`);
  }
  if (entryFilters?.creatorRisk) {
    const c = entryFilters.creatorRisk;
    parts.push(
      `creator pass=${c.pass ? 'YES' : 'NO'} cp=${c.uniqueCounterparties ?? 'n/a'}/${c.maxUniqueCounterparties ?? 'n/a'} ` +
      `seed%=${c.seedPctOfLiq ?? 'n/a'}/${c.minSeedPctOfLiq ?? 'n/a'} fund=${c.freshFundingSol ?? 'n/a'}/${c.minFreshFundingSol ?? 'n/a'} ` +
      `age=${c.freshFundingAgeSec ?? 'n/a'}/${c.maxFreshFundingAgeSec ?? 'n/a'} reentry=${c.directAmmReentryEnabled ? 'on' : 'off'}:${c.directAmmReentrySigPresent ? 'seen' : 'none'}`
    );
  }
  if (entryFilters?.top10) {
    const t = entryFilters.top10;
    parts.push(`top10 ${t.pct ?? 'n/a'}<=${t.maxPct ?? 'n/a'} (${t.pass ? 'PASS' : 'FAIL'})`);
  }
  if (entryFilters?.cr_rapidDispersal) {
    const rd = entryFilters.cr_rapidDispersal;
    parts.push(`rapidDispersal t=${rd.observedTransfers ?? 0}/${rd.thresholdTransfers ?? 3} d=${rd.observedDestinations ?? 0}/${rd.thresholdDestinations ?? 3} sol=${rd.observedTotalSol ?? 0}/${rd.thresholdTotalSol ?? 100} (${rd.pass ? 'PASS' : 'BLOCK'})`);
  }
  if (entryFilters?.cr_lookupTable) {
    const lt = entryFilters.cr_lookupTable;
    parts.push(`lookupTable creates=${lt.observedCreates ?? 0}/${lt.thresholdCreates ?? 20} lookups=${lt.observedLookups ?? 0}/${lt.thresholdLookups ?? 2} (${lt.pass ? 'PASS' : 'BLOCK'})`);
  }
  if (entryFilters?.cr_setupBurst) {
    const sb = entryFilters.cr_setupBurst;
    parts.push(`setupBurst creates=${sb.observedCreates ?? 0}/${sb.thresholdCreates ?? 250} window=${sb.observedWindowSec ?? 'n/a'}s (${sb.pass ? 'PASS' : 'BLOCK'})`);
  }
  if (preBuyUltraGuard) {
    parts.push(
      `ultraGuard liqDropMax=${preBuyUltraGuard.maxObservedLiqDropPct ?? 'n/a'}<=${preBuyUltraGuard.maxLiqDropPct ?? 'n/a'} ` +
      `quoteDropMax=${preBuyUltraGuard.maxObservedQuoteDropPct ?? 'n/a'}<=${preBuyUltraGuard.maxQuoteDropPct ?? 'n/a'}`
    );
  }
  return parts.join(' | ');
}

const events = new Map();
const offsets = new Map();
const carries = new Map();
let lastWriteAt = 0;
let eventSeq = 0;
const currentEventIds = new Map();

function discoverLogPaths() {
  const workerLogs = fs.existsSync(LOG_DIR)
    ? fs.readdirSync(LOG_DIR)
      .filter(name => /^paper-worker-\d+\.log$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(name => path.join(LOG_DIR, name))
    : [];

  return workerLogs.length ? workerLogs : [SUPERVISOR_LOG_PATH];
}

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
      entryFilters: null,
      preBuyUltraGuard: null,
      holdLog: null,
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

function isRugLossEvent(e) {
  const status = `${e.skipReason || ''} ${e.endStatus || ''}`.toLowerCase();
  return (
    (typeof e.pnlPct === 'number' && e.pnlPct <= -80) ||
    (!!e.buyAt && status.includes('exit returned 0 sol'))
  );
}

function getEffectivePnl(e) {
  if (typeof e.pnlSol === 'number' && typeof e.pnlPct === 'number') {
    return { pnlSol: e.pnlSol, pnlPct: e.pnlPct, inferred: false };
  }

  const status = `${e.skipReason || ''} ${e.endStatus || ''}`.toLowerCase();
  if (!!e.buyAt && status.includes('exit returned 0 sol')) {
    return { pnlSol: -DEFAULT_TRADE_AMOUNT_SOL, pnlPct: -100, inferred: true };
  }

  return { pnlSol: null, pnlPct: null, inferred: false };
}

function getPnlValidityIssue(e) {
  const effective = getEffectivePnl(e);
  if (typeof effective.pnlSol !== 'number' || typeof effective.pnlPct !== 'number') return null;
  if (!Number.isFinite(effective.pnlSol) || !Number.isFinite(effective.pnlPct)) return 'non-finite pnl';

  if (
    typeof e.buySpotSolPerToken === 'number' &&
    typeof e.sellSpotSolPerToken === 'number' &&
    e.buySpotSolPerToken > 0 &&
    e.sellSpotSolPerToken > 0
  ) {
    const spotRatio = e.sellSpotSolPerToken / e.buySpotSolPerToken;
    if (!Number.isFinite(spotRatio)) return 'non-finite spot ratio';
    if (spotRatio > 10000) return `spot ratio too high (${spotRatio.toFixed(2)}x)`;
  }

  if (Math.abs(effective.pnlPct) > 10000) return `pnl pct too high (${effective.pnlPct.toFixed(2)}%)`;
  if (Math.abs(effective.pnlSol) > 10) return `pnl sol too high (${effective.pnlSol.toFixed(6)} SOL)`;
  return null;
}

function getCurrentEvent(logPath) {
  const currentEventId = currentEventIds.get(logPath) || null;
  if (currentEventId && events.has(currentEventId)) return events.get(currentEventId);
  return null;
}

function ensureCurrentEvent(logPath, ts) {
  let ev = getCurrentEvent(logPath);
  if (ev) return ev;
  const id = `evt-${String(++eventSeq).padStart(6, '0')}`;
  ev = getEvent(id);
  ev.startedAt = ev.startedAt || ts || null;
  currentEventIds.set(logPath, ev.id);
  return ev;
}

function parseLine(logPath, line) {
  const ts = (line.match(/^\[([^\]]+)\]/) || [])[1] || null;
  const stageLine = line.match(/^\[[^\]]+\]\s+(?:([^\s|]+)\s+\|\s+)?([^|]+?)\s+\|\s+(.+)$/);
  if (stageLine) {
    const maybeId = stageLine[1] ? stageLine[1].replace(/^\[|\]$/g, '') : null;
    const stage = stageLine[2].trim();
    const message = stageLine[3].trim();

    let ev = null;
    if (maybeId && maybeId.includes('...')) {
      ev = getEvent(maybeId);
      currentEventIds.set(logPath, maybeId);
    } else {
      ev = getCurrentEvent(logPath);
    }

    if (stage === 'NEW') {
      if (!ev) {
        const id = `evt-${String(++eventSeq).padStart(6, '0')}`;
        ev = getEvent(id);
      }
      currentEventIds.set(logPath, ev.id);
      ev.startedAt = ev.startedAt || ts;
      return;
    }

    if (stage === 'WORKER') {
      const startMatch = message.match(/^slot\s+\d+\s+start\s+([A-Za-z0-9.]+)$/);
      if (startMatch) {
        const id = `evt-${String(++eventSeq).padStart(6, '0')}`;
        ev = getEvent(id);
        ev.startedAt = ev.startedAt || ts;
        currentEventIds.set(logPath, ev.id);
      }
      return;
    }

    if (stage === 'START') {
      ev = ev || ensureCurrentEvent(logPath, ts);
      ev.startedAt = ev.startedAt || ts;
      return;
    }

    if (stage === 'SIGNATURE') {
      ev = ev || ensureCurrentEvent(logPath, ts);
      ev.signature = message;
      return;
    }

    if (stage === 'TOKEN') {
      ev = ev || ensureCurrentEvent(logPath, ts);
      ev.tokenMint = message;
      return;
    }

    if (stage === 'POOL') {
      ev = ev || ensureCurrentEvent(logPath, ts);
      ev.pool = message;
      return;
    }

    if (stage === 'GMGN') {
      ev = ev || ensureCurrentEvent(logPath, ts);
      ev.gmgn = message;
      return;
    }

    if (stage === 'BUY_SPOT') {
      ev = ev || getCurrentEvent(logPath);
      if (!ev) return;
      ev.buyAt = ts || ev.buyAt;
      ev.buySpotSolPerToken = parseCompactSol(message.replace(/^\~/, '').replace(/\/token$/i, '').trim());
      return;
    }

    if (stage === 'SELL_SPOT') {
      ev = ev || getCurrentEvent(logPath);
      if (!ev) return;
      ev.sellAt = ts || ev.sellAt;
      ev.sellSpotSolPerToken = parseCompactSol(message.replace(/^\~/, '').replace(/\/token$/i, '').trim());
      return;
    }

    if (stage === 'PNL') {
      ev = ev || getCurrentEvent(logPath);
      if (!ev) return;
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
      ev = ev || getCurrentEvent(logPath);
      if (!ev) return;
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
      ev = ev || getCurrentEvent(logPath);
      if (!ev) return;
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
      ev = ev || getCurrentEvent(logPath);
      if (!ev) return;
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

    if (stage === 'FILTERS') {
      ev = ev || getCurrentEvent(logPath);
      if (!ev) return;
      const parsed = safeJsonParse(message);
      if (parsed && typeof parsed === 'object') {
        ev.entryFilters = parsed;
      }
      return;
    }

    if (stage === 'PREGUARD') {
      ev = ev || getCurrentEvent(logPath);
      if (!ev) return;
      const liqDropMax = Number((message.match(/liq_drop_max=([-0-9.]+)%/) || [])[1]);
      const quoteDropMax = Number((message.match(/quote_drop_max=([-0-9.]+)%/) || [])[1]);
      const maxLiq = Number((message.match(/max_liq=([-0-9.]+)%/) || [])[1]);
      const maxQuote = Number((message.match(/max_quote=([-0-9.]+)%/) || [])[1]);
      const windowMs = Number((message.match(/window=([0-9]+)ms/) || [])[1]);
      const intervalMs = Number((message.match(/interval=([0-9]+)ms/) || [])[1]);
      ev.preBuyUltraGuard = {
        maxObservedLiqDropPct: Number.isFinite(liqDropMax) ? liqDropMax : null,
        maxObservedQuoteDropPct: Number.isFinite(quoteDropMax) ? quoteDropMax : null,
        maxLiqDropPct: Number.isFinite(maxLiq) ? maxLiq : null,
        maxQuoteDropPct: Number.isFinite(maxQuote) ? maxQuote : null,
        windowMs: Number.isFinite(windowMs) ? windowMs : null,
        intervalMs: Number.isFinite(intervalMs) ? intervalMs : null,
      };
      return;
    }

    if (stage === 'HOLDLOG') {
      ev = ev || getCurrentEvent(logPath);
      if (!ev) return;
      const parsed = safeJsonParse(message);
      if (parsed && typeof parsed === 'object') {
        ev.holdLog = parsed;
      }
      return;
    }

    if (stage === 'CHECKS' && message === 'passed') {
      ev = ev || getCurrentEvent(logPath);
      if (!ev) return;
      ev.checksPassed = true;
      return;
    }

    if (stage === 'END') {
      if (!ev) return;
      const m = message.match(/^(.*?)\s+\((\d+)ms(?:,\s*active=\d+)?\)$/);
      ev.endStatus = m ? m[1].trim() : message;
      ev.durationMs = m ? Number(m[2]) : ev.durationMs;
      ev.endedAt = ts || nowIso();
      currentEventIds.delete(logPath);
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
    const latest = getCurrentEvent(logPath) || [...events.values()].reverse().find(e => !e.signature);
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
    const ev = m[1] || m[2] ? getEvent(m[1] || m[2]) : getCurrentEvent(logPath);
    if (ev) ev.skipReason = m[3].trim();
    return;
  }

  m = line.match(/✅ (?:\[([^\]]+)\]|([^\s]+))? ?Checks passed/);
  if (m) {
    const ev = m[1] || m[2] ? getEvent(m[1] || m[2]) : getCurrentEvent(logPath);
    if (ev) ev.checksPassed = true;
    return;
  }

  m = line.match(/🏁 (?:\[([^\]]+)\]|([^\s]+))? ?END \((\d+)ms\)\s*(.+)$/);
  if (m) {
    const ev = m[1] || m[2] ? getEvent(m[1] || m[2]) : getCurrentEvent(logPath);
    if (ev) {
      ev.durationMs = Number(m[3]);
      ev.endStatus = m[4].trim();
      ev.endedAt = ts || nowIso();
      currentEventIds.delete(logPath);
    }
  }
}

function summarize() {
  const finished = [...events.values()].filter(e => e.endedAt);
  const enriched = finished.map(e => {
    const effective = getEffectivePnl(e);
    return { ...e, effectivePnlSol: effective.pnlSol, effectivePnlPct: effective.pnlPct, inferredPnl: effective.inferred };
  });
  const pnlKnown = enriched.filter(e => typeof e.effectivePnlSol === 'number');
  const validPnl = pnlKnown.filter(e => !getPnlValidityIssue(e));
  const totalPnl = validPnl.reduce((a, e) => a + e.effectivePnlSol, 0);
  const avgPnlPct = validPnl.length ? validPnl.reduce((a, e) => a + (e.effectivePnlPct || 0), 0) / validPnl.length : 0;
  const wins = validPnl.filter(e => e.effectivePnlSol > 0).length;
  const losses = validPnl.filter(e => e.effectivePnlSol < 0).length;
  const checksPassed = finished.filter(e => e.checksPassed).length;
  const skipped = finished.filter(e => e.skipReason || (e.endStatus && e.endStatus.startsWith('SKIP'))).length;
  const isRugLikeSignal = (e) => {
    const s = `${e.skipReason || ''} ${e.endStatus || ''}`.toLowerCase();
    return isRugLossEvent(e) ||
      s.includes('paper simulation guard') ||
      s.includes('exit returned 0 sol') ||
      s.includes('liquidity stop');
  };
  const rugLosses = enriched.filter(e => isRugLossEvent(e));
  const rugLikeAvoided = enriched.filter(e => isRugLikeSignal(e) && !isRugLossEvent(e));
  const hostileSkips = enriched.filter(e =>
    classifyOperation(e) === 'hostile' &&
    (e.skipReason || (e.endStatus && e.endStatus.startsWith('SKIP')))
  );
  const outcomeOperations = enriched
    .filter(e => typeof e.effectivePnlSol === 'number' && typeof e.effectivePnlPct === 'number')
    .map(e => ({
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
      pnlSol: e.effectivePnlSol,
      pnlPct: e.effectivePnlPct,
      inferredPnl: !!e.inferredPnl,
      checksPassed: e.checksPassed,
      skipReason: e.skipReason,
      endStatus: e.endStatus,
      durationMs: e.durationMs,
      rugPull: isRugLikeSignal(e),
      rugLoss: isRugLossEvent(e),
      classification: classifyOperation(e),
      pnlValidityIssue: getPnlValidityIssue(e),
      entryFilters: e.entryFilters,
      preBuyUltraGuard: e.preBuyUltraGuard,
      holdLog: e.holdLog,
    }));

  return {
    generatedAt: nowIso(),
    eventsSeen: events.size,
    finishedEvents: finished.length,
    checksPassed,
    skipped,
    hostileSkipCount: hostileSkips.length,
    avoidedRugLikeCount: rugLikeAvoided.length,
    rugLossCount: rugLosses.length,
    rugPullCount: rugLosses.length,
    invalidPnlCount: pnlKnown.length - validPnl.length,
    totalPnlSol: Number(totalPnl.toFixed(9)),
    avgPnlPct: Number(avgPnlPct.toFixed(4)),
    wins,
    losses,
    winRatePct: validPnl.length ? Number(((wins / validPnl.length) * 100).toFixed(2)) : 0,
    outcomeOperationCount: outcomeOperations.length,
    operations: enriched.map(e => ({
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
      pnlSol: e.effectivePnlSol,
      pnlPct: e.effectivePnlPct,
      checksPassed: e.checksPassed,
      skipReason: e.skipReason,
      endStatus: e.endStatus,
      durationMs: e.durationMs,
      rugPull: isRugLikeSignal(e),
      rugLoss: isRugLossEvent(e),
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
      pnlValidityIssue: getPnlValidityIssue(e),
      entryFilters: e.entryFilters,
      preBuyUltraGuard: e.preBuyUltraGuard,
      holdLog: e.holdLog,
    })),
    outcomeOperations,
    rugPullEvents: rugLosses.slice(-20).map(e => ({
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
      pnlSol: e.effectivePnlSol,
      pnlPct: e.effectivePnlPct,
      skipReason: e.skipReason,
      endStatus: e.endStatus,
      classification: classifyOperation(e),
      entryFilters: e.entryFilters,
      preBuyUltraGuard: e.preBuyUltraGuard,
      holdLog: e.holdLog,
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
    `hostile skips: ${report.hostileSkipCount}`,
    `rug-like avoided: ${report.avoidedRugLikeCount}`,
    `rug losses (-100%): ${report.rugLossCount}`,
    `invalid pnl excluded: ${report.invalidPnlCount}`,
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
          `pnl_valid=${e.pnlValidityIssue ? 'NO' : 'YES'} ` +
          `class=${e.classification} ` +
          `status=${e.endStatus || 'n/a'} skip=${e.skipReason || '-'} ` +
          `rug_like=${e.rugPull ? 'YES' : 'NO'} rug_loss=${e.rugLoss ? 'YES' : 'NO'} rug_reason=${e.rugPull ? rugReason : '-'} ` +
          `gmgn=${e.gmgn || '-'} ` +
          `pnl_issue=${e.pnlValidityIssue || '-'}`;
      })()
    ),
    '',
    'Rug loss events (-100%):',
    ...(report.rugPullEvents.length
      ? report.rugPullEvents.map((e, i) =>
        `${String(i + 1).padStart(3, '0')}. ${e.id} ${e.tokenMint || ''} ` +
        `buy_ts=${e.buyAt || '-'} sell_ts=${e.sellAt || '-'} pnl_ts=${e.pnlAt || '-'} ` +
        `buy_spot=${e.buySpotSolPerToken ?? 'n/a'} sell_spot=${e.sellSpotSolPerToken ?? 'n/a'} ` +
        `pnl=${e.pnlSol ?? 'n/a'} (${e.pnlPct ?? 'n/a'}%) ` +
        `class=${e.classification} ` +
        `reason=${e.skipReason || e.endStatus || '-'} ` +
        `gmgn=${e.gmgn || '-'} ` +
        `filters=${summarizeEntryFilters(e.entryFilters, e.preBuyUltraGuard)}`
      )
      : ['(none)']),
  ].join('\n');
  fs.writeFileSync(OUT_TXT, txt + '\n');

  const outcomesOnly = {
    generatedAt: report.generatedAt,
    outcomeOperationCount: report.outcomeOperationCount,
    invalidPnlCount: report.invalidPnlCount,
    totalPnlSol: report.totalPnlSol,
    avgPnlPct: report.avgPnlPct,
    wins: report.wins,
    losses: report.losses,
    winRatePct: report.winRatePct,
    outcomeOperations: report.outcomeOperations,
  };
  fs.writeFileSync(OUT_OUTCOMES_JSON, JSON.stringify(outcomesOnly, null, 2));

  const outcomesTxt = [
    `Paper Trade Outcomes @ ${report.generatedAt}`,
    `operations with pnl: ${report.outcomeOperationCount}`,
    `invalid pnl excluded: ${report.invalidPnlCount}`,
    `total pnl (SOL): ${report.totalPnlSol}`,
    `avg pnl (%): ${report.avgPnlPct}`,
    `wins/losses: ${report.wins}/${report.losses}`,
    `win rate: ${report.winRatePct}%`,
    '',
    'Operations with pnl:',
    ...(report.outcomeOperations.length
      ? report.outcomeOperations.map((e, i) =>
        `${String(i + 1).padStart(4, '0')}. ${e.id} ${e.tokenMint || ''} ` +
        `start=${e.startedAt || '-'} buy_ts=${e.buyAt || '-'} sell_ts=${e.sellAt || '-'} end=${e.endedAt || '-'} ` +
        `buy_spot=${e.buySpotSolPerToken ?? 'n/a'} sell_spot=${e.sellSpotSolPerToken ?? 'n/a'} ` +
        `pnl=${e.pnlSol ?? 'n/a'} (${e.pnlPct ?? 'n/a'}%) ` +
        `pnl_valid=${e.pnlValidityIssue ? 'NO' : 'YES'} ` +
        `class=${e.classification} status=${e.endStatus || 'n/a'} skip=${e.skipReason || '-'} ` +
        `rug_like=${e.rugPull ? 'YES' : 'NO'} rug_loss=${e.rugLoss ? 'YES' : 'NO'} ` +
        `gmgn=${e.gmgn || '-'} pnl_issue=${e.pnlValidityIssue || '-'}`
      )
      : ['(none)']),
  ].join('\n');
  fs.writeFileSync(OUT_OUTCOMES_TXT, outcomesTxt + '\n');
}

function processChunk(logPath, chunk) {
  const carry = carries.get(logPath) || '';
  const combined = carry + chunk;
  const lines = combined.split(/\r?\n/);
  carries.set(logPath, lines.pop() || '');
  for (const line of lines) {
    if (!line.trim()) continue;
    parseLine(logPath, line);
  }
  writeReports();
}

function initialLoad() {
  for (const logPath of discoverLogPaths()) {
    if (!fs.existsSync(logPath)) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, '');
    }
    const content = fs.readFileSync(logPath, 'utf8');
    offsets.set(logPath, Buffer.byteLength(content));
    processChunk(logPath, content);
  }
  writeReports(true);
}

function pollLoop() {
  setInterval(() => {
    for (const logPath of discoverLogPaths()) {
      try {
        if (!offsets.has(logPath)) {
          offsets.set(logPath, 0);
          carries.set(logPath, '');
        }
        const stat = fs.statSync(logPath);
        const offset = offsets.get(logPath) || 0;
        if (stat.size < offset) {
          offsets.set(logPath, 0);
          carries.set(logPath, '');
        }
        if (stat.size === (offsets.get(logPath) || 0)) continue;

        const currentOffset = offsets.get(logPath) || 0;
        const stream = fs.createReadStream(logPath, { start: currentOffset, end: stat.size - 1, encoding: 'utf8' });
        let chunk = '';
        stream.on('data', (d) => { chunk += d; });
        stream.on('end', () => {
          offsets.set(logPath, stat.size);
          if (chunk) processChunk(logPath, chunk);
        });
      } catch (e) {
        // keep daemon alive; write heartbeat report
        writeReports(true);
      }
    }
  }, 1000);
}

initialLoad();
pollLoop();
console.log(`[paper-report-daemon] watching supervisor/workers logs under ${ROOT}`);
console.log(`[paper-report-daemon] writing ${OUT_JSON}, ${OUT_TXT}, ${OUT_OUTCOMES_JSON}, ${OUT_OUTCOMES_TXT}`);
