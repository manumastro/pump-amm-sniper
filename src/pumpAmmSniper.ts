import dotenv from "dotenv";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import path from "path";
import bs58 from "bs58";
import util from "util";
import { OnlinePumpAmmSdk, PumpAmmSdk, buyQuoteInput, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { AccountLayout, getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction } from "@solana/spl-token";

dotenv.config();

const EARLY_ROOT_DIR = process.cwd();
const IS_WORKER_PROCESS = !!process.env.WORKER_TASK_SIGNATURE;
const WORKER_SLOT = Number(process.env.WORKER_SLOT || 0);

function timestampNow(): string {
    const d = new Date();
    const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function patchConsoleWithTimestamp() {
    const targetLogPath = IS_WORKER_PROCESS
        ? path.join(EARLY_ROOT_DIR, "logs", `paper-worker-${WORKER_SLOT || 1}.log`)
        : path.join(EARLY_ROOT_DIR, "paper.log");

    fs.mkdirSync(path.dirname(targetLogPath), { recursive: true });

    const originalLog = console.log.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    const shouldMirrorStdout = !process.env.INVOCATION_ID && !IS_WORKER_PROCESS;
    const wrap = (fn: (...args: any[]) => void) => (...args: any[]) => {
        const rendered = `[${timestampNow()}] ${util.format(...args)}`;
        fs.appendFileSync(targetLogPath, `${rendered}\n`);
        if (shouldMirrorStdout) {
            fn(rendered);
        }
    };

    console.log = wrap(originalLog);
    console.warn = wrap(originalWarn);
    console.error = wrap(originalError);
}

patchConsoleWithTimestamp();

// ═══════════════════════════════════════════════════════════════════════════════
// 🎛️ PUMP.FUN AMM SNIPER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
    // 💰 TRADING
    TRADE_AMOUNT_SOL: 0.01,               // Amount to buy per snipe
    
    // 🔒 ENTRY FILTERS
    MIN_POOL_LIQUIDITY_USD: 10000,        // Minimum liquidity in USD
    MIN_POOL_LIQUIDITY_SOL: 20,          // Kept as hard floor in SOL
    
    // ⏱️ TIMING
    AUTO_SELL_DELAY_MS: Number(process.env.AUTO_SELL_DELAY_MS || 16000), // Sell after N seconds
    PRE_BUY_WAIT_MS: Number(process.env.PRE_BUY_WAIT_MS || 1500), // Wait before entering
    PRE_BUY_MAX_LIQ_DROP_PCT: Number(process.env.PRE_BUY_MAX_LIQ_DROP_PCT || 10), // Skip if liq drops too much during wait
    PRE_BUY_CONFIRM_SNAPSHOTS: Number(process.env.PRE_BUY_CONFIRM_SNAPSHOTS || 3), // Extra confirmations after wait
    PRE_BUY_CONFIRM_INTERVAL_MS: Number(process.env.PRE_BUY_CONFIRM_INTERVAL_MS || 350), // Delay between confirmations
    PRE_BUY_TOP10_CHECK_ENABLED: process.env.PRE_BUY_TOP10_CHECK_ENABLED !== "false",
    PRE_BUY_TOP10_MAX_PCT: Number(process.env.PRE_BUY_TOP10_MAX_PCT || 90),
    PRE_BUY_TOP10_EXCLUDE_POOL: process.env.PRE_BUY_TOP10_EXCLUDE_POOL !== "false",
    CREATOR_RISK_CHECK_ENABLED: process.env.CREATOR_RISK_CHECK_ENABLED !== "false",
    CREATOR_RISK_SIG_LIMIT: Number(process.env.CREATOR_RISK_SIG_LIMIT || 20),
    CREATOR_RISK_PARSED_TX_LIMIT: Number(process.env.CREATOR_RISK_PARSED_TX_LIMIT || 10),
    CREATOR_RISK_CACHE_TTL_MS: Number(process.env.CREATOR_RISK_CACHE_TTL_MS || 15 * 60 * 1000),
    CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES: Number(process.env.CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES || 25),
    CREATOR_RISK_COMPRESSED_MAX_COUNTERPARTIES: Number(process.env.CREATOR_RISK_COMPRESSED_MAX_COUNTERPARTIES || 20),
    CREATOR_RISK_COMPRESSED_WINDOW_SEC: Number(process.env.CREATOR_RISK_COMPRESSED_WINDOW_SEC || 120),
    CREATOR_RISK_BURNER_MIN_OUT_SOL: Number(process.env.CREATOR_RISK_BURNER_MIN_OUT_SOL || 100),
    CREATOR_RISK_FUNDER_CLUSTER_ENABLED: process.env.CREATOR_RISK_FUNDER_CLUSTER_ENABLED !== "false",
    CREATOR_RISK_FUNDER_CLUSTER_MIN_CREATORS: Number(process.env.CREATOR_RISK_FUNDER_CLUSTER_MIN_CREATORS || 2),
    CREATOR_RISK_FUNDER_CLUSTER_WINDOW_SEC: Number(process.env.CREATOR_RISK_FUNDER_CLUSTER_WINDOW_SEC || 900),
    CREATOR_RISK_HISTORICAL_FUNDER_CLUSTER_MIN_RUG_CREATORS: Number(
        process.env.CREATOR_RISK_HISTORICAL_FUNDER_CLUSTER_MIN_RUG_CREATORS || 2
    ),
    CREATOR_RISK_RELAY_FUNDING_ENABLED: process.env.CREATOR_RISK_RELAY_FUNDING_ENABLED !== "false",
    CREATOR_RISK_RELAY_SIG_LIMIT: Number(process.env.CREATOR_RISK_RELAY_SIG_LIMIT || 8),
    CREATOR_RISK_RELAY_PARSED_TX_LIMIT: Number(process.env.CREATOR_RISK_RELAY_PARSED_TX_LIMIT || 6),
    CREATOR_RISK_RELAY_MIN_SOL: Number(process.env.CREATOR_RISK_RELAY_MIN_SOL || 20),
    CREATOR_RISK_RELAY_FORWARD_MIN_RATIO: Number(process.env.CREATOR_RISK_RELAY_FORWARD_MIN_RATIO || 0.9),
    CREATOR_RISK_RELAY_WINDOW_SEC: Number(process.env.CREATOR_RISK_RELAY_WINDOW_SEC || 300),
    CREATOR_RISK_STANDARD_POOL_RELAY_BLOCK_ENABLED: process.env.CREATOR_RISK_STANDARD_POOL_RELAY_BLOCK_ENABLED !== "false",
    CREATOR_RISK_STANDARD_POOL_TOLERANCE_SOL: Number(process.env.CREATOR_RISK_STANDARD_POOL_TOLERANCE_SOL || 1.5),
    CREATOR_RISK_STANDARD_POOL_LEVELS_SOL: (process.env.CREATOR_RISK_STANDARD_POOL_LEVELS_SOL || "84.99,100,120")
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v) && v > 0),
    CREATOR_RISK_STANDARD_POOL_MICRO_BLOCK_ENABLED: process.env.CREATOR_RISK_STANDARD_POOL_MICRO_BLOCK_ENABLED !== "false",
    CREATOR_RISK_STANDARD_POOL_MICRO_MIN_TRANSFERS: Number(process.env.CREATOR_RISK_STANDARD_POOL_MICRO_MIN_TRANSFERS || 4),
    CREATOR_RISK_STANDARD_POOL_MICRO_MIN_SOURCES: Number(process.env.CREATOR_RISK_STANDARD_POOL_MICRO_MIN_SOURCES || 2),
    CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_BLOCK_ENABLED: process.env.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_BLOCK_ENABLED !== "false",
    CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MIN_COUNTERPARTIES: Number(process.env.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MIN_COUNTERPARTIES || 8),
    CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MIN_OUT_TRANSFERS: Number(process.env.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MIN_OUT_TRANSFERS || 7),
    CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MAX_MICRO_TRANSFERS: Number(process.env.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MAX_MICRO_TRANSFERS || 1),
    CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MAX_MICRO_SOURCES: Number(process.env.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MAX_MICRO_SOURCES || 1),
    CREATOR_RISK_MICRO_INBOUND_MAX_SOL: Number(process.env.CREATOR_RISK_MICRO_INBOUND_MAX_SOL || 0.001),
    CREATOR_RISK_MICRO_INBOUND_MIN_TRANSFERS: Number(process.env.CREATOR_RISK_MICRO_INBOUND_MIN_TRANSFERS || 6),
    CREATOR_RISK_MICRO_INBOUND_MIN_SOURCES: Number(process.env.CREATOR_RISK_MICRO_INBOUND_MIN_SOURCES || 2),
    CREATOR_RISK_MICRO_INBOUND_WINDOW_SEC: Number(process.env.CREATOR_RISK_MICRO_INBOUND_WINDOW_SEC || 5),
    CREATOR_RISK_DIRECT_AMM_REENTRY_ENABLED: process.env.CREATOR_RISK_DIRECT_AMM_REENTRY_ENABLED !== "false",
    CREATOR_RISK_DIRECT_AMM_REENTRY_SIG_LIMIT: Number(process.env.CREATOR_RISK_DIRECT_AMM_REENTRY_SIG_LIMIT || 8),
    CREATOR_RISK_DIRECT_AMM_REENTRY_WINDOW_SEC: Number(process.env.CREATOR_RISK_DIRECT_AMM_REENTRY_WINDOW_SEC || 180),
    HOLD_CREATOR_RISK_RECHECK_ENABLED: process.env.HOLD_CREATOR_RISK_RECHECK_ENABLED !== "false",
    HOLD_CREATOR_RISK_RECHECK_INTERVAL_MS: Number(process.env.HOLD_CREATOR_RISK_RECHECK_INTERVAL_MS || 5000),
    CREATOR_RISK_FUNDER_REFUND_MIN_SOL: Number(process.env.CREATOR_RISK_FUNDER_REFUND_MIN_SOL || 0.05),
    HOLD_CREATOR_CASHOUT_EXIT_ENABLED: process.env.HOLD_CREATOR_CASHOUT_EXIT_ENABLED !== "false",
    CREATOR_RISK_CASHOUT_ABS_SOL: Number(process.env.CREATOR_RISK_CASHOUT_ABS_SOL || 5),
    CREATOR_RISK_CASHOUT_REL_LIQ_PCT: Number(process.env.CREATOR_RISK_CASHOUT_REL_LIQ_PCT || 25),
    CREATOR_RISK_CASHOUT_WARN_SCORE: Number(process.env.CREATOR_RISK_CASHOUT_WARN_SCORE || 0.5),
    CREATOR_RISK_CASHOUT_EXIT_SCORE: Number(process.env.CREATOR_RISK_CASHOUT_EXIT_SCORE || 1),
    
    // 🔧 SLIPPAGE
    SLIPPAGE_PERCENT: 20,                 // 20% slippage (più conservativo)

    // 🛡️ SAFETY FILTERS
    REQUIRE_RENOUNCED_MINT: true,        // Skip if dev can still mint
    REQUIRE_NO_FREEZE: true,             // Skip if dev can freeze accounts
    MAX_DEV_HOLDINGS_PCT: 20,            // Skip if dev owns more than 20%
    ENFORCE_DEV_HOLDINGS_CHECK: process.env.ENFORCE_DEV_HOLDINGS_CHECK !== "false", // On by default
    DEV_HOLDINGS_MAX_ATTEMPTS: Number(process.env.DEV_HOLDINGS_MAX_ATTEMPTS || 3),
    DEV_HOLDINGS_RETRY_DELAY_MS: Number(process.env.DEV_HOLDINGS_RETRY_DELAY_MS || 250),
    DEV_HOLDINGS_MAX_DURATION_MS: Number(process.env.DEV_HOLDINGS_MAX_DURATION_MS || 2000),

    // 👀 MONITORING HARDENING
    LOG_STALE_RESUBSCRIBE_MS: 90000,     // Resubscribe if no logs for 90s
    HEALTHCHECK_INTERVAL_MS: 15000,      // Healthcheck every 15s
    SIGNATURE_CACHE_TTL_MS: 10 * 60 * 1000, // Keep seen signatures for 10m
    SIGNATURE_CACHE_MAX_SIZE: 5000,      // Bound memory usage
    SOL_PRICE_CACHE_TTL_MS: 30000,       // Refresh SOL/USD every 30s
    RUG_HISTORY_CACHE_TTL_MS: Number(process.env.RUG_HISTORY_CACHE_TTL_MS || 5 * 60 * 1000),

    // 📈 PAPER TRADE (simulation only)
    PAPER_TRADE_ENABLED: process.env.PAPER_TRADE_ENABLED === "true",
    MAX_CONCURRENT_OPERATIONS: Number(process.env.MAX_CONCURRENT_OPERATIONS || 2),
    PAPER_TRADE_MAX_LOSS_PCT: Number(process.env.PAPER_TRADE_MAX_LOSS_PCT || 80),
    LIQUIDITY_STOP_ENABLED: process.env.LIQUIDITY_STOP_ENABLED !== "false",
    LIQUIDITY_STOP_DROP_PCT: Number(process.env.LIQUIDITY_STOP_DROP_PCT || 30),
    LIQUIDITY_STOP_CHECK_INTERVAL_MS: Number(process.env.LIQUIDITY_STOP_CHECK_INTERVAL_MS || 300),
    POST_ENTRY_STABILITY_GATE_ENABLED: process.env.POST_ENTRY_STABILITY_GATE_ENABLED !== "false",
    POST_ENTRY_STABILITY_GATE_WINDOW_MS: Number(process.env.POST_ENTRY_STABILITY_GATE_WINDOW_MS || 5000),
    POST_ENTRY_STABILITY_GATE_DROP_PCT: Number(process.env.POST_ENTRY_STABILITY_GATE_DROP_PCT || 4),
};

