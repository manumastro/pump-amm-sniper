#!/usr/bin/env node
// @ts-nocheck
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Connection, PublicKey } = require("@solana/web3.js");

dotenv.config();

const ROOT = process.cwd();
const REPORT_JSON = path.join(ROOT, "logs", "paper-report.json");
const OUT_JSON = path.join(ROOT, "logs", "rug-loss-forensics.json");
const OUT_TXT = path.join(ROOT, "logs", "rug-loss-forensics.txt");
const LOG_DIR = path.join(ROOT, "logs");

const WSOL = "So11111111111111111111111111111111111111112";
const PUMPFUN_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const CREATOR_WINDOW_BEFORE_SEC = 180;
const CREATOR_WINDOW_AFTER_SEC = 900;
const CASHOUT_SOL_THRESHOLD = 10;
const CREATOR_SIG_LIMIT = Number(process.env.RUG_FORENSICS_CREATOR_SIG_LIMIT || "24");
const CREATOR_TX_PARSE_LIMIT = Number(process.env.RUG_FORENSICS_CREATOR_TX_PARSE_LIMIT || "14");
const RPC_MAX_RETRIES = Number(process.env.RUG_FORENSICS_RPC_MAX_RETRIES || "8");
const RPC_BASE_DELAY_MS = Number(process.env.RUG_FORENSICS_RPC_BASE_DELAY_MS || "300");
const RPC_MAX_DELAY_MS = Number(process.env.RUG_FORENSICS_RPC_MAX_DELAY_MS || "5000");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit");
}

async function rpcCall(fn, label = "rpc") {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= RPC_MAX_RETRIES) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      attempt += 1;
      if (attempt > RPC_MAX_RETRIES) break;
      const factor = Math.min(10, 2 ** (attempt - 1));
      const wait = Math.min(RPC_MAX_DELAY_MS, Math.round(RPC_BASE_DELAY_MS * factor));
      if (!isRateLimitError(err) && attempt > 3) break;
      console.log(`[rug-loss-forensics] retry ${label} attempt=${attempt} wait=${wait}ms err=${String(err?.message || err)}`);
      await sleep(wait);
    }
  }
  throw lastErr || new Error(`${label} failed`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function discoverWorkerLogs() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^paper-worker-\d+\.log$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(LOG_DIR, name));
}

function parseWorkerLogs(logPaths) {
  const bySig = new Map();
  for (const logPath of logPaths) {
    const content = fs.readFileSync(logPath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    let currentSig = null;
    for (const raw of lines) {
      const sigMatch = raw.match(/SIGNATURE\s+\|\s+([A-Za-z0-9]+)/);
      if (sigMatch) {
        currentSig = sigMatch[1];
        if (!bySig.has(currentSig)) bySig.set(currentSig, { logPath, lines: [] });
      }
      if (!currentSig) continue;
      const rec = bySig.get(currentSig);
      if (!rec) continue;
      const stageMatch = raw.match(/^\[[^\]]+\]\s+([^|]+)\|\s+(.+)$/);
      if (stageMatch) {
        rec.lines.push({
          raw,
          stage: stageMatch[1].trim(),
          message: stageMatch[2].trim(),
        });
      } else {
        rec.lines.push({ raw, stage: "", message: "" });
      }
      if (/WORKER\s+\|\s+slot\s+\d+\s+done\s+/.test(raw)) {
        currentSig = null;
      }
    }
  }
  return bySig;
}

function idxOfStage(lines, stage) {
  return lines.findIndex((l) => l.stage === stage);
}

function stageLines(lines, stage) {
  return lines.filter((l) => l.stage === stage).map((l) => l.message);
}

function hasRaw(lines, needle) {
  return lines.some((l) => l.raw.includes(needle));
}

function parseCreatorFromLogs(lines) {
  for (const l of lines) {
    const m1 = l.message.match(/^resolved\s+([A-Za-z0-9]+)/);
    if (l.stage === "CREATOR" && m1) return m1[1];
    if (l.stage === "CREATOR" && /^[A-Za-z0-9]{32,44}$/.test(l.message)) return l.message;
  }
  return null;
}