// ═══════════════════════════════════════════════════════════════════════════════

// Program IDs
const PUMPFUN_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const WSOL = "So11111111111111111111111111111111111111112";

// Runtime mode
const PRIVATE_KEY_B58 = process.env.PRIVATE_KEY;
const hasUsablePrivateKey = !!PRIVATE_KEY_B58 && !PRIVATE_KEY_B58.startsWith("YOUR_");

let walletKeypair: Keypair | null = null;
if (hasUsablePrivateKey) {
    try {
        walletKeypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY_B58!));
    } catch {
        console.warn("⚠️ PRIVATE_KEY is not valid base58. Falling back to monitor-only mode.");
    }
}

const MONITOR_ONLY = process.env.MONITOR_ONLY === "true" || !walletKeypair;

// State
let activePoolJobs = 0;
let activeLivePositions = 0;
let logSubscriptionId: number | null = null;
let lastLogAtMs = Date.now();
let healthcheckInterval: NodeJS.Timeout | null = null;
const seenSignatures = new Map<string, number>();
let cachedSolPriceUsd: number | null = null;
let cachedSolPriceAtMs = 0;
const creatorRiskCache = new Map<string, { checkedAtMs: number; result: CreatorRiskResult }>();
let cachedRugHistoryAtMs = 0;
let cachedRugHistory: RugHistory | null = null;
const recentFunderCreators = new Map<string, Array<{ creator: string; seenAtMs: number }>>();

const ROOT_DIR = process.cwd();
const PAPER_LOG_PATH = path.join(ROOT_DIR, "paper.log");
const PAPER_REPORT_JSON_PATH = path.join(ROOT_DIR, "logs", "paper-report.json");
const BLACKLISTS_DIR = path.join(ROOT_DIR, "blacklists");
const BLACKLIST_CREATORS_PATH = path.join(BLACKLISTS_DIR, "creators.txt");
const BLACKLIST_FUNDERS_PATH = path.join(BLACKLISTS_DIR, "funders.txt");
const BLACKLIST_MICRO_BURST_SOURCES_PATH = path.join(BLACKLISTS_DIR, "micro-burst-sources.txt");
const BLACKLIST_CASHOUT_RELAYS_PATH = path.join(BLACKLISTS_DIR, "cashout-relays.txt");
const BLACKLIST_FUNDER_COUNTS_PATH = path.join(BLACKLISTS_DIR, "funder-counts.json");
const WORKER_LOG_DIR = path.join(ROOT_DIR, "logs");

type WorkerSlotState = {
    slot: number;
    busy: boolean;
    signature: string | null;
    child: ChildProcess | null;
};

function shortSig(sig: string): string {
    if (sig.length <= 14) return sig;
    return `${sig.slice(0, 6)}...${sig.slice(-6)}`;
}

function stageLog(_ctx: string, stage: string, message: string) {
    console.log(`${stage.padEnd(12)} | ${message}`);
}

function inFlightCount(): number {
    if (!IS_WORKER_PROCESS && workerSlots.length > 0) {
        return workerSlots.filter((slot) => slot.busy).length;
    }
    return activePoolJobs + activeLivePositions;
}

function getWorkerLogPath(slot: number): string {
    return path.join(WORKER_LOG_DIR, `paper-worker-${slot}.log`);
}

function getWorkerEntryCommand(): { cmd: string; args: string[] } {
    const distEntry = path.join(ROOT_DIR, "dist", "pumpAmmSniper.js");
    if (fs.existsSync(distEntry)) {
        return { cmd: process.execPath, args: [distEntry] };
    }
    return { cmd: "npx", args: ["ts-node", "src/pumpAmmSniper.ts"] };
}

const workerSlots: WorkerSlotState[] = !IS_WORKER_PROCESS
    ? Array.from({ length: Math.max(1, CONFIG.MAX_CONCURRENT_OPERATIONS) }, (_, index) => ({
        slot: index + 1,
        busy: false,
        signature: null,
        child: null,
    }))
    : [];

function toSubscriptDigits(value: number): string {
    const map = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
    return String(value).split("").map((c) => (c >= "0" && c <= "9") ? map[Number(c)] : c).join("");
}

function formatSolCompact(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "0 SOL";
    if (value >= 0.001) return `${value.toFixed(6)} SOL`;

    const s = value.toFixed(12); // enough precision for tiny SOL values in logs
    const frac = s.split(".")[1] || "";
    const firstNonZero = frac.search(/[1-9]/);
    if (firstNonZero <= 0) return `${value.toFixed(12)} SOL`;

    const zeros = firstNonZero;
    const significant = frac.slice(firstNonZero, firstNonZero + 4).replace(/0+$/, "") || "0";
    return `0.0${toSubscriptDigits(zeros)}${significant} SOL`;
}

function formatSolDecimal(value: number): string {
    if (!Number.isFinite(value)) return "0.000000 SOL";
    return `${value.toFixed(6)} SOL`;
}

type CreatorRiskResult = {
    ok: boolean;
    reason?: string;
    funder?: string | null;
    uniqueCounterparties?: number;
    compressedWindowSec?: number | null;
    burner?: boolean;
    funderRefundSol?: number;
    creatorCashoutSol?: number;
    creatorCashoutPctOfEntryLiquidity?: number;
    creatorCashoutScore?: number;
    creatorCashoutDestination?: string | null;
    relayFundingRoot?: string | null;
    directAmmReentrySig?: string | null;
};

type RugHistory = {
    rugCreators: Set<string>;
    rugFunders: Set<string>;
    rugMicroBurstSources: Set<string>;
    rugCashoutRelays: Set<string>;
    rugFunderCounts: Map<string, number>;
};

function calcSpotSolPerToken(baseReserve: BN, quoteReserve: BN, tokenDecimals: number): number {
    const baseSol = Number(baseReserve.toString()) / 1e9;
    const quoteTokens = Number(quoteReserve.toString()) / 10 ** tokenDecimals;
    if (!Number.isFinite(baseSol) || !Number.isFinite(quoteTokens) || quoteTokens <= 0) return 0;
    return baseSol / quoteTokens;
}

function getPoolOrientation(state: any, tokenMint: string): { solIsBase: boolean; tokenIsBase: boolean; hasWsol: boolean } {
    const baseMintStr = state.baseMint?.toBase58?.() || String(state.baseMint);
    const tokenIsBase = baseMintStr === tokenMint;
    const solIsBase = baseMintStr === WSOL;
    const hasWsol = solIsBase || !tokenIsBase; // in this bot we expect a SOL/token pool
    return { solIsBase, tokenIsBase, hasWsol };
}

function getSolLiquidityFromState(state: any, tokenMint: string): number | null {
    const { solIsBase, hasWsol } = getPoolOrientation(state, tokenMint);
    if (!hasWsol) return null;
    const solRaw = solIsBase ? state.poolBaseAmount : state.poolQuoteAmount;
    return Number(solRaw.toString()) / 1e9;
}

function getSpotSolPerTokenFromState(state: any, tokenMint: string, tokenDecimals: number): number | null {
    const { solIsBase, hasWsol } = getPoolOrientation(state, tokenMint);
    if (!hasWsol) return null;
    return solIsBase
        ? calcSpotSolPerToken(state.poolBaseAmount, state.poolQuoteAmount, tokenDecimals)
        : calcSpotSolPerToken(state.poolQuoteAmount, state.poolBaseAmount, tokenDecimals);
}

// Initialize SDKs
let onlineSdk: OnlinePumpAmmSdk;
let offlineSdk: PumpAmmSdk;

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    if (IS_WORKER_PROCESS) {
        await runWorkerTask();
        return;
    }

    await runSupervisor();
}

async function runSupervisor() {
    const rpcEndpoint = process.env.SVS_UNSTAKED_RPC || "https://api.mainnet-beta.solana.com";
    const connection = new Connection(rpcEndpoint, { commitment: "confirmed" });

    // Initialize SDKs with connection
    onlineSdk = new OnlinePumpAmmSdk(connection);
    offlineSdk = new PumpAmmSdk();

    console.log("🎯 STARTING PUMP.FUN AMM SNIPER 🎯");
    console.log(`Program: ${PUMPFUN_AMM_PROGRAM_ID}`);
    console.log(`Mode: ${MONITOR_ONLY ? "MONITOR_ONLY" : "TRADING"}`);
    console.log(`Wallet: ${walletKeypair ? walletKeypair.publicKey.toBase58() : "N/A (no private key loaded)"}`);
    console.log(`Min Liquidity: ${CONFIG.MIN_POOL_LIQUIDITY_SOL} SOL`);
    console.log(`Max Parallel Ops: ${workerSlots.length}`);
    if (!MONITOR_ONLY) {
        console.log(`Amount: ${CONFIG.TRADE_AMOUNT_SOL} SOL`);
        console.log(`Auto-Sell: ${CONFIG.AUTO_SELL_DELAY_MS / 1000} seconds`);
    } else if (CONFIG.PAPER_TRADE_ENABLED) {
        console.log(`Paper Trade: enabled (every valid pool, exit delay ${CONFIG.AUTO_SELL_DELAY_MS / 1000}s)`);
    }
    console.log("");

    // Subscribe to program logs with watchdog + auto-resubscribe
    await subscribeToPoolLogs(connection);
    startLogHealthcheck(connection);
    setupGracefulShutdown(connection);

    // Keep process alive
    console.log("🚀 Sniper is running. Press Ctrl+C to stop.\n");
}

async function runWorkerTask() {
    const signature = process.env.WORKER_TASK_SIGNATURE;
    if (!signature) {
        throw new Error("WORKER_TASK_SIGNATURE missing");
    }

    const rpcEndpoint = process.env.SVS_UNSTAKED_RPC || "https://api.mainnet-beta.solana.com";
    const connection = new Connection(rpcEndpoint, { commitment: "confirmed" });

    onlineSdk = new OnlinePumpAmmSdk(connection);
    offlineSdk = new PumpAmmSdk();

    console.log(`WORKER       | slot ${WORKER_SLOT || 1} start ${shortSig(signature)}`);
    stageLog("", "SIGNATURE", signature);
    await handleNewPool(connection, signature);
    console.log(`WORKER       | slot ${WORKER_SLOT || 1} done ${shortSig(signature)}`);
}

function findIdleWorkerSlot(): WorkerSlotState | null {
    return workerSlots.find((slot) => !slot.busy) || null;
}

function dispatchPoolToWorker(signature: string) {
    const slot = findIdleWorkerSlot();
    if (!slot) {
        console.log(`QUEUE        | busy skip ${shortSig(signature)}`);
        return;
    }

    fs.mkdirSync(WORKER_LOG_DIR, { recursive: true });
    const workerLogPath = getWorkerLogPath(slot.slot);
    if (!fs.existsSync(workerLogPath)) {
        fs.writeFileSync(workerLogPath, "");
    }

    slot.busy = true;
    slot.signature = signature;
    console.log(`DISPATCH     | worker-${slot.slot} ${shortSig(signature)}`);

    const workerEntry = getWorkerEntryCommand();
    const child = spawn(workerEntry.cmd, workerEntry.args, {
        cwd: ROOT_DIR,
        env: {
            ...process.env,
            WORKER_TASK_SIGNATURE: signature,
            WORKER_SLOT: String(slot.slot),
        },
        stdio: "ignore",
    });

    slot.child = child;

    child.on("exit", (code, signal) => {
        console.log(
            `WORKER       | worker-${slot.slot} done ${shortSig(signature)} ` +
            `(code=${code ?? "null"} signal=${signal ?? "-"})`
        );
        slot.busy = false;
        slot.signature = null;
        slot.child = null;
    });

    child.on("error", (error) => {
        console.error(`WORKER       | worker-${slot.slot} failed ${shortSig(signature)}: ${error.message}`);
        slot.busy = false;
        slot.signature = null;
        slot.child = null;
    });
}

async function subscribeToPoolLogs(connection: Connection) {
    console.log("👀 Listening for 'create_pool' logs...");
    logSubscriptionId = connection.onLogs(
        new PublicKey(PUMPFUN_AMM_PROGRAM_ID),
        async (logs) => {
            try {
                lastLogAtMs = Date.now();
                pruneSignatureCache(lastLogAtMs);

                if (alreadySeenSignature(logs.signature, lastLogAtMs)) {
                    return;
                }

                // Check for pool creation
                const hasCreatePool = logs.logs.some(log =>
                    log.toLowerCase().includes("create_pool") ||
                    log.toLowerCase().includes("createpool")
                );

                if (!hasCreatePool) return;

                if (inFlightCount() >= Math.max(1, CONFIG.MAX_CONCURRENT_OPERATIONS)) {
                    console.log(`QUEUE        | busy skip ${shortSig(logs.signature)}`);
                    return;
                }
                dispatchPoolToWorker(logs.signature);
            } catch (e: any) {
                console.error(`❌ Log handler error: ${e.message}`);
            }
        },
        "confirmed"
    );
}

function alreadySeenSignature(signature: string, nowMs: number): boolean {
    const existing = seenSignatures.get(signature);
    if (existing && nowMs - existing < CONFIG.SIGNATURE_CACHE_TTL_MS) {
        return true;
    }
    seenSignatures.set(signature, nowMs);
    return false;
}

function pruneSignatureCache(nowMs: number) {
    for (const [sig, timestamp] of seenSignatures) {
        if (nowMs - timestamp > CONFIG.SIGNATURE_CACHE_TTL_MS) {
            seenSignatures.delete(sig);
        }
    }

    // If still too large, remove oldest entries
    if (seenSignatures.size > CONFIG.SIGNATURE_CACHE_MAX_SIZE) {
        const entries = Array.from(seenSignatures.entries()).sort((a, b) => a[1] - b[1]);
        const toRemove = seenSignatures.size - CONFIG.SIGNATURE_CACHE_MAX_SIZE;
        for (let i = 0; i < toRemove; i++) {
            seenSignatures.delete(entries[i][0]);
        }
    }
}

function startLogHealthcheck(connection: Connection) {
    if (healthcheckInterval) clearInterval(healthcheckInterval);

    healthcheckInterval = setInterval(async () => {
        const now = Date.now();
        const staleForMs = now - lastLogAtMs;

        if (staleForMs < CONFIG.LOG_STALE_RESUBSCRIBE_MS) return;

        console.warn(`⚠️ Log stream stale for ${Math.floor(staleForMs / 1000)}s. Resubscribing...`);
        try {
            if (logSubscriptionId !== null) {
                await connection.removeOnLogsListener(logSubscriptionId);
            }
        } catch (e: any) {
            console.warn(`⚠️ Failed removing old log subscription: ${e.message}`);
        }

        logSubscriptionId = null;
        lastLogAtMs = now;
        await subscribeToPoolLogs(connection);
    }, CONFIG.HEALTHCHECK_INTERVAL_MS);
}

function setupGracefulShutdown(connection: Connection) {
    const shutdown = async () => {
        console.log("\n🛑 Shutting down...");

        if (healthcheckInterval) {
            clearInterval(healthcheckInterval);
            healthcheckInterval = null;
        }

        if (logSubscriptionId !== null) {
            try {
                await connection.removeOnLogsListener(logSubscriptionId);
            } catch {
                // no-op on shutdown
            }
            logSubscriptionId = null;
        }

        for (const slot of workerSlots) {
            if (slot.child && !slot.child.killed) {
                try {
                    slot.child.kill("SIGTERM");
                } catch {
                    // no-op on shutdown
                }
            }
        }

        process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLE NEW POOL
// ═══════════════════════════════════════════════════════════════════════════════

async function handleNewPool(connection: Connection, signature: string) {
    const ctx = shortSig(signature);
    activePoolJobs += 1;
    const eventStartedAt = Date.now();
    let finalStatus = "COMPLETED";

    stageLog(ctx, "START", "processing pool");
    stageLog(ctx, "STEP 1/7", "parse transaction");
    
    try {
        // Get transaction data
        let tx: any = null;
        for (let i = 0; i < 5; i++) { // Retry a bit more for indexing
            tx = await connection.getParsedTransaction(signature, { 
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed"
            });
            if (tx) break;
            await new Promise(r => setTimeout(r, 500));
        }

        if (!tx) {
            console.log(`❌ Could not fetch transaction data. Skipping.`);
            finalStatus = "SKIP: tx unavailable";
            return;
        }

        // Extract pool address and token mint from transaction
        // According to IDL: pool=0, global_config=1, creator=2, base_mint=3, quote_mint=4
        const accountKeys = tx.transaction.message.accountKeys;
        let poolAddress: string | null = null;
        let tokenMint: string | null = null;

        // Debug: Log account keys
        stageLog(ctx, "TX", `accounts=${accountKeys.length}`);

        // Find the create_pool instruction within the transaction
        let creatorAddress: string | null = null;
        const instructions = tx.transaction.message.instructions;
        for (const ix of instructions) {
            // Check if this instruction is to the Pump AMM program
            const programId = accountKeys[ix.programIdIndex]?.pubkey?.toBase58();
            
            if (programId === PUMPFUN_AMM_PROGRAM_ID) {
                stageLog(ctx, "TX", `pump-amm instruction accounts=${ix.accounts?.length || 0}`);
                // Extract accounts based on IDL order
                if (ix.accounts && ix.accounts.length >= 5) {
                    poolAddress = accountKeys[ix.accounts[0]]?.pubkey?.toBase58() || null;
                    tokenMint = accountKeys[ix.accounts[3]]?.pubkey?.toBase58() || null;
                    creatorAddress = accountKeys[ix.accounts[2]]?.pubkey?.toBase58() || null;
                    if (creatorAddress) {
                        stageLog(ctx, "CREATOR", creatorAddress);
                    }
                }
                break;
            }
        }

        // Fallback for tokenMint/pool if instructions didn't match (sometimes it's inner instructions)
        if (!tokenMint || !poolAddress) {
            stageLog(ctx, "TX", "fallback postTokenBalances");
            const balances = tx.meta?.postTokenBalances || [];
            // Token is usually the one that IS NOT WSOL
            const tokenBalance = balances.find((b: any) => b.mint !== WSOL);
            if (tokenBalance) {
                tokenMint = tokenBalance.mint;
                // Pool address is often the owner of the WSOL account in the transaction
                const poolBalance = balances.find((b: any) => b.mint === WSOL && b.owner !== tx.transaction.message.accountKeys[0].pubkey.toBase58());
                if (poolBalance) poolAddress = poolBalance.owner;
            }
        }

        if (!poolAddress || !tokenMint) {
            console.log(`❌ Could not extract pool/token from TX. Skipping.`);
            finalStatus = "SKIP: pool/token unresolved";
            return;
        }

        stageLog(ctx, "STEP 2/7", "resolve token/pool/creator");
        stageLog(ctx, "TOKEN", tokenMint);
        stageLog(ctx, "POOL", poolAddress);
        stageLog(ctx, "GMGN", `https://gmgn.ai/sol/token/${tokenMint}`);

        // Always require a creator address (fail-closed).
        // If not present in tx accounts, resolve it from on-chain pool state.
        if (!creatorAddress) {
            creatorAddress = await resolveCreatorFromPool(connection, poolAddress);
            if (creatorAddress) {
                stageLog(ctx, "CREATOR", `resolved ${creatorAddress}`);
            }
        }

        if (!creatorAddress) {
            console.log(`🛑 SKIP: creator not resolvable`);
            finalStatus = "SKIP: creator unresolved";
            return;
        }

        stageLog(ctx, "STEP 3/7", "liquidity check");
        // Check liquidity from on-chain pool state (preferred) with tx fallback.
        let liquiditySOL = 0;
        const observerUser = walletKeypair?.publicKey ?? Keypair.generate().publicKey;
        try {
            const poolState = await onlineSdk.swapSolanaState(new PublicKey(poolAddress), observerUser);
            const liq = getSolLiquidityFromState(poolState, tokenMint);
            if (liq !== null) liquiditySOL = liq;
        } catch {
            // fallback below
        }

        // Fallback to transaction balances if pool state is not yet indexable
        const postTokenBalances = tx.meta.postTokenBalances || [];
        if (liquiditySOL <= 0) {
            const quoteBalance = postTokenBalances.find((b: any) =>
                b.mint === WSOL && b.owner === poolAddress
            );
            const poolSOL = quoteBalance ? (parseFloat(quoteBalance.uiTokenAmount?.amount || "0") / 1e9) : 0;
            liquiditySOL = poolSOL;

            if (liquiditySOL === 0) {
                const poolAccountIndex = instructions[0]?.accounts?.[0];
                if (poolAccountIndex !== undefined) {
                    const poolLamports = tx.meta.postBalances[poolAccountIndex] || 0;
                    liquiditySOL = poolLamports / 1e9;
                }
            }
        }

        const solPriceUsd = await getSolPriceUsd();
        let liquidityUSD: number | null = null;
        if (solPriceUsd !== null) {
            liquidityUSD = liquiditySOL * solPriceUsd;
            stageLog(ctx, "LIQ", `${liquiditySOL.toFixed(2)} SOL (~$${liquidityUSD.toFixed(0)})`);
        } else {
            stageLog(ctx, "LIQ", `${liquiditySOL.toFixed(2)} SOL (USD unavailable)`);
        }

        const failedSolThreshold = liquiditySOL < CONFIG.MIN_POOL_LIQUIDITY_SOL;
        if (failedSolThreshold) {
            const usdPart = liquidityUSD !== null ? `$${liquidityUSD.toFixed(0)}` : "USD N/A";
            console.log(
                `🛑 SKIP: Liquidity too low ` +
                `(${liquiditySOL.toFixed(2)} SOL / ${usdPart}; ` +
                `min ${CONFIG.MIN_POOL_LIQUIDITY_SOL} SOL)`
            );
            finalStatus = "SKIP: low liquidity";
            return;
        }

        stageLog(ctx, "STEP 4/7", "mint/freeze security");
        // 🛡️ SAFETY CHECKS
        const isSafe = await checkTokenSecurity(connection, tokenMint);
        if (!isSafe) {
            console.log(`🛑 SKIP: Token failed safety checks.`);
            finalStatus = "SKIP: token security";
            return;
        }

        stageLog(ctx, "STEP 5/7", "creator risk");
        const creatorRisk = await runCreatorRiskCheck(connection, creatorAddress, ctx, {
            entrySolLiquidity: liquiditySOL,
            createPoolSignature: signature,
            createPoolBlockTime: tx.blockTime || null,
        });
        if (!creatorRisk.ok) {
            console.log(`🛑 SKIP: creator risk (${creatorRisk.reason})`);
            finalStatus = "SKIP: creator risk";
            return;
        }

        if (MONITOR_ONLY) {
            if (CONFIG.PRE_BUY_WAIT_MS > 0) {
                const preEntry = await preEntryWaitAndCheck(connection, signature, poolAddress, tokenMint, liquiditySOL, ctx);
                if (!preEntry.ok) {
                    console.log(`🛑 SKIP: pre-entry guard (${preEntry.reason})`);
                    finalStatus = "SKIP: pre-entry guard";
                    return;
                }
                liquiditySOL = preEntry.currentLiquiditySol;
            }
            const top10 = await preBuyTop10ConcentrationCheck(connection, tokenMint, poolAddress, ctx);
            if (!top10.ok) {
                console.log(`🛑 SKIP: pre-buy top10 (${top10.reason})`);
                finalStatus = "SKIP: pre-buy top10";
                return;
            }
            stageLog(ctx, "STEP 6/7", "paper simulation");
            const paper = await maybeRunPaperTradeSimulation(
                connection,
                poolAddress,
                tokenMint,
                ctx,
                creatorAddress,
                signature,
                tx.blockTime || null,
            );
            if (!paper.ok) {
                console.log(`🛑 SKIP: Paper simulation guard (${paper.reason})`);
                finalStatus = "SKIP: paper simulation guard";
                return;
            }
            stageLog(ctx, "STEP 7/7", "dev holdings");
            const devCheckOk = await runDevHoldingsCheck(connection, creatorAddress, tokenMint, postTokenBalances, ctx, false);
            if (devCheckOk) {
                console.log(`✅ Checks passed`);
            }
            stageLog(ctx, "MODE", "MONITOR_ONLY no live trade");
            return;
        }

        const devCheckOk = await runDevHoldingsCheck(connection, creatorAddress, tokenMint, postTokenBalances, ctx, true);
        if (!devCheckOk) {
            finalStatus = "SKIP: dev holdings";
            return;
        }

        if (CONFIG.PRE_BUY_WAIT_MS > 0) {
            const preEntry = await preEntryWaitAndCheck(connection, signature, poolAddress, tokenMint, liquiditySOL, ctx);
            if (!preEntry.ok) {
                console.log(`🛑 SKIP: pre-entry guard (${preEntry.reason})`);
                finalStatus = "SKIP: pre-entry guard";
                return;
            }
        }
        const top10 = await preBuyTop10ConcentrationCheck(connection, tokenMint, poolAddress, ctx);
        if (!top10.ok) {
            console.log(`🛑 SKIP: pre-buy top10 (${top10.reason})`);
            finalStatus = "SKIP: pre-buy top10";
            return;
        }

        stageLog(ctx, "CHECKS", "passed");

        // Execute buy
        stageLog(ctx, "BUY", "executing");
        await executeBuy(connection, poolAddress, tokenMint);

    } catch (e: any) {
        console.error(`❌ Error in handleNewPool: ${e.message}`);
        finalStatus = `ERROR: ${e.message}`;
    } finally {
        activePoolJobs = Math.max(0, activePoolJobs - 1);
        stageLog(ctx, "END", `${finalStatus} (${Date.now() - eventStartedAt}ms)`);
        console.log("────────────────────────────────────────────────────────");
    }
}

async function resolveCreatorFromPool(connection: Connection, poolAddress: string): Promise<string | null> {
    try {
        const observerUser = walletKeypair?.publicKey ?? Keypair.generate().publicKey;
        const state = await onlineSdk.swapSolanaState(new PublicKey(poolAddress), observerUser);
        return state.pool.creator.toBase58();
    } catch {
        return null;
    }
}

async function waitForFirstPoolTrade(
    connection: Connection,
    createSignature: string,
    poolAddress: string,
    ctx: string,
): Promise<void> {
    if (CONFIG.PRE_BUY_WAIT_MS <= 0) return;

    stageLog(ctx, "WAIT", "waiting for first pool trade");
    const poolKey = new PublicKey(poolAddress);

    while (true) {
        try {
            const signatures = await connection.getSignaturesForAddress(poolKey, { limit: 20 }, "confirmed");
            const firstTrade = signatures
                .filter((s: any) => s.signature !== createSignature)
                .sort((a: any, b: any) => (a.blockTime || 0) - (b.blockTime || 0))[0];

            if (firstTrade) {
                const firstTradeAtMs = firstTrade.blockTime ? firstTrade.blockTime * 1000 : Date.now();
                const remainingMs = Math.max(0, CONFIG.PRE_BUY_WAIT_MS - (Date.now() - firstTradeAtMs));
                stageLog(
                    ctx,
                    "WAIT",
                    `first trade ${shortSig(firstTrade.signature)} seen, remaining ${remainingMs}ms from first trade`
                );
                if (remainingMs > 0) {
                    await new Promise(r => setTimeout(r, remainingMs));
                }
                return;
            }
        } catch (e: any) {
            stageLog(ctx, "WAIT", `first trade lookup retry (${e?.message || "unknown error"})`);
        }

        await new Promise(r => setTimeout(r, 500));
    }
}

async function preEntryWaitAndCheck(
    connection: Connection,
    createSignature: string,
    poolAddress: string,
    tokenMint: string,
    baselineLiquiditySol: number,
    ctx: string,
): Promise<{ ok: boolean; reason?: string; currentLiquiditySol: number }> {
    await waitForFirstPoolTrade(connection, createSignature, poolAddress, ctx);

    try {
        const observerUser = walletKeypair?.publicKey ?? Keypair.generate().publicKey;
        const samples = Math.max(1, CONFIG.PRE_BUY_CONFIRM_SNAPSHOTS);
        const intervalMs = Math.max(0, CONFIG.PRE_BUY_CONFIRM_INTERVAL_MS);
        const observed: number[] = [];
        let latest = baselineLiquiditySol;
        const minAllowedDrop = baselineLiquiditySol > 0
            ? baselineLiquiditySol * (1 - Math.abs(CONFIG.PRE_BUY_MAX_LIQ_DROP_PCT) / 100)
            : 0;

        for (let i = 0; i < samples; i++) {
            const state = await onlineSdk.swapSolanaState(new PublicKey(poolAddress), observerUser);
            const liq = getSolLiquidityFromState(state, tokenMint);
            if (liq === null || !Number.isFinite(liq) || liq <= 0) {
                return { ok: false, reason: "pool has no WSOL side on pre-entry check", currentLiquiditySol: 0 };
            }
            latest = liq;
            observed.push(liq);

            if (liq < CONFIG.MIN_POOL_LIQUIDITY_SOL) {
                return {
                    ok: false,
                    reason: `liquidity below min at pre-entry (${liq.toFixed(2)} SOL < ${CONFIG.MIN_POOL_LIQUIDITY_SOL} SOL)`,
                    currentLiquiditySol: liq,
                };
            }

            if (baselineLiquiditySol > 0 && liq < minAllowedDrop) {
                return {
                    ok: false,
                    reason: `liquidity dropped ${baselineLiquiditySol.toFixed(2)} -> ${liq.toFixed(2)} SOL`,
                    currentLiquiditySol: liq,
                };
            }

            if (i < samples - 1 && intervalMs > 0) {
                await new Promise(r => setTimeout(r, intervalMs));
            }
        }

        const minObserved = Math.min(...observed);
        stageLog(
            ctx,
            "WAIT",
            `pre-entry liquidity ${latest.toFixed(2)} SOL (min observed ${minObserved.toFixed(2)} SOL over ${samples} samples)`
        );
        return { ok: true, currentLiquiditySol: latest };
    } catch (e: any) {
        return { ok: false, reason: e?.message || "pre-entry liquidity fetch failed", currentLiquiditySol: baselineLiquiditySol };
    }
}

async function preBuyTop10ConcentrationCheck(
    connection: Connection,
    tokenMint: string,
    poolAddress: string,
    ctx: string,
): Promise<{ ok: boolean; reason?: string; top10Pct?: number }> {
    if (!CONFIG.PRE_BUY_TOP10_CHECK_ENABLED) {
        stageLog(ctx, "TOP10", "check disabled");
        return { ok: true };
    }

    try {
        const mintKey = await resolveTop10MintKey(connection, tokenMint, poolAddress, ctx);
        if (!mintKey) {
            stageLog(ctx, "TOP10", "unavailable (no valid mint candidate) -> fail-open");
            return { ok: true };
        }

        const mintInfo = await getMintInfoRobust(connection, mintKey).catch((e: any) => {
            stageLog(ctx, "TOP10", `unavailable (mint info error: ${e?.message || String(e)}) -> fail-open`);
            return null;
        });
        if (!mintInfo) return { ok: true };

        const totalSupplyRaw = Number(mintInfo.supply.toString());
        if (!Number.isFinite(totalSupplyRaw) || totalSupplyRaw <= 0) {
            stageLog(ctx, "TOP10", "unavailable (invalid token supply) -> fail-open");
            return { ok: true };
        }

        const largest = await getTop10LargestAccountsWithRetry(connection, mintKey, 6, 300, ctx);
        if (!largest) return { ok: true };

        const top10Accounts = largest.value.slice(0, 10);
        if (top10Accounts.length === 0) {
            stageLog(ctx, "TOP10", "unavailable (no holder accounts found) -> fail-open");
            return { ok: true };
        }

        const parsed = await Promise.all(
            top10Accounts.map((a) => connection.getParsedAccountInfo(a.address, "confirmed").catch(() => null))
        );

        let top10Raw = 0;
        for (let i = 0; i < top10Accounts.length; i++) {
            const amount = Number(top10Accounts[i].amount || "0");
            if (!Number.isFinite(amount) || amount <= 0) continue;

            const owner = (parsed[i] as any)?.value?.data?.parsed?.info?.owner as string | undefined;
            if (CONFIG.PRE_BUY_TOP10_EXCLUDE_POOL && owner && owner === poolAddress) {
                continue;
            }

            top10Raw += amount;
        }

        const top10Pct = (top10Raw / totalSupplyRaw) * 100;
        stageLog(
            ctx,
            "TOP10",
            `${top10Pct.toFixed(2)}% (max ${CONFIG.PRE_BUY_TOP10_MAX_PCT.toFixed(2)}%)`
        );

        if (top10Pct > CONFIG.PRE_BUY_TOP10_MAX_PCT) {
            return {
                ok: false,
                reason: `top10 concentration ${top10Pct.toFixed(2)}% > ${CONFIG.PRE_BUY_TOP10_MAX_PCT.toFixed(2)}%`,
                top10Pct,
            };
        }

        return { ok: true, top10Pct };
    } catch (e: any) {
        stageLog(ctx, "TOP10", `unavailable (${e?.message || "top10 check failed"}) -> fail-open`);
        return { ok: true };
    }
}

async function getTop10LargestAccountsWithRetry(
    connection: Connection,
    mintKey: PublicKey,
    maxAttempts: number,
    delayMs: number,
    ctx: string,
) {
    let lastErr: any = null;
    for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
        try {
            return await connection.getTokenLargestAccounts(mintKey, "confirmed");
        } catch (e: any) {
            lastErr = e;
            if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, Math.max(0, delayMs)));
            }
        }
    }
    stageLog(ctx, "TOP10", `unavailable (largest accounts error: ${lastErr?.message || String(lastErr)}) -> fail-open`);
    return null;
}