function parseRrelay(lines) {
  const relay = [];
  for (const l of lines) {
    if (l.stage !== "RRELAY") continue;
    const root = (l.message.match(/root=([^\s]+)/) || [])[1] || null;
    const funder = (l.message.match(/funder=([^\s]+)/) || [])[1] || null;
    const inbound = Number((l.message.match(/in=([0-9.]+)/) || [])[1] || "0");
    const outbound = Number((l.message.match(/out=([0-9.]+)/) || [])[1] || "0");
    const windowSec = Number((l.message.match(/window=([0-9.]+)/) || [])[1] || "0");
    relay.push({ root, funder, inbound, outbound, windowSec });
  }
  return relay;
}

function parseCcash(lines) {
  const cash = [];
  for (const l of lines) {
    if (l.stage !== "CCASH") continue;
    cash.push({
      total: Number((l.message.match(/total=([0-9.]+)/) || [])[1] || "0"),
      max: Number((l.message.match(/max=([0-9.]+)/) || [])[1] || "0"),
      relPct: Number((l.message.match(/rel=([0-9.]+)/) || [])[1] || "0"),
      score: Number((l.message.match(/score=([0-9.]+)/) || [])[1] || "0"),
      dest: (l.message.match(/dest=([^\s]+)/) || [])[1] || null,
    });
  }
  return cash;
}

function analyzeControls(event, rec) {
  const lines = rec ? rec.lines : [];
  const buyIdx = idxOfStage(lines, "BUY_SPOT");
  const pre = buyIdx >= 0 ? lines.slice(0, buyIdx + 1) : lines;
  const post = buyIdx >= 0 ? lines.slice(buyIdx + 1) : [];

  const top10 = stageLines(pre, "TOP10");
  const wait = stageLines(pre, "WAIT");

  return {
    preEntry: {
      liquiditySeen: stageLines(pre, "LIQ").length > 0,
      mintFreezePassed: hasRaw(pre, "Mint/Freeze Security: PASSED"),
      creatorRiskChecks: stageLines(pre, "CRISK").length,
      relaySignals: parseRrelay(pre),
      cashoutSignals: parseCcash(pre),
      top10Checks: top10,
      top10FailOpen: top10.some((m) => m.includes("fail-open")),
      waitChecks: wait,
    },
    hold: {
      creatorRiskRechecks: stageLines(post, "CRISK").length,
      creatorRiskExit: hasRaw(post, "CREATOR RISK EXIT"),
      stabilityGateExit: hasRaw(post, "STABILITY GATE:"),
      liquidityStopExit: hasRaw(post, "LIQUIDITY STOP:"),
      paperGuardZeroExit: `${event.skipReason || ""} ${event.endStatus || ""}`.toLowerCase().includes("exit returned 0 sol"),
    },
    loggingConsistency: {
      hasSellSpot: stageLines(lines, "SELL_SPOT").length > 0,
      hasPnlLine: stageLines(lines, "PNL").length > 0,
      rugLossButNullPnl: event.rugLoss === true && (event.pnlSol === null || event.pnlPct === null),
    },
    creator: parseCreatorFromLogs(lines),
  };
}

async function onChainProbe(connection, event) {
  const out = {
    createTxFound: false,
    createBlockTime: null,
    createSlot: null,
    poolAccountAlive: null,
    poolAccountLamports: null,
    firstPoolSigAfterApproxEnd: null,
    secondsGapAfterApproxEnd: null,
    poolSigsIn10mAfterApproxEnd: null,
  };

  try {
    const tx = await rpcCall(() => connection.getParsedTransaction(event.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    }), "getParsedTransaction:create");
    if (tx) {
      out.createTxFound = true;
      out.createBlockTime = tx.blockTime || null;
      out.createSlot = tx.slot || null;
    }
  } catch {
    // no-op
  }

  try {
    const account = await rpcCall(() => connection.getAccountInfo(new PublicKey(event.pool), "confirmed"), "getAccountInfo:pool");
    out.poolAccountAlive = !!account;
    out.poolAccountLamports = account ? account.lamports : 0;
  } catch {
    out.poolAccountAlive = null;
  }

  if (!out.createBlockTime) return out;

  const approxEndBlockTime = out.createBlockTime + Math.round((Number(event.durationMs || 0)) / 1000);

  try {
    const sigs = await rpcCall(
      () => connection.getSignaturesForAddress(new PublicKey(event.pool), { limit: 300 }, "confirmed"),
      "getSignaturesForAddress:pool"
    );
    const succeeded = sigs.filter((s) => !s.err && typeof s.blockTime === "number");
    const after = succeeded
      .filter((s) => s.blockTime >= approxEndBlockTime)
      .sort((a, b) => a.blockTime - b.blockTime);
    if (after.length > 0) {
      out.firstPoolSigAfterApproxEnd = {
        signature: after[0].signature,
        blockTime: after[0].blockTime,
      };
      out.secondsGapAfterApproxEnd = after[0].blockTime - approxEndBlockTime;
      out.poolSigsIn10mAfterApproxEnd = after.filter((s) => s.blockTime <= approxEndBlockTime + 600).length;
    } else {
      out.firstPoolSigAfterApproxEnd = null;
      out.secondsGapAfterApproxEnd = null;
      out.poolSigsIn10mAfterApproxEnd = 0;
    }
  } catch {
    // no-op
  }

  return out;
}