async function resolveTop10MintKey(
    connection: Connection,
    tokenMint: string,
    poolAddress: string,
    ctx: string,
): Promise<PublicKey | null> {
    const candidates: string[] = [tokenMint];

    try {
        const observerUser = walletKeypair?.publicKey ?? Keypair.generate().publicKey;
        const state = await onlineSdk.swapSolanaState(new PublicKey(poolAddress), observerUser);
        const anyState = state as any;
        const baseMint = anyState?.baseMint?.toBase58?.() || String(anyState?.baseMint || "");
        const quoteMint = anyState?.quoteMint?.toBase58?.() || String(anyState?.quoteMint || "");
        if (baseMint && baseMint !== WSOL) candidates.push(baseMint);
        if (quoteMint && quoteMint !== WSOL) candidates.push(quoteMint);
    } catch {
        // Keep initial extracted mint only.
    }

    const uniqueCandidates = [...new Set(candidates)];
    for (const candidate of uniqueCandidates) {
        try {
            const key = new PublicKey(candidate);
            await getMintInfoRobust(connection, key);
            if (candidate !== tokenMint) {
                stageLog(ctx, "TOP10", `using fallback mint ${candidate}`);
            }
            return key;
        } catch {
            // Try next candidate.
        }
    }

    return null;
}

function readBlacklistSet(filePath: string): Set<string> {
    try {
        if (!fs.existsSync(filePath)) {
            return new Set();
        }
        const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
        return new Set(
            lines
                .map((line) => line.replace(/#.*/, "").trim())
                .filter((line) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(line))
        );
    } catch {
        return new Set();
    }
}

function readBlacklistCountMap(filePath: string): Map<string, number> {
    try {
        if (!fs.existsSync(filePath)) {
            return new Map();
        }
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const map = new Map<string, number>();
        for (const [key, value] of Object.entries(raw || {})) {
            if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key) && Number.isFinite(Number(value))) {
                map.set(key, Number(value));
            }
        }
        return map;
    } catch {
        return new Map();
    }
}

function walkParsedInstructions(
    instructions: any[] | undefined,
    creatorAddress: string,
    counterparties: Set<string>,
    linksToCreators: Set<string>,
    rugCreators: Set<string>,
): {
    solInTransfers: number;
    solOutTransfers: number;
    solInSol: number;
    solOutSol: number;
    inboundSources: string[];
    inboundTransfers: Array<{ source: string; sol: number }>;
    outboundDestinations: string[];
    outboundTransfers: Array<{ destination: string; sol: number }>;
} {
    let solInTransfers = 0;
    let solOutTransfers = 0;
    let solInSol = 0;
    let solOutSol = 0;
    const inboundSources: string[] = [];
    const inboundTransfers: Array<{ source: string; sol: number }> = [];
    const outboundDestinations: string[] = [];
    const outboundTransfers: Array<{ destination: string; sol: number }> = [];

    for (const ix of instructions || []) {
        if (!ix?.parsed) continue;

        if (ix.program === "system" && ix.parsed.type === "transfer") {
            const info = ix.parsed.info || {};
            const source = info.source;
            const destination = info.destination;
            const lamports = Number(info.lamports || 0);

            if (source === creatorAddress) {
                solOutTransfers += 1;
                solOutSol += lamports / 1e9;
                if (destination) {
                    counterparties.add(destination);
                    outboundDestinations.push(destination);
                    outboundTransfers.push({ destination, sol: lamports / 1e9 });
                    if (rugCreators.has(destination)) linksToCreators.add(destination);
                }
            }

            if (destination === creatorAddress) {
                solInTransfers += 1;
                solInSol += lamports / 1e9;
                if (source) {
                    counterparties.add(source);
                    inboundSources.push(source);
                    inboundTransfers.push({ source, sol: lamports / 1e9 });
                    if (rugCreators.has(source)) linksToCreators.add(source);
                }
            }
        }
    }

    return { solInTransfers, solOutTransfers, solInSol, solOutSol, inboundSources, inboundTransfers, outboundDestinations, outboundTransfers };
}