function txAccountKeys(tx) {
  return (tx?.transaction?.message?.accountKeys || []).map((k) => {
    if (typeof k?.pubkey?.toBase58 === "function") return k.pubkey.toBase58();
    if (typeof k?.toBase58 === "function") return k.toBase58();
    if (typeof k === "string") return k;
    return null;
  }).filter(Boolean);
}

function flattenParsedInstructions(tx) {
  const all = [];
  const outer = tx?.transaction?.message?.instructions || [];
  for (const ix of outer) all.push(ix);
  const innerGroups = tx?.meta?.innerInstructions || [];
  for (const g of innerGroups) {
    for (const ix of (g.instructions || [])) all.push(ix);
  }
  return all;
}

function transferLamports(ix) {
  const parsed = ix?.parsed;
  if (!parsed || parsed.type !== "transfer") return null;
  const info = parsed.info || {};
  const from = info.source || info.from || null;
  const to = info.destination || info.to || null;
  const lamports = Number(info.lamports || 0);
  if (!from || !to || !Number.isFinite(lamports) || lamports <= 0) return null;
  return { from, to, sol: lamports / 1e9 };
}

function getCreatorSystemTransfers(tx, creator) {
  const transfers = [];
  for (const ix of flattenParsedInstructions(tx)) {
    const t = transferLamports(ix);
    if (!t) continue;
    if (t.from === creator || t.to === creator) transfers.push(t);
  }
  const inbound = transfers.filter((t) => t.to === creator);
  const outbound = transfers.filter((t) => t.from === creator);
  return {
    inbound,
    outbound,
    inboundSol: inbound.reduce((a, t) => a + t.sol, 0),
    outboundSol: outbound.reduce((a, t) => a + t.sol, 0),
    maxOutboundSol: outbound.reduce((m, t) => Math.max(m, t.sol), 0),
  };
}

function getCreatorSolDelta(tx, creator) {
  const keys = txAccountKeys(tx);
  const idx = keys.findIndex((k) => k === creator);
  if (idx < 0) return null;
  const pre = tx?.meta?.preBalances?.[idx];
  const post = tx?.meta?.postBalances?.[idx];
  if (!Number.isFinite(pre) || !Number.isFinite(post)) return null;
  return (post - pre) / 1e9;
}

function getTokenDeltaByOwnerMint(tx, owner, mint) {
  const pre = tx?.meta?.preTokenBalances || [];
  const post = tx?.meta?.postTokenBalances || [];
  let preAmt = 0;
  let postAmt = 0;
  for (const b of pre) {
    if (b.owner === owner && b.mint === mint) {
      const raw = Number(b.uiTokenAmount?.amount || 0);
      const dec = Number(b.uiTokenAmount?.decimals || 0);
      preAmt += raw / (10 ** dec);
    }
  }
  for (const b of post) {
    if (b.owner === owner && b.mint === mint) {
      const raw = Number(b.uiTokenAmount?.amount || 0);
      const dec = Number(b.uiTokenAmount?.decimals || 0);
      postAmt += raw / (10 ** dec);
    }
  }
  return postAmt - preAmt;
}

function touchesProgram(tx, programId) {
  const outer = tx?.transaction?.message?.instructions || [];
  const keys = txAccountKeys(tx);
  for (const ix of outer) {
    if (ix?.programId?.toBase58?.() === programId) return true;
    if (typeof ix?.programIdIndex === "number" && keys[ix.programIdIndex] === programId) return true;
  }
  const inner = tx?.meta?.innerInstructions || [];
  for (const g of inner) {
    for (const ix of (g.instructions || [])) {
      if (ix?.programId?.toBase58?.() === programId) return true;
    }
  }
  return false;
}

function classifyCreatorLifecycleStep(row, event) {
  if (row.signature === event.signature) return "create_pool";
  if (
    row.touchesPool &&
    (
      row.wsolDeltaToCreator > 0.01 ||
      (typeof row.creatorSolDelta === "number" && row.creatorSolDelta >= CASHOUT_SOL_THRESHOLD / 2)
    )
  ) {
    return "pool_withdraw_like";
  }
  if (row.systemOutSol >= CASHOUT_SOL_THRESHOLD) return "cashout_transfer";
  if (row.touchesPumpProgram) return "pump_amm_activity";
  if (row.systemInSol >= CASHOUT_SOL_THRESHOLD) return "funding";
  return "other";
}

async function analyzeCreatorTimeline(connection, event, creator, createBlockTime) {
  if (!creator || !createBlockTime) {
    return {
      creator,
      windowSec: { before: CREATOR_WINDOW_BEFORE_SEC, after: CREATOR_WINDOW_AFTER_SEC },
      rows: [],
      keyEvents: {
        firstFunding: null,
        createPool: null,
        firstWithdrawLike: null,
        firstCashout: null,
      },
      pattern: {
        rapidWithdrawAfterCreate: false,
        rapidCashoutAfterWithdraw: false,
        suspiciousLifecycle: false,
      },
    };
  }

  const sigs = await rpcCall(
    () => connection.getSignaturesForAddress(
      new PublicKey(creator),
      { limit: Math.max(20, CREATOR_SIG_LIMIT) },
      "confirmed"
    ),
    "getSignaturesForAddress:creator"
  ).catch(() => []);
  const minBt = createBlockTime - CREATOR_WINDOW_BEFORE_SEC;
  const maxBt = createBlockTime + CREATOR_WINDOW_AFTER_SEC;
  const relevant = sigs
    .filter((s) => typeof s.blockTime === "number" && s.blockTime >= minBt && s.blockTime <= maxBt)
    .sort((a, b) => a.blockTime - b.blockTime);
  const prioritized = [...relevant].sort((a, b) => {
    const da = Math.abs(a.blockTime - createBlockTime);
    const db = Math.abs(b.blockTime - createBlockTime);
    return da - db;
  });
  const limited = prioritized.slice(0, Math.max(6, CREATOR_TX_PARSE_LIMIT));
  const limitedSet = new Set(limited.map((s) => s.signature));
  const toParse = relevant.filter((s) => limitedSet.has(s.signature));

  const rows = [];
  for (const s of toParse) {
    const tx = await rpcCall(
      () => connection.getParsedTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      }),
      "getParsedTransaction:creator-timeline"
    ).catch(() => null);
    if (!tx) continue;
    const transfers = getCreatorSystemTransfers(tx, creator);
    const row = {
      signature: s.signature,
      slot: tx.slot || null,
      blockTime: s.blockTime,
      secondsFromCreate: s.blockTime - createBlockTime,
      creatorSolDelta: getCreatorSolDelta(tx, creator),
      systemInSol: transfers.inboundSol,
      systemOutSol: transfers.outboundSol,
      maxSystemOutSol: transfers.maxOutboundSol,
      topOutboundTo: transfers.outbound
        .sort((a, b) => b.sol - a.sol)
        .slice(0, 3)
        .map((t) => ({ to: t.to, sol: t.sol })),
      topInboundFrom: transfers.inbound
        .sort((a, b) => b.sol - a.sol)
        .slice(0, 3)
        .map((t) => ({ from: t.from, sol: t.sol })),
      wsolDeltaToCreator: getTokenDeltaByOwnerMint(tx, creator, WSOL),
      tokenDeltaToCreator: event.tokenMint ? getTokenDeltaByOwnerMint(tx, creator, event.tokenMint) : 0,
      touchesPool: txAccountKeys(tx).includes(event.pool),
      touchesPumpProgram: touchesProgram(tx, PUMPFUN_AMM_PROGRAM_ID),
    };
    row.lifecycleStep = classifyCreatorLifecycleStep(row, event);
    rows.push(row);
  }

  const firstFunding = rows.find((r) => r.lifecycleStep === "funding") || null;
  const createPool = rows.find((r) => r.lifecycleStep === "create_pool") || null;
  const firstWithdrawLike = rows.find((r) => r.secondsFromCreate >= 0 && r.lifecycleStep === "pool_withdraw_like") || null;
  const firstCashout = rows.find((r) => r.secondsFromCreate >= 0 && r.lifecycleStep === "cashout_transfer") || null;

  const rapidWithdrawAfterCreate = !!(firstWithdrawLike && firstWithdrawLike.secondsFromCreate <= 60);
  const rapidCashoutAfterWithdraw = !!(
    firstWithdrawLike &&
    firstCashout &&
    firstCashout.blockTime >= firstWithdrawLike.blockTime &&
    (firstCashout.blockTime - firstWithdrawLike.blockTime) <= 120
  );

  return {
    creator,
    windowSec: { before: CREATOR_WINDOW_BEFORE_SEC, after: CREATOR_WINDOW_AFTER_SEC },
    rows,
    keyEvents: {
      firstFunding,
      createPool,
      firstWithdrawLike,
      firstCashout,
    },
    pattern: {
      rapidWithdrawAfterCreate,
      rapidCashoutAfterWithdraw,
      suspiciousLifecycle: rapidWithdrawAfterCreate && rapidCashoutAfterWithdraw,
    },
  };
}