async function buildRugHistory(connection: Connection): Promise<RugHistory> {
    const now = Date.now();
    if (cachedRugHistory && now - cachedRugHistoryAtMs < CONFIG.RUG_HISTORY_CACHE_TTL_MS) {
        return cachedRugHistory;
    }

    const rugCreators = readBlacklistSet(BLACKLIST_CREATORS_PATH);
    const rugFunders = readBlacklistSet(BLACKLIST_FUNDERS_PATH);
    const rugMicroBurstSources = readBlacklistSet(BLACKLIST_MICRO_BURST_SOURCES_PATH);
    const rugCashoutRelays = readBlacklistSet(BLACKLIST_CASHOUT_RELAYS_PATH);
    const rugFunderCounts = readBlacklistCountMap(BLACKLIST_FUNDER_COUNTS_PATH);

    cachedRugHistory = { rugCreators, rugFunders, rugMicroBurstSources, rugCashoutRelays, rugFunderCounts };
    cachedRugHistoryAtMs = now;
    return cachedRugHistory;
}

function trackRecentFunderCreator(funder: string, creatorAddress: string): number {
    const now = Date.now();
    const windowMs = Math.max(1, CONFIG.CREATOR_RISK_FUNDER_CLUSTER_WINDOW_SEC) * 1000;
    const entries = (recentFunderCreators.get(funder) || [])
        .filter((entry) => now - entry.seenAtMs <= windowMs);

    if (!entries.some((entry) => entry.creator === creatorAddress)) {
        entries.push({ creator: creatorAddress, seenAtMs: now });
    }

    recentFunderCreators.set(funder, entries);
    return entries.length;
}

async function classifyCreatorCashoutRisk(
    connection: Connection,
    creatorAddress: string,
    funder: string | null,
    outboundTransfers: Array<{ destination: string; sol: number }>,
    entrySolLiquidity?: number,
): Promise<{ totalSol: number; maxSingleSol: number; pctOfEntryLiquidity: number; score: number; destination: string | null }> {
    if (!outboundTransfers.length) {
        return { totalSol: 0, maxSingleSol: 0, pctOfEntryLiquidity: 0, score: 0, destination: null };
    }

    const merged = new Map<string, number>();
    for (const transfer of outboundTransfers) {
        if (!transfer.destination || transfer.destination === creatorAddress) continue;
        merged.set(transfer.destination, (merged.get(transfer.destination) || 0) + transfer.sol);
    }

    const ranked = [...merged.entries()]
        .filter(([destination]) => destination !== funder)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

    if (!ranked.length) {
        return { totalSol: 0, maxSingleSol: 0, pctOfEntryLiquidity: 0, score: 0, destination: null };
    }

    const infos = await Promise.all(
        ranked.map(async ([destination]) => {
            try {
                return await connection.getAccountInfo(new PublicKey(destination), "confirmed");
            } catch {
                return null;
            }
        })
    );

    let totalSol = 0;
    let maxSingleSol = 0;
    let destination: string | null = null;

    for (let i = 0; i < ranked.length; i++) {
        const [dest, sol] = ranked[i];
        const owner = infos[i]?.owner;
        const isTokenProgram =
            !!owner &&
            (owner.equals(TOKEN_PROGRAM_ID) || owner.equals(TOKEN_2022_PROGRAM_ID));
        if (isTokenProgram) continue;

        totalSol += sol;
        if (sol > maxSingleSol) {
            maxSingleSol = sol;
            destination = dest;
        }
    }

    const pctOfEntryLiquidity =
        entrySolLiquidity && entrySolLiquidity > 0 ? (totalSol / entrySolLiquidity) * 100 : 0;
    const absScore = totalSol / Math.max(0.000001, CONFIG.CREATOR_RISK_CASHOUT_ABS_SOL);
    const relScore =
        entrySolLiquidity && entrySolLiquidity > 0
            ? pctOfEntryLiquidity / Math.max(0.000001, CONFIG.CREATOR_RISK_CASHOUT_REL_LIQ_PCT)
            : 0;
    const singleScore = maxSingleSol / Math.max(0.000001, CONFIG.CREATOR_RISK_CASHOUT_ABS_SOL * 0.6);
    const score = Math.max(absScore, relScore, singleScore);

    return { totalSol, maxSingleSol, pctOfEntryLiquidity, score, destination };
}

async function classifyRecentRelayFunding(
    connection: Connection,
    creatorAddress: string,
    funder: string | null,
): Promise<{ detected: boolean; root: string | null; inboundSol: number; outboundSol: number; windowSec: number | null }> {
    if (!CONFIG.CREATOR_RISK_RELAY_FUNDING_ENABLED || !funder) {
        return { detected: false, root: null, inboundSol: 0, outboundSol: 0, windowSec: null };
    }

    try {
        const sigs = await connection.getSignaturesForAddress(
            new PublicKey(funder),
            { limit: Math.max(3, CONFIG.CREATOR_RISK_RELAY_SIG_LIMIT) },
            "confirmed",
        );
        const chronological = [...sigs].reverse().slice(-Math.max(2, CONFIG.CREATOR_RISK_RELAY_PARSED_TX_LIMIT));

        let maxInboundSol = 0;
        let root: string | null = null;
        let maxOutboundToCreatorSol = 0;
        let firstSeen: number | null = null;
        let lastSeen: number | null = null;

        for (const sig of chronological) {
            const tx = await connection.getParsedTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            });
            if (!tx) continue;

            const counterparties = new Set<string>();
            const links = new Set<string>();
            const walked = walkParsedInstructions(
                tx.transaction?.message?.instructions,
                funder,
                counterparties,
                links,
                new Set<string>(),
            );
            const innerParts = (tx.meta?.innerInstructions || []).map((inner: any) =>
                walkParsedInstructions(inner.instructions, funder, counterparties, links, new Set<string>())
            );

            const allInbound = [
                ...walked.inboundTransfers,
                ...innerParts.flatMap((p) => p.inboundTransfers),
            ];
            const allOutbound = [
                ...walked.outboundTransfers,
                ...innerParts.flatMap((p) => p.outboundTransfers),
            ];

            for (const inbound of allInbound) {
                if (inbound.source === creatorAddress) continue;
                if (inbound.sol > maxInboundSol) {
                    maxInboundSol = inbound.sol;
                    root = inbound.source;
                }
            }

            const outboundToCreatorSol = allOutbound
                .filter((outbound) => outbound.destination === creatorAddress)
                .reduce((sum, outbound) => sum + outbound.sol, 0);
            maxOutboundToCreatorSol = Math.max(maxOutboundToCreatorSol, outboundToCreatorSol);

            if ((allInbound.length > 0 || outboundToCreatorSol > 0) && sig.blockTime) {
                firstSeen = firstSeen === null ? sig.blockTime : Math.min(firstSeen, sig.blockTime);
                lastSeen = lastSeen === null ? sig.blockTime : Math.max(lastSeen, sig.blockTime);
            }
        }

        const windowSec =
            firstSeen !== null && lastSeen !== null && lastSeen >= firstSeen ? lastSeen - firstSeen : null;
        const ratio = maxOutboundToCreatorSol / Math.max(0.000001, maxInboundSol);
        const detected =
            maxInboundSol >= CONFIG.CREATOR_RISK_RELAY_MIN_SOL &&
            maxOutboundToCreatorSol >= CONFIG.CREATOR_RISK_RELAY_MIN_SOL &&
            ratio >= CONFIG.CREATOR_RISK_RELAY_FORWARD_MIN_RATIO &&
            windowSec !== null &&
            windowSec <= CONFIG.CREATOR_RISK_RELAY_WINDOW_SEC;

        return { detected, root, inboundSol: maxInboundSol, outboundSol: maxOutboundToCreatorSol, windowSec };
    } catch {
        return { detected: false, root: null, inboundSol: 0, outboundSol: 0, windowSec: null };
    }
}

function isStandardRelayRiskPool(entrySolLiquidity?: number): boolean {
    if (
        !CONFIG.CREATOR_RISK_STANDARD_POOL_RELAY_BLOCK_ENABLED ||
        !entrySolLiquidity ||
        !Number.isFinite(entrySolLiquidity) ||
        entrySolLiquidity <= 0
    ) {
        return false;
    }

    return CONFIG.CREATOR_RISK_STANDARD_POOL_LEVELS_SOL.some(
        (level) => Math.abs(entrySolLiquidity - level) <= CONFIG.CREATOR_RISK_STANDARD_POOL_TOLERANCE_SOL
    );
}

function isSuspiciousRelayRoot(root: string | null | undefined, rugHistory: RugHistory): boolean {
    if (!root) return false;
    return (
        rugHistory.rugFunders.has(root) ||
        rugHistory.rugCashoutRelays.has(root) ||
        rugHistory.rugMicroBurstSources.has(root)
    );
}

function instructionProgramIdMatches(ix: any, expectedProgramId: string): boolean {
    const raw = ix?.programId;
    const programId =
        typeof raw === "string"
            ? raw
            : raw?.toBase58?.() || "";
    return programId === expectedProgramId;
}

async function detectCreatorDirectAmmReentry(
    connection: Connection,
    creatorAddress: string,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
): Promise<{ detected: boolean; signature: string | null; blockTime: number | null }> {
    if (!CONFIG.CREATOR_RISK_DIRECT_AMM_REENTRY_ENABLED) {
        return { detected: false, signature: null, blockTime: null };
    }

    try {
        const sigs = await connection.getSignaturesForAddress(
            new PublicKey(creatorAddress),
            { limit: Math.max(3, CONFIG.CREATOR_RISK_DIRECT_AMM_REENTRY_SIG_LIMIT) },
            "confirmed",
        );

        for (const sig of sigs) {
            if (createPoolSignature && sig.signature === createPoolSignature) continue;
            if (
                createPoolBlockTime &&
                sig.blockTime &&
                sig.blockTime < createPoolBlockTime
            ) {
                continue;
            }
            if (
                createPoolBlockTime &&
                sig.blockTime &&
                sig.blockTime - createPoolBlockTime > CONFIG.CREATOR_RISK_DIRECT_AMM_REENTRY_WINDOW_SEC
            ) {
                continue;
            }

            const tx = await connection.getParsedTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            });
            if (!tx) continue;

            const hasOuterAmm = (tx.transaction?.message?.instructions || []).some((ix: any) => {
                return instructionProgramIdMatches(ix, PUMPFUN_AMM_PROGRAM_ID);
            });
            const hasInnerAmm = (tx.meta?.innerInstructions || []).some((inner: any) =>
                (inner.instructions || []).some((ix: any) => {
                    return instructionProgramIdMatches(ix, PUMPFUN_AMM_PROGRAM_ID);
                })
            );

            if (hasOuterAmm || hasInnerAmm) {
                return { detected: true, signature: sig.signature, blockTime: sig.blockTime || null };
            }
        }
    } catch {
        // fail-open
    }

    return { detected: false, signature: null, blockTime: null };
}