function summarizeFindings(items) {
  const summary = {
    rugLossCount: items.length,
    nullPnlRugLoss: items.filter((i) => i.controls.loggingConsistency.rugLossButNullPnl).length,
    noSellSpot: items.filter((i) => !i.controls.loggingConsistency.hasSellSpot).length,
    top10FailOpenRugLoss: items.filter((i) => i.controls.preEntry.top10FailOpen).length,
    creatorRiskExitTriggered: items.filter((i) => i.controls.hold.creatorRiskExit).length,
    stabilityGateTriggered: items.filter((i) => i.controls.hold.stabilityGateExit).length,
    liquidityStopTriggered: items.filter((i) => i.controls.hold.liquidityStopExit).length,
    exitReturnedZeroSol: items.filter((i) => i.controls.hold.paperGuardZeroExit).length,
    poolDeadAtProbe: items.filter((i) => i.onChain.poolAccountAlive === false).length,
    hadPoolActivityWithin10mAfterEnd: items.filter((i) => (i.onChain.poolSigsIn10mAfterApproxEnd || 0) > 0).length,
    suspiciousCreatorLifecycle: items.filter((i) => i.creatorTimeline?.pattern?.suspiciousLifecycle).length,
    rapidWithdrawAfterCreate: items.filter((i) => i.creatorTimeline?.pattern?.rapidWithdrawAfterCreate).length,
    rapidCashoutAfterWithdraw: items.filter((i) => i.creatorTimeline?.pattern?.rapidCashoutAfterWithdraw).length,
  };

  const reasonCounts = new Map();
  for (const i of items) {
    const reason = i.event.skipReason || i.event.endStatus || "unknown";
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }
  summary.reasonBuckets = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
  return summary;
}