async function runCreatorRiskCheck(
    connection: Connection,
    creatorAddress: string,
    ctx: string,
    options: { forceRefresh?: boolean; entrySolLiquidity?: number; createPoolSignature?: string; createPoolBlockTime?: number | null } = {},
): Promise<CreatorRiskResult> {
    if (!CONFIG.CREATOR_RISK_CHECK_ENABLED) {
        stageLog(ctx, "CRISK", "check disabled");
        return { ok: true };
    }

    const cached = creatorRiskCache.get(creatorAddress);
    if (!options.forceRefresh && cached && Date.now() - cached.checkedAtMs < CONFIG.CREATOR_RISK_CACHE_TTL_MS) {
        return cached.result;
    }

    try {
        const rugHistory = await buildRugHistory(connection);

        if (rugHistory.rugCreators.has(creatorAddress)) {
            const result = { ok: false, reason: "creator in historical rug blacklist" };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        const sigLimit = Math.max(5, CONFIG.CREATOR_RISK_SIG_LIMIT);
        const parseLimit = Math.max(3, CONFIG.CREATOR_RISK_PARSED_TX_LIMIT);
        const sigs = await connection.getSignaturesForAddress(new PublicKey(creatorAddress), { limit: sigLimit }, "confirmed");
        const chronological = [...sigs].reverse();
        const sample = chronological.slice(-parseLimit);

        let solInTransfers = 0;
        let solOutTransfers = 0;
        let solInSol = 0;
        let solOutSol = 0;
        let funder: string | null = null;
        let funderRefundSol = 0;
        const counterparties = new Set<string>();
        const linksToCreators = new Set<string>();
        const outboundTransfers: Array<{ destination: string; sol: number }> = [];
        const inboundTransfers: Array<{ source: string; sol: number }> = [];

        for (const sig of sample) {
            const tx = await connection.getParsedTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            });
            if (!tx) continue;

            const outer = walkParsedInstructions(
                tx.transaction?.message?.instructions,
                creatorAddress,
                counterparties,
                linksToCreators,
                rugHistory.rugCreators,
            );
            const innerParts = (tx.meta?.innerInstructions || []).map((inner: any) =>
                walkParsedInstructions(inner.instructions, creatorAddress, counterparties, linksToCreators, rugHistory.rugCreators)
            );

            solInTransfers += outer.solInTransfers;
            solOutTransfers += outer.solOutTransfers;
            solInSol += outer.solInSol;
            solOutSol += outer.solOutSol;
            inboundTransfers.push(...outer.inboundTransfers);

            for (const inner of innerParts) {
                solInTransfers += inner.solInTransfers;
                solOutTransfers += inner.solOutTransfers;
                solInSol += inner.solInSol;
                solOutSol += inner.solOutSol;
                inboundTransfers.push(...inner.inboundTransfers);
                outboundTransfers.push(...inner.outboundTransfers);
            }
            outboundTransfers.push(...outer.outboundTransfers);

            if (!funder) {
                funder = outer.inboundSources[0] || innerParts.flatMap(p => p.inboundSources)[0] || null;
            }

            if (funder) {
                const outerRefunds = outer.outboundDestinations.filter((d) => d === funder).length > 0 ? outer.solOutSol : 0;
                const innerRefunds = innerParts
                    .filter((p) => p.outboundDestinations.filter((d) => d === funder).length > 0)
                    .reduce((sum, p) => sum + p.solOutSol, 0);
                funderRefundSol += outerRefunds + innerRefunds;
            }
        }

        const uniqueCounterparties = counterparties.size;
        const firstSigTime = sample[0]?.blockTime || null;
        const lastSigTime = sample[sample.length - 1]?.blockTime || null;
        const compressedWindowSec =
            firstSigTime && lastSigTime && lastSigTime >= firstSigTime
                ? lastSigTime - firstSigTime
                : null;
        const microInboundTransfers = inboundTransfers.filter(
            (transfer) => transfer.sol > 0 && transfer.sol <= CONFIG.CREATOR_RISK_MICRO_INBOUND_MAX_SOL
        );
        const microInboundSources = new Set(microInboundTransfers.map((transfer) => transfer.source));
        const burner =
            solInTransfers === 0 &&
            solOutTransfers > 0 &&
            solOutTransfers <= 3 &&
            solOutSol >= CONFIG.CREATOR_RISK_BURNER_MIN_OUT_SOL;
        const creatorCashout = await classifyCreatorCashoutRisk(
            connection,
            creatorAddress,
            funder,
            outboundTransfers,
            options.entrySolLiquidity,
        );
        const relayFunding = await classifyRecentRelayFunding(connection, creatorAddress, funder);
        const directAmmReentry = await detectCreatorDirectAmmReentry(
            connection,
            creatorAddress,
            options.createPoolSignature,
            options.createPoolBlockTime,
        );

        stageLog(
            ctx,
            "CRISK",
            `cp=${uniqueCounterparties} in=${solInTransfers} out=${solOutTransfers} ` +
            `window=${compressedWindowSec ?? "n/a"}s funder=${funder ? shortSig(funder) : "-"} refund=${funderRefundSol.toFixed(3)} ` +
            `micro=${microInboundTransfers.length}/${microInboundSources.size}`
        );
        if (relayFunding.detected || relayFunding.inboundSol > 0 || relayFunding.outboundSol > 0) {
            stageLog(
                ctx,
                "RRELAY",
                `root=${relayFunding.root ? shortSig(relayFunding.root) : "-"} funder=${funder ? shortSig(funder) : "-"} ` +
                `in=${relayFunding.inboundSol.toFixed(3)} out=${relayFunding.outboundSol.toFixed(3)} ` +
                `window=${relayFunding.windowSec ?? "n/a"}s`
            );
        }
        if (creatorCashout.totalSol > 0 || creatorCashout.score >= CONFIG.CREATOR_RISK_CASHOUT_WARN_SCORE) {
            stageLog(
                ctx,
                "CCASH",
                `total=${creatorCashout.totalSol.toFixed(3)} max=${creatorCashout.maxSingleSol.toFixed(3)} ` +
                `rel=${creatorCashout.pctOfEntryLiquidity.toFixed(2)}% score=${creatorCashout.score.toFixed(2)} ` +
                `dest=${creatorCashout.destination ? shortSig(creatorCashout.destination) : "-"}`
            );
        }
        if (directAmmReentry.detected) {
            stageLog(
                ctx,
                "CAMM",
                `creator direct ${shortSig(PUMPFUN_AMM_PROGRAM_ID)} re-entry via ${shortSig(directAmmReentry.signature || "-")}`
            );
        }

        if (funder && (rugHistory.rugCreators.has(funder) || rugHistory.rugFunders.has(funder))) {
            const result = {
                ok: false,
                reason: `funder blacklisted ${funder}`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (
            funder &&
            (rugHistory.rugMicroBurstSources.has(funder) || rugHistory.rugCashoutRelays.has(funder))
        ) {
            const result = {
                ok: false,
                reason: `funder linked to suspicious infra ${funder}`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        const blacklistedMicroSource = [...microInboundSources].find((source) => rugHistory.rugMicroBurstSources.has(source));
        if (blacklistedMicroSource) {
            const result = {
                ok: false,
                reason: `micro-burst source blacklisted ${blacklistedMicroSource}`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (
            compressedWindowSec !== null &&
            compressedWindowSec <= CONFIG.CREATOR_RISK_MICRO_INBOUND_WINDOW_SEC &&
            microInboundTransfers.length >= CONFIG.CREATOR_RISK_MICRO_INBOUND_MIN_TRANSFERS &&
            microInboundSources.size >= CONFIG.CREATOR_RISK_MICRO_INBOUND_MIN_SOURCES
        ) {
            const result = {
                ok: false,
                reason: `micro inbound burst ${microInboundTransfers.length} transfers from ${microInboundSources.size} sources in ${compressedWindowSec}s`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (
            isStandardRelayRiskPool(options.entrySolLiquidity) &&
            CONFIG.CREATOR_RISK_STANDARD_POOL_MICRO_BLOCK_ENABLED &&
            compressedWindowSec !== null &&
            compressedWindowSec <= CONFIG.CREATOR_RISK_MICRO_INBOUND_WINDOW_SEC &&
            microInboundTransfers.length >= CONFIG.CREATOR_RISK_STANDARD_POOL_MICRO_MIN_TRANSFERS &&
            microInboundSources.size >= CONFIG.CREATOR_RISK_STANDARD_POOL_MICRO_MIN_SOURCES
        ) {
            const result = {
                ok: false,
                reason:
                    `standard pool micro burst ${microInboundTransfers.length} transfers ` +
                    `from ${microInboundSources.size} sources in ${compressedWindowSec}s ` +
                    `(${options.entrySolLiquidity?.toFixed(2)} SOL pool)`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (
            CONFIG.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_BLOCK_ENABLED &&
            relayFunding.root &&
            isSuspiciousRelayRoot(relayFunding.root, rugHistory) &&
            uniqueCounterparties >= CONFIG.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MIN_COUNTERPARTIES &&
            solOutTransfers >= CONFIG.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MIN_OUT_TRANSFERS &&
            microInboundTransfers.length <= CONFIG.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MAX_MICRO_TRANSFERS &&
            microInboundSources.size <= CONFIG.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MAX_MICRO_SOURCES
        ) {
            const result = {
                ok: false,
                reason:
                    `suspicious relay-root pattern root=${relayFunding.root} ` +
                    `cp=${uniqueCounterparties} out=${solOutTransfers} ` +
                    `micro=${microInboundTransfers.length}/${microInboundSources.size}`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                relayFundingRoot: relayFunding.root,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (
            options.entrySolLiquidity &&
            CONFIG.HOLD_CREATOR_CASHOUT_EXIT_ENABLED &&
            creatorCashout.score >= CONFIG.CREATOR_RISK_CASHOUT_EXIT_SCORE
        ) {
            const result = {
                ok: false,
                reason: `creator cashout ${creatorCashout.totalSol.toFixed(3)} SOL (${creatorCashout.pctOfEntryLiquidity.toFixed(2)}% liq, score ${creatorCashout.score.toFixed(2)})`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                funderRefundSol,
                creatorCashoutSol: creatorCashout.totalSol,
                creatorCashoutPctOfEntryLiquidity: creatorCashout.pctOfEntryLiquidity,
                creatorCashoutScore: creatorCashout.score,
                creatorCashoutDestination: creatorCashout.destination,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (
            relayFunding.detected &&
            isStandardRelayRiskPool(options.entrySolLiquidity)
        ) {
            const result = {
                ok: false,
                reason: `relay funding recent on standard pool ${options.entrySolLiquidity?.toFixed(2)} SOL (root ${relayFunding.root || "-"}, in ${relayFunding.inboundSol.toFixed(3)} SOL, out ${relayFunding.outboundSol.toFixed(3)} SOL)`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                relayFundingRoot: relayFunding.root,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (
            relayFunding.detected &&
            microInboundTransfers.length >= CONFIG.CREATOR_RISK_MICRO_INBOUND_MIN_TRANSFERS
        ) {
            const result = {
                ok: false,
                reason: `relay funding recent + micro burst (root ${relayFunding.root || "-"}, in ${relayFunding.inboundSol.toFixed(3)} SOL, out ${relayFunding.outboundSol.toFixed(3)} SOL)`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                relayFundingRoot: relayFunding.root,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (directAmmReentry.detected) {
            const result = {
                ok: false,
                reason: `creator direct AMM re-entry ${directAmmReentry.signature}`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                relayFundingRoot: relayFunding.root,
                directAmmReentrySig: directAmmReentry.signature,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (
            relayFunding.detected &&
            relayFunding.root &&
            (rugHistory.rugFunders.has(relayFunding.root) || rugHistory.rugCashoutRelays.has(relayFunding.root))
        ) {
            const result = {
                ok: false,
                reason: `relay funding root blacklisted ${relayFunding.root}`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                relayFundingRoot: relayFunding.root,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (funder && CONFIG.CREATOR_RISK_FUNDER_CLUSTER_ENABLED) {
            const historicalCount = rugHistory.rugFunderCounts.get(funder) || 0;
            if (historicalCount >= CONFIG.CREATOR_RISK_HISTORICAL_FUNDER_CLUSTER_MIN_RUG_CREATORS) {
                const result = {
                    ok: false,
                    reason: `funder cluster historical ${historicalCount} rug creators`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                };
                creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
                return result;
            }

            const recentCreatorCount = trackRecentFunderCreator(funder, creatorAddress);
            if (recentCreatorCount >= CONFIG.CREATOR_RISK_FUNDER_CLUSTER_MIN_CREATORS) {
                const result = {
                    ok: false,
                    reason: `funder cluster recent ${recentCreatorCount} creators in ${CONFIG.CREATOR_RISK_FUNDER_CLUSTER_WINDOW_SEC}s`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                };
                creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
                return result;
            }
        }

        if (linksToCreators.size > 0) {
            const linked = Array.from(linksToCreators)[0];
            const result = {
                ok: false,
                reason: `linked to historical rug creator ${linked}`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (funder && funderRefundSol >= CONFIG.CREATOR_RISK_FUNDER_REFUND_MIN_SOL) {
            const result = {
                ok: false,
                reason: `creator refunded funder ${funderRefundSol.toFixed(3)} SOL`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                funderRefundSol,
                creatorCashoutSol: creatorCashout.totalSol,
                creatorCashoutPctOfEntryLiquidity: creatorCashout.pctOfEntryLiquidity,
                creatorCashoutScore: creatorCashout.score,
                creatorCashoutDestination: creatorCashout.destination,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (uniqueCounterparties >= CONFIG.CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES) {
            const result = {
                ok: false,
                reason: `unique counterparties ${uniqueCounterparties} >= ${CONFIG.CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES}`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (
            compressedWindowSec !== null &&
            compressedWindowSec <= CONFIG.CREATOR_RISK_COMPRESSED_WINDOW_SEC &&
            uniqueCounterparties >= CONFIG.CREATOR_RISK_COMPRESSED_MAX_COUNTERPARTIES
        ) {
            const result = {
                ok: false,
                reason: `compressed activity ${uniqueCounterparties} counterparties in ${compressedWindowSec}s`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (burner) {
            const result = {
                ok: false,
                reason: `burner profile out=${solOutSol.toFixed(2)} SOL with no inbound transfers`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        const result = {
            ok: true,
            funder,
            uniqueCounterparties,
            compressedWindowSec,
            burner,
            funderRefundSol,
            creatorCashoutSol: creatorCashout.totalSol,
            creatorCashoutPctOfEntryLiquidity: creatorCashout.pctOfEntryLiquidity,
            creatorCashoutScore: creatorCashout.score,
            creatorCashoutDestination: creatorCashout.destination,
            relayFundingRoot: relayFunding.root,
            directAmmReentrySig: directAmmReentry.signature,
        };
        creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
        return result;
    } catch (e: any) {
        const result = { ok: false, reason: e?.message || "creator risk check failed" };
        creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
        return result;
    }
}

async function getCreatorTokenBalanceRawWithRetry(
    connection: Connection,
    creatorAddress: string,
    tokenMint: string,
    postTokenBalances: any[],
): Promise<bigint> {
    const maxAttempts = Math.max(1, CONFIG.DEV_HOLDINGS_MAX_ATTEMPTS);
    const retryDelayMs = Math.max(0, CONFIG.DEV_HOLDINGS_RETRY_DELAY_MS);
    const maxDurationMs = Math.max(250, CONFIG.DEV_HOLDINGS_MAX_DURATION_MS);
    const startedAt = Date.now();
    let lastBalance = 0n;

    for (let i = 0; i < maxAttempts; i++) {
        if (Date.now() - startedAt > maxDurationMs) {
            throw new Error(`dev holdings check timed out after ${Date.now() - startedAt}ms`);
        }
        const bal = await getCreatorTokenBalanceRaw(connection, creatorAddress, tokenMint, postTokenBalances);
        lastBalance = bal;
        if (bal > 0n) return bal;
        if (i < maxAttempts - 1) {
            await new Promise(r => setTimeout(r, retryDelayMs));
        }
    }

    return lastBalance;
}

async function runDevHoldingsCheck(
    connection: Connection,
    creatorAddress: string,
    tokenMint: string,
    postTokenBalances: any[],
    ctx: string,
    enforceGate: boolean,
): Promise<boolean> {
    if (!CONFIG.ENFORCE_DEV_HOLDINGS_CHECK) {
        stageLog(ctx, "DEV", "holdings check disabled");
        return true;
    }

    const devCheckStart = Date.now();
    try {
        const creatorBalanceRaw = await getCreatorTokenBalanceRawWithRetry(connection, creatorAddress, tokenMint, postTokenBalances);
        const mintInfo = await getMintInfoRobust(connection, new PublicKey(tokenMint));
        const totalSupplyRaw = 1_000_000_000n * (10n ** BigInt(mintInfo.decimals)); // Pump tokens are 1B supply

        const devPct = Number((creatorBalanceRaw * 10000n) / totalSupplyRaw) / 100;
        stageLog(ctx, "DEV", `holding ${creatorBalanceRaw.toString()} (${devPct.toFixed(2)}%)`);
        if (creatorBalanceRaw < 1n) {
            stageLog(ctx, "DEV", "creator wallet token balance is 0 after create_pool (can be normal)");
        }
        stageLog(ctx, "DEV", `check duration ${Date.now() - devCheckStart}ms`);

        if (devPct > CONFIG.MAX_DEV_HOLDINGS_PCT) {
            if (enforceGate) {
                console.log(`🛑 SKIP: Dev holds too much (${devPct.toFixed(1)}% > ${CONFIG.MAX_DEV_HOLDINGS_PCT}%)`);
                return false;
            }
        console.log(`⚠️ Dev holds too much (${devPct.toFixed(1)}% > ${CONFIG.MAX_DEV_HOLDINGS_PCT}%)`);
        }
        return true;
    } catch (e: any) {
        const reason = e?.message || String(e);
        const durationMs = Date.now() - devCheckStart;
        if (MONITOR_ONLY && !enforceGate) {
            console.log(`⚠️ Dev check failed after ${durationMs}ms: ${reason}`);
            stageLog(ctx, "DEV", "check fail-open in MONITOR_ONLY");
            return true;
        }
        console.log(`🛑 SKIP: Dev check failed after ${durationMs}ms: ${reason}`);
        return false;
    }
}

async function getSolPriceUsd(): Promise<number | null> {
    const now = Date.now();
    if (cachedSolPriceUsd && now - cachedSolPriceAtMs < CONFIG.SOL_PRICE_CACHE_TTL_MS) {
        return cachedSolPriceUsd;
    }

    try {
        // Jupiter price API: fast and sufficient for runtime filtering.
        const res = await fetch("https://price.jup.ag/v4/price?ids=SOL");
        if (res.ok) {
            const json: any = await res.json();
            const p = json?.data?.SOL?.price;
            if (typeof p === "number" && Number.isFinite(p) && p > 0) {
                cachedSolPriceUsd = p;
                cachedSolPriceAtMs = now;
                return p;
            }
        }
    } catch {
        // fall through to fallback
    }

    return null;
}

async function getCreatorTokenBalanceRaw(
    connection: Connection,
    creatorAddress: string,
    tokenMint: string,
    postTokenBalances: any[],
): Promise<bigint> {
    // Fast path: use the current tx metadata if present.
    const creatorBalanceEntry = postTokenBalances.find((b: any) =>
        b.mint === tokenMint && b.owner === creatorAddress
    );
    if (creatorBalanceEntry?.uiTokenAmount?.amount) {
        return BigInt(creatorBalanceEntry.uiTokenAmount.amount);
    }

    // Fallback: query creator token accounts by program (Token + Token-2022),
    // then filter by mint locally. This is more robust right after create_pool.
    const owner = new PublicKey(creatorAddress);
    const [tokenAccs, token2022Accs] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed")
            .catch(() => ({ value: [] as any[] })),
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed")
            .catch(() => ({ value: [] as any[] })),
    ]);

    let total = 0n;
    const all = [
        ...tokenAccs.value.filter((acc: any) => {
            const accMint = acc.account.data.parsed?.info?.mint;
            return accMint === tokenMint;
        }),
        ...token2022Accs.value.filter((acc: any) => {
            const accMint = acc.account.data.parsed?.info?.mint;
            return accMint === tokenMint;
        }),
    ];
    for (const acc of all) {
        const amount = acc.account.data.parsed?.info?.tokenAmount?.amount;
        if (amount) total += BigInt(amount);
    }
    return total;
}

type PaperTradeResult = { ok: boolean; reason?: string };

async function maybeRunPaperTradeSimulation(
    connection: Connection,
    poolAddress: string,
    tokenMint: string,
    ctx = "",
    creatorAddress?: string,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
): Promise<PaperTradeResult> {
    if (!CONFIG.PAPER_TRADE_ENABLED) return { ok: true };

    const observerUser = walletKeypair?.publicKey ?? Keypair.generate().publicKey;
    const poolKey = new PublicKey(poolAddress);
    const buyAmountLamports = new BN(Math.floor(CONFIG.TRADE_AMOUNT_SOL * 1e9));

    const fetchStateWithRetry = async () => {
        for (let i = 0; i < 12; i++) {
            try {
                const state = await onlineSdk.swapSolanaState(poolKey, observerUser);
                if (state.poolBaseAmount.gt(new BN(0)) && state.poolQuoteAmount.gt(new BN(0))) return state;
            } catch {
                // wait and retry
            }
            await new Promise(r => setTimeout(r, 250));
        }
        return null;
    };

    try {
        stageLog(ctx, "PAPER", "simulate buy->sell");
        let tokenDecimals = 6;
        try {
            tokenDecimals = (await getMintInfoRobust(connection, new PublicKey(tokenMint))).decimals;
        } catch {
            // fallback to common pump token decimals
        }

        const entryState = await fetchStateWithRetry();
        if (!entryState) {
            console.log(`⚠️ PAPER_TRADE: no entry pool state`);
            return { ok: false, reason: "entry state unavailable" };
        }

        const orientation = getPoolOrientation(entryState, tokenMint);
        if (!orientation.hasWsol) {
            return { ok: false, reason: "pool has no WSOL side" };
        }

        let tokenOutAtomic: BN;
        if (orientation.solIsBase) {
            const entry = sellBaseInput({
                base: buyAmountLamports,
                slippage: CONFIG.SLIPPAGE_PERCENT,
                baseReserve: entryState.poolBaseAmount,
                quoteReserve: entryState.poolQuoteAmount,
                baseMintAccount: entryState.baseMintAccount,
                baseMint: entryState.baseMint,
                coinCreator: entryState.pool.coinCreator,
                creator: entryState.pool.creator,
                feeConfig: entryState.feeConfig,
                globalConfig: entryState.globalConfig,
            });
            tokenOutAtomic = entry.uiQuote;
        } else {
            const entry = buyQuoteInput({
                quote: buyAmountLamports,
                slippage: CONFIG.SLIPPAGE_PERCENT,
                baseReserve: entryState.poolBaseAmount,
                quoteReserve: entryState.poolQuoteAmount,
                baseMintAccount: entryState.baseMintAccount,
                baseMint: entryState.baseMint,
                coinCreator: entryState.pool.coinCreator,
                creator: entryState.pool.creator,
                feeConfig: entryState.feeConfig,
                globalConfig: entryState.globalConfig,
            });
            tokenOutAtomic = entry.base;
        }
        const tokenOutUi = Number(tokenOutAtomic.toString()) / 10 ** tokenDecimals;
        if (tokenOutAtomic.lte(new BN(0))) {
            console.log(`⚠️ PAPER_TRADE: entry received 0 tokens`);
            return { ok: false, reason: "entry produced 0 tokens" };
        }
        const entrySpotSolPerToken = getSpotSolPerTokenFromState(entryState, tokenMint, tokenDecimals) || 0;
        stageLog(ctx, "BUY_SPOT", `~${formatSolCompact(entrySpotSolPerToken)}/token`);

        const exitState = await waitForExitStateWithLiquidityStop(
            connection,
            poolAddress,
            fetchStateWithRetry,
            entryState,
            tokenMint,
            tokenDecimals,
            ctx,
            creatorAddress,
            createPoolSignature,
            createPoolBlockTime,
        );
        if (!exitState) {
            console.log(`⚠️ PAPER_TRADE: no exit pool state`);
            return { ok: false, reason: "exit state unavailable" };
        }

        let solOut: number;
        if (orientation.solIsBase) {
            const exit = buyQuoteInput({
                quote: tokenOutAtomic,
                slippage: CONFIG.SLIPPAGE_PERCENT,
                baseReserve: exitState.poolBaseAmount,
                quoteReserve: exitState.poolQuoteAmount,
                baseMintAccount: exitState.baseMintAccount,
                baseMint: exitState.baseMint,
                coinCreator: exitState.pool.coinCreator,
                creator: exitState.pool.creator,
                feeConfig: exitState.feeConfig,
                globalConfig: exitState.globalConfig,
            });
            solOut = Number(exit.base.toString()) / 1e9;
        } else {
            const exit = sellBaseInput({
                base: tokenOutAtomic,
                slippage: CONFIG.SLIPPAGE_PERCENT,
                baseReserve: exitState.poolBaseAmount,
                quoteReserve: exitState.poolQuoteAmount,
                baseMintAccount: exitState.baseMintAccount,
                baseMint: exitState.baseMint,
                coinCreator: exitState.pool.coinCreator,
                creator: exitState.pool.creator,
                feeConfig: exitState.feeConfig,
                globalConfig: exitState.globalConfig,
            });
            solOut = Number(exit.uiQuote.toString()) / 1e9;
        }
        const exitSpotSolPerToken = getSpotSolPerTokenFromState(exitState, tokenMint, tokenDecimals) || 0;
        const exitSolLiquidity = getSolLiquidityFromState(exitState, tokenMint) || 0;

        if (!Number.isFinite(solOut) || solOut <= 0) {
            return { ok: false, reason: "exit returned 0 SOL" };
        }
        if (
            Number.isFinite(exitSolLiquidity) &&
            exitSolLiquidity > 0 &&
            solOut > exitSolLiquidity * 1.001
        ) {
            console.log(
                `⚠️ PAPER_TRADE invalid exit quote: ` +
                `${solOut.toFixed(6)} SOL exceeds exit liquidity ${exitSolLiquidity.toFixed(6)} SOL`
            );
            return { ok: false, reason: "exit quote exceeded pool liquidity" };
        }

        const pnlSol = solOut - CONFIG.TRADE_AMOUNT_SOL;
        const pnlPct = (pnlSol / CONFIG.TRADE_AMOUNT_SOL) * 100;

        stageLog(ctx, "SELL_SPOT", `~${formatSolCompact(exitSpotSolPerToken)}/token`);
        stageLog(ctx, "PNL", `${pnlSol >= 0 ? "+" : "-"}${formatSolDecimal(Math.abs(pnlSol))} (${pnlPct.toFixed(2)}%)`);
        if (pnlPct <= -Math.abs(CONFIG.PAPER_TRADE_MAX_LOSS_PCT)) {
            return { ok: false, reason: `pnl ${pnlPct.toFixed(2)}% <= -${Math.abs(CONFIG.PAPER_TRADE_MAX_LOSS_PCT)}%` };
        }
        return { ok: true };
    } catch (e: any) {
        console.log(`⚠️ PAPER_TRADE failed: ${e.message}`);
        return { ok: false, reason: e?.message || "paper simulation failed" };
    }
}

async function waitForExitStateWithLiquidityStop(
    connection: Connection,
    _poolAddress: string,
    fetchStateWithRetry: () => Promise<any | null>,
    entryState: any,
    tokenMint: string,
    tokenDecimals: number,
    logPrefix: string,
    creatorAddress?: string,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
): Promise<any | null> {
    const startedAtMs = Date.now();
    const deadlineMs = startedAtMs + CONFIG.AUTO_SELL_DELAY_MS;
    const entrySpot = getSpotSolPerTokenFromState(entryState, tokenMint, tokenDecimals) || 0;
    const entrySolLiquidity = getSolLiquidityFromState(entryState, tokenMint) || 0;
    const dropFactor = 1 - (Math.abs(CONFIG.LIQUIDITY_STOP_DROP_PCT) / 100);
    const stabilityDropFactor = 1 - (Math.abs(CONFIG.POST_ENTRY_STABILITY_GATE_DROP_PCT) / 100);
    const liqStopSpotThreshold =
        Number.isFinite(entrySpot) && entrySpot > 0 ? entrySpot * dropFactor : 0;
    const liqStopLiquidityThreshold =
        Number.isFinite(entrySolLiquidity) && entrySolLiquidity > 0 ? entrySolLiquidity * dropFactor : 0;
    let latestState: any | null = entryState;
    let lastCreatorRiskCheckAtMs = 0;
    while (Date.now() < deadlineMs) {
        await new Promise(r => setTimeout(r, CONFIG.LIQUIDITY_STOP_CHECK_INTERVAL_MS));
        const s = await fetchStateWithRetry();
        if (!s) continue;
        latestState = s;

        if (
            creatorAddress &&
            CONFIG.HOLD_CREATOR_RISK_RECHECK_ENABLED &&
            Date.now() - lastCreatorRiskCheckAtMs >= Math.max(500, CONFIG.HOLD_CREATOR_RISK_RECHECK_INTERVAL_MS)
        ) {
            lastCreatorRiskCheckAtMs = Date.now();
            const creatorRisk = await runCreatorRiskCheck(connection, creatorAddress, logPrefix, {
                forceRefresh: true,
                entrySolLiquidity,
                createPoolSignature,
                createPoolBlockTime,
            });
            if (!creatorRisk.ok) {
                console.log(`⚠️ CREATOR RISK EXIT: ${creatorRisk.reason}`);
                return s;
            }
        }

        const curSpot = getSpotSolPerTokenFromState(s, tokenMint, tokenDecimals) || 0;
        const curSolLiquidity = getSolLiquidityFromState(s, tokenMint) || 0;
        const inStabilityWindow =
            CONFIG.POST_ENTRY_STABILITY_GATE_ENABLED &&
            (Date.now() - startedAtMs) <= Math.max(0, CONFIG.POST_ENTRY_STABILITY_GATE_WINDOW_MS);

        if (inStabilityWindow) {
            const stabilitySpotBreak =
                Number.isFinite(entrySpot) &&
                entrySpot > 0 &&
                Number.isFinite(curSpot) &&
                curSpot > 0 &&
                curSpot <= entrySpot * stabilityDropFactor;

            const stabilityLiquidityBreak =
                Number.isFinite(entrySolLiquidity) &&
                entrySolLiquidity > 0 &&
                Number.isFinite(curSolLiquidity) &&
                curSolLiquidity > 0 &&
                curSolLiquidity <= entrySolLiquidity * stabilityDropFactor;

            if (stabilitySpotBreak || stabilityLiquidityBreak) {
                console.log(
                    `⚠️ STABILITY GATE: early exit ` +
                    `(spot ${formatSolCompact(curSpot)}/token <= ${formatSolCompact(entrySpot * stabilityDropFactor)}/token, ` +
                    `liquidity ${curSolLiquidity.toFixed(2)} SOL <= ${(entrySolLiquidity * stabilityDropFactor).toFixed(2)} SOL, ` +
                    `window ${CONFIG.POST_ENTRY_STABILITY_GATE_WINDOW_MS}ms, drop ${CONFIG.POST_ENTRY_STABILITY_GATE_DROP_PCT}%)`
                );
                return s;
            }
        }

        if (!CONFIG.LIQUIDITY_STOP_ENABLED) continue;

        const spotTriggered =
            Number.isFinite(entrySpot) &&
            entrySpot > 0 &&
            Number.isFinite(curSpot) &&
            curSpot > 0 &&
            curSpot <= entrySpot * dropFactor;

        const liquidityTriggered =
            Number.isFinite(entrySolLiquidity) &&
            entrySolLiquidity > 0 &&
            Number.isFinite(curSolLiquidity) &&
            curSolLiquidity > 0 &&
            curSolLiquidity <= entrySolLiquidity * dropFactor;

        if (spotTriggered || liquidityTriggered) {
            console.log(
                `⚠️ LIQUIDITY STOP: trigger early exit ` +
                `(spot ${formatSolCompact(curSpot)}/token <= ${formatSolCompact(liqStopSpotThreshold)}/token, ` +
                `liquidity ${curSolLiquidity.toFixed(2)} SOL <= ${liqStopLiquidityThreshold.toFixed(2)} SOL, ` +
                `drop ${CONFIG.LIQUIDITY_STOP_DROP_PCT}%)`
            );
            return s;
        }
    }

    return latestState || fetchStateWithRetry();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAFETY CHECK HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function checkTokenSecurity(connection: Connection, mintAddress: string): Promise<boolean> {
    try {
        const mintKey = new PublicKey(mintAddress);
        const mintInfo = await getMintInfoRobust(connection, mintKey);

        if (CONFIG.REQUIRE_RENOUNCED_MINT && mintInfo.mintAuthority !== null) {
            console.log(`   ⚠️ Mint Authority NOT renounced! Owner: ${mintInfo.mintAuthority.toBase58()}`);
            return false;
        }

        if (CONFIG.REQUIRE_NO_FREEZE && mintInfo.freezeAuthority !== null) {
            console.log(`   ⚠️ Freeze Authority ENABLED! Owner: ${mintInfo.freezeAuthority.toBase58()}`);
            return false;
        }

        console.log(`   🛡️ Mint/Freeze Security: PASSED`);
        return true;
    } catch (e: any) {
        const reason = e?.message || String(e);
        console.log(`   ⚠️ Could not verify token security: ${reason}`);
        return false; // Skip if uncertain
    }
}

async function getMintInfoRobust(connection: Connection, mintKey: PublicKey) {
    const maxAttempts = 5;
    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const mintAccount = await connection.getAccountInfo(mintKey, "confirmed");
            if (!mintAccount) {
                throw new Error("mint account not found");
            }

            const owner = mintAccount.owner;
            if (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID)) {
                throw new Error(`unexpected mint owner program: ${owner.toBase58()}`);
            }

            return await getMint(connection, mintKey, "confirmed", owner);
        } catch (e) {
            lastErr = e;
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTE BUY
// ═══════════════════════════════════════════════════════════════════════════════

async function executeBuy(connection: Connection, poolAddress: string, tokenMint: string): Promise<boolean> {
    try {
        if (!walletKeypair) {
            throw new Error("PRIVATE_KEY missing: cannot execute buy in monitor-only mode");
        }

        const poolKey = new PublicKey(poolAddress);
        const user = walletKeypair.publicKey;

        // Get swap state with retry loop (waiting for RPC indexing)
        let swapSolanaState: any = null;
        let attempts = 0;
        const maxAttempts = 20; // 20 attempts (4s)
        
        while (attempts < maxAttempts) {
            try {
                swapSolanaState = await onlineSdk.swapSolanaState(poolKey, user);
                
                // Use correct property names from SDK: poolBaseAmount and poolQuoteAmount
                const baseAmount = swapSolanaState.poolBaseAmount;
                const quoteAmount = swapSolanaState.poolQuoteAmount;
                
                if (baseAmount && quoteAmount) {
                    console.log(`   📊 Pool Reserves -> Base: ${baseAmount.toString()}, Quote: ${quoteAmount.toString()}`);
                    if (baseAmount.gt(new BN(0)) && quoteAmount.gt(new BN(0))) {
                        break; // Valid state found
                    }
                } else {
                    console.log(`   📊 Attempt ${attempts+1}: Waiting for pool data...`);
                }
            } catch (err: any) {
                console.log(`   📊 Attempt ${attempts+1}: ${err.message?.slice(0,50) || 'error'}`);
            }
            attempts++;
            await new Promise(r => setTimeout(r, 200)); // wait 200ms
        }

        // Check if we have valid state
        if (!swapSolanaState || !swapSolanaState.poolBaseAmount || swapSolanaState.poolBaseAmount.eq(new BN(0))) {
            console.log("❌ Failed to fetch valid pool state.");
            return false;
        }

        // Build buy instruction using offline SDK
        const buyAmount = new BN(Math.floor(CONFIG.TRADE_AMOUNT_SOL * 1e9)); // lamports
        const slippagePct = 50; // 50%
        
        // Detect token program
        const tokenMintKey = new PublicKey(tokenMint);
        const mintAccount = await connection.getAccountInfo(tokenMintKey);
        const tokenProgramId = mintAccount?.owner || TOKEN_PROGRAM_ID;
        console.log(`   Token Program: ${tokenProgramId.toBase58() === TOKEN_2022_PROGRAM_ID.toBase58() ? 'Token-2022' : 'Token'}`);

        // Build Buy Transaction
        const buyTx = new Transaction();
        const ata = getAssociatedTokenAddressSync(tokenMintKey, user, false, tokenProgramId);
        
        buyTx.add(createAssociatedTokenAccountIdempotentInstruction(user, ata, user, tokenMintKey, tokenProgramId));
        
        // In Pump.fun AMM, base=SOL e quote=TOKEN
        const buyInstructions: TransactionInstruction[] = await offlineSdk.sellBaseInput(
            swapSolanaState,
            buyAmount,       // Amount of SOL (base) to sell
            slippagePct
        );
        buyInstructions.forEach(ix => buyTx.add(ix));

        const recentBlockhash = await connection.getLatestBlockhash();
        buyTx.recentBlockhash = recentBlockhash.blockhash;
        buyTx.feePayer = user;
        buyTx.sign(walletKeypair);

        const txSignature = await connection.sendRawTransaction(buyTx.serialize(), {
            skipPreflight: true,
            maxRetries: 3
        });

        console.log(`✅ BUY SENT: https://solscan.io/tx/${txSignature}`);
        
        const confirmation = await connection.confirmTransaction(txSignature, "confirmed");
        if (confirmation.value.err) {
            console.log(`❌ Buy failed: ${JSON.stringify(confirmation.value.err)}`);
            return false;
        }

        console.log("🚀 BUY CONFIRMED! Scheduling Auto-Sell...");
        activeLivePositions += 1;
        setTimeout(() => executeSell(connection, poolAddress, tokenMint), CONFIG.AUTO_SELL_DELAY_MS);
        return true;

    } catch (e: any) {
        console.error("❌ Buy Error:", e.message);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTE SELL
// ═══════════════════════════════════════════════════════════════════════════════

async function executeSell(connection: Connection, poolAddress: string, tokenMint: string) {
    console.log(`⏱️ Auto-Sell triggered for ${tokenMint}...`);
    
    try {
        if (!walletKeypair) {
            throw new Error("PRIVATE_KEY missing: cannot execute sell in monitor-only mode");
        }

        const tokenMintKey = new PublicKey(tokenMint);
        const user = walletKeypair.publicKey;
        
        // Detect token program
        const mintAccount = await connection.getAccountInfo(tokenMintKey);
        const tokenProgramId = mintAccount?.owner || TOKEN_PROGRAM_ID;

        // Get Balance
        const ata = getAssociatedTokenAddressSync(tokenMintKey, user, false, tokenProgramId);
        const balanceResponse = await connection.getTokenAccountBalance(ata);
        const tokenBalance = new BN(balanceResponse.value.amount);
        
        if (tokenBalance.isZero()) {
            console.log("❌ No tokens to sell.");
            return;
        }

        console.log(`🚀 Selling ${balanceResponse.value.uiAmount} tokens...`);
        
        const poolKey = new PublicKey(poolAddress);
        const swapSolanaState = await onlineSdk.swapSolanaState(poolKey, user);
        
        // To SELL TOKEN (quote) for SOL (base)
        const sellInstructions: TransactionInstruction[] = await offlineSdk.buyBaseInput(
            swapSolanaState,
            tokenBalance,    // Amount of Token (quote) to spend to buy SOL
            50               // 50% slippage
        );
        
        const recentBlockhash = await connection.getLatestBlockhash();
        const sellTx = new Transaction();
        sellTx.recentBlockhash = recentBlockhash.blockhash;
        sellTx.feePayer = user;
        sellInstructions.forEach(ix => sellTx.add(ix));
        
        // Close Account Instruction (Rent Recovery)
        sellTx.add(createCloseAccountInstruction(ata, user, user, [], tokenProgramId));
        
        sellTx.sign(walletKeypair);
        
        const txSignature = await connection.sendRawTransaction(sellTx.serialize(), {
            skipPreflight: true,
            maxRetries: 3
        });
        
        console.log(`✅ SELL SENT: https://solscan.io/tx/${txSignature}`);
        await connection.confirmTransaction(txSignature, "confirmed");
        console.log("🔓 Position Closed. Resume scanning.");

    } catch (e: any) {
        console.error("❌ Sell Error:", e.message);
    } finally {
        activeLivePositions = Math.max(0, activeLivePositions - 1);
    }
}

main().catch(err => {
    console.error("❌ Terminal Error:", err);
});