function renderTxt(report) {
  const lines = [];
  lines.push(`Rug Loss Forensics @ ${new Date().toISOString()}`);
  lines.push(`rug losses analysed: ${report.summary.rugLossCount}`);
  lines.push(`rug losses with null pnl: ${report.summary.nullPnlRugLoss}`);
  lines.push(`exit returned 0 SOL: ${report.summary.exitReturnedZeroSol}`);
  lines.push(`top10 fail-open among rug losses: ${report.summary.top10FailOpenRugLoss}`);
  lines.push(`creator risk exit triggered: ${report.summary.creatorRiskExitTriggered}`);
  lines.push(`stability gate triggered: ${report.summary.stabilityGateTriggered}`);
  lines.push(`liquidity stop triggered: ${report.summary.liquidityStopTriggered}`);
  lines.push(`pool dead at probe: ${report.summary.poolDeadAtProbe}`);
  lines.push(`pool active within 10m after approx end: ${report.summary.hadPoolActivityWithin10mAfterEnd}`);
  lines.push(`rapid withdraw after create: ${report.summary.rapidWithdrawAfterCreate}`);
  lines.push(`rapid cashout after withdraw: ${report.summary.rapidCashoutAfterWithdraw}`);
  lines.push(`suspicious creator lifecycle: ${report.summary.suspiciousCreatorLifecycle}`);
  lines.push("");
  lines.push("Top reason buckets:");
  for (const b of report.summary.reasonBuckets.slice(0, 10)) {
    lines.push(`- ${b.count}x ${b.reason}`);
  }
  lines.push("");
  lines.push("High priority cases:");
  for (const item of report.events
    .filter((e) =>
      e.controls.loggingConsistency.rugLossButNullPnl ||
      e.controls.preEntry.top10FailOpen ||
      e.creatorTimeline?.pattern?.suspiciousLifecycle
    )
    .slice(0, 25)) {
    const wd = item.creatorTimeline?.keyEvents?.firstWithdrawLike?.secondsFromCreate;
    const co = item.creatorTimeline?.keyEvents?.firstCashout?.secondsFromCreate;
    lines.push(
      `- ${item.event.id} ${item.event.tokenMint} ` +
      `reason=${item.event.skipReason || item.event.endStatus} ` +
      `pnl=${item.event.pnlSol}/${item.event.pnlPct} ` +
      `top10FailOpen=${item.controls.preEntry.top10FailOpen ? "YES" : "NO"} ` +
      `withdraw_t=${wd ?? "n/a"}s ` +
      `cashout_t=${co ?? "n/a"}s ` +
      `suspLifecycle=${item.creatorTimeline?.pattern?.suspiciousLifecycle ? "YES" : "NO"} ` +
      `poolAlive=${item.onChain.poolAccountAlive}`
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  if (!fs.existsSync(REPORT_JSON)) {
    throw new Error(`missing report: ${REPORT_JSON}`);
  }

  const report = readJson(REPORT_JSON);
  const args = process.argv.slice(2);
  const onlySigArg = args.find((a) => a.startsWith("--only-signature="));
  const onlySignature = onlySigArg ? onlySigArg.split("=")[1] : null;
  const limitArg = args.find((a) => a.startsWith("--limit-events="));
  const limitEvents = limitArg ? Number(limitArg.split("=")[1]) : null;

  let rugLossEvents = (report.operations || []).filter((op) => op.rugLoss === true);
  if (onlySignature) {
    rugLossEvents = rugLossEvents.filter((op) => op.signature === onlySignature);
  }
  if (Number.isFinite(limitEvents) && limitEvents > 0) {
    rugLossEvents = rugLossEvents.slice(0, limitEvents);
  }
  const workerLogs = discoverWorkerLogs();
  const bySig = parseWorkerLogs(workerLogs);
  const rpcEndpoint = process.env.SVS_UNSTAKED_RPC || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcEndpoint, { commitment: "confirmed" });

  const analyzed = [];
  for (let i = 0; i < rugLossEvents.length; i++) {
    const event = rugLossEvents[i];
    console.log(`[rug-loss-forensics] ${i + 1}/${rugLossEvents.length} ${event.id} ${event.tokenMint}`);
    try {
      const rec = bySig.get(event.signature) || null;
      const controls = analyzeControls(event, rec);
      const onChain = await onChainProbe(connection, event);
      const creatorTimeline = await analyzeCreatorTimeline(
        connection,
        event,
        controls.creator,
        onChain.createBlockTime
      );
      analyzed.push({
        event,
        controls,
        onChain,
        creatorTimeline,
        sourceLog: rec ? path.basename(rec.logPath) : null,
      });
    } catch (e) {
      analyzed.push({
        event,
        controls: {
          preEntry: {},
          hold: {},
          loggingConsistency: {},
          creator: null,
          analysisError: String(e?.message || e),
        },
        onChain: { analysisError: String(e?.message || e) },
        creatorTimeline: { analysisError: String(e?.message || e) },
        sourceLog: null,
      });
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    inputReport: REPORT_JSON,
    rpcEndpoint,
    summary: summarizeFindings(analyzed),
    events: analyzed,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
  fs.writeFileSync(OUT_TXT, renderTxt(out));
  console.log(`wrote ${OUT_JSON}`);
  console.log(`wrote ${OUT_TXT}`);
}

main().catch((e) => {
  console.error(`[rug-loss-forensics] ${e?.message || e}`);
  process.exit(1);
});
