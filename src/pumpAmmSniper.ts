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
const SILENCE_RPC_429_LOGS = process.env.SILENCE_RPC_429_LOGS === "true";

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
        const payload = util.format(...args);
        if (SILENCE_RPC_429_LOGS && payload.includes("Server responded with 429 Too Many Requests.")) {
            return;
        }
        const rendered = `[${timestampNow()}] ${payload}`;
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
    HOLD_SUSPICIOUS_RELAY_SHORT_HOLD_ENABLED: process.env.HOLD_SUSPICIOUS_RELAY_SHORT_HOLD_ENABLED !== "false",
    HOLD_SUSPICIOUS_RELAY_SHORT_HOLD_MS: Number(process.env.HOLD_SUSPICIOUS_RELAY_SHORT_HOLD_MS || 10000),
    HOLD_REMOVE_LIQ_DETECT_ENABLED: process.env.HOLD_REMOVE_LIQ_DETECT_ENABLED !== "false",
    HOLD_REMOVE_LIQ_CHECK_INTERVAL_MS: Number(process.env.HOLD_REMOVE_LIQ_CHECK_INTERVAL_MS || 1500),
    HOLD_REMOVE_LIQ_MIN_WSOL_TO_CREATOR: Number(process.env.HOLD_REMOVE_LIQ_MIN_WSOL_TO_CREATOR || 0.5),
    HOLD_REMOVE_LIQ_MIN_SOL_TO_CREATOR: Number(process.env.HOLD_REMOVE_LIQ_MIN_SOL_TO_CREATOR || 0.5),
    HOLD_CREATOR_AMM_BURST_DETECT_ENABLED: process.env.HOLD_CREATOR_AMM_BURST_DETECT_ENABLED !== "false",
    HOLD_CREATOR_AMM_BURST_WINDOW_SEC: Number(process.env.HOLD_CREATOR_AMM_BURST_WINDOW_SEC || 8),
    HOLD_CREATOR_AMM_BURST_MIN_TXS: Number(process.env.HOLD_CREATOR_AMM_BURST_MIN_TXS || 3),
    HOLD_CREATOR_OUTBOUND_EXIT_ENABLED: process.env.HOLD_CREATOR_OUTBOUND_EXIT_ENABLED !== "false",
    HOLD_CREATOR_OUTBOUND_CHECK_INTERVAL_MS: Number(process.env.HOLD_CREATOR_OUTBOUND_CHECK_INTERVAL_MS || 1500),
    HOLD_CREATOR_OUTBOUND_MIN_SOL: Number(process.env.HOLD_CREATOR_OUTBOUND_MIN_SOL || 10),
    HOLD_CREATOR_OUTBOUND_SPRAY_EXIT_ENABLED: process.env.HOLD_CREATOR_OUTBOUND_SPRAY_EXIT_ENABLED !== "false",
    HOLD_CREATOR_OUTBOUND_SPRAY_CHECK_INTERVAL_MS: Number(process.env.HOLD_CREATOR_OUTBOUND_SPRAY_CHECK_INTERVAL_MS || 1500),
    HOLD_CREATOR_OUTBOUND_SPRAY_WINDOW_SEC: Number(process.env.HOLD_CREATOR_OUTBOUND_SPRAY_WINDOW_SEC || 30),
    HOLD_CREATOR_OUTBOUND_SPRAY_MIN_TRANSFERS: Number(process.env.HOLD_CREATOR_OUTBOUND_SPRAY_MIN_TRANSFERS || 20),
    HOLD_CREATOR_OUTBOUND_SPRAY_MIN_DESTINATIONS: Number(process.env.HOLD_CREATOR_OUTBOUND_SPRAY_MIN_DESTINATIONS || 20),
    HOLD_CREATOR_OUTBOUND_SPRAY_MAX_MEDIAN_SOL: Number(process.env.HOLD_CREATOR_OUTBOUND_SPRAY_MAX_MEDIAN_SOL || 0.05),
    HOLD_CREATOR_OUTBOUND_SPRAY_MAX_REL_STDDEV: Number(process.env.HOLD_CREATOR_OUTBOUND_SPRAY_MAX_REL_STDDEV || 0.2),
    HOLD_CREATOR_OUTBOUND_SPRAY_MAX_AMOUNT_RATIO: Number(process.env.HOLD_CREATOR_OUTBOUND_SPRAY_MAX_AMOUNT_RATIO || 3),
    HOLD_CREATOR_INBOUND_SPRAY_EXIT_ENABLED: process.env.HOLD_CREATOR_INBOUND_SPRAY_EXIT_ENABLED !== "false",
    HOLD_CREATOR_INBOUND_SPRAY_CHECK_INTERVAL_MS: Number(process.env.HOLD_CREATOR_INBOUND_SPRAY_CHECK_INTERVAL_MS || 1500),
    HOLD_CREATOR_INBOUND_SPRAY_WINDOW_SEC: Number(process.env.HOLD_CREATOR_INBOUND_SPRAY_WINDOW_SEC || 30),
    HOLD_CREATOR_INBOUND_SPRAY_MIN_TRANSFERS: Number(process.env.HOLD_CREATOR_INBOUND_SPRAY_MIN_TRANSFERS || 8),
    HOLD_CREATOR_INBOUND_SPRAY_MIN_SOURCES: Number(process.env.HOLD_CREATOR_INBOUND_SPRAY_MIN_SOURCES || 8),
    HOLD_CREATOR_INBOUND_SPRAY_MAX_REL_STDDEV: Number(process.env.HOLD_CREATOR_INBOUND_SPRAY_MAX_REL_STDDEV || 0.12),
    HOLD_CREATOR_INBOUND_SPRAY_MAX_AMOUNT_RATIO: Number(process.env.HOLD_CREATOR_INBOUND_SPRAY_MAX_AMOUNT_RATIO || 1.35),
    HOLD_POOL_CHURN_DETECT_ENABLED: process.env.HOLD_POOL_CHURN_DETECT_ENABLED !== "false",
    HOLD_POOL_CHURN_CHECK_INTERVAL_MS: Number(process.env.HOLD_POOL_CHURN_CHECK_INTERVAL_MS || 1500),
    HOLD_POOL_CHURN_SIG_LIMIT: Number(process.env.HOLD_POOL_CHURN_SIG_LIMIT || 60),
    HOLD_POOL_CHURN_WINDOW_SHORT_MS: Number(process.env.HOLD_POOL_CHURN_WINDOW_SHORT_MS || 10000),
    HOLD_POOL_CHURN_WINDOW_LONG_MS: Number(process.env.HOLD_POOL_CHURN_WINDOW_LONG_MS || 20000),
    HOLD_POOL_CHURN_WINDOW_CRITICAL_MS: Number(process.env.HOLD_POOL_CHURN_WINDOW_CRITICAL_MS || 40000),
    HOLD_POOL_CHURN_TX_SHORT_MIN: Number(process.env.HOLD_POOL_CHURN_TX_SHORT_MIN || 10),
    HOLD_POOL_CHURN_TX_LONG_MIN: Number(process.env.HOLD_POOL_CHURN_TX_LONG_MIN || 20),
    HOLD_POOL_CHURN_TX_CRITICAL_MIN: Number(process.env.HOLD_POOL_CHURN_TX_CRITICAL_MIN || 30),
    HOLD_POOL_CHURN_SELL_DROP_PCT: Number(process.env.HOLD_POOL_CHURN_SELL_DROP_PCT || 50),
    HOLD_POOL_CHURN_CRITICAL_SELL_DROP_PCT: Number(process.env.HOLD_POOL_CHURN_CRITICAL_SELL_DROP_PCT || 35),
    HOLD_PROBATION_CASHOUT_DELTA_MIN_SOL: Number(process.env.HOLD_PROBATION_CASHOUT_DELTA_MIN_SOL || 5),
    PRE_BUY_WAIT_MS: Number(process.env.PRE_BUY_WAIT_MS || 1500), // Wait before entering
    PRE_BUY_MAX_LIQ_DROP_PCT: Number(process.env.PRE_BUY_MAX_LIQ_DROP_PCT || 10), // Skip if liq drops too much during wait
    PRE_BUY_CONFIRM_SNAPSHOTS: Number(process.env.PRE_BUY_CONFIRM_SNAPSHOTS || 3), // Extra confirmations after wait
    PRE_BUY_CONFIRM_INTERVAL_MS: Number(process.env.PRE_BUY_CONFIRM_INTERVAL_MS || 350), // Delay between confirmations
    PRE_BUY_TOP10_CHECK_ENABLED: process.env.PRE_BUY_TOP10_CHECK_ENABLED !== "false",
    PRE_BUY_TOP10_MAX_PCT: Number(process.env.PRE_BUY_TOP10_MAX_PCT || 90),
    PRE_BUY_TOP10_EXCLUDE_POOL: process.env.PRE_BUY_TOP10_EXCLUDE_POOL !== "false",
    PRE_BUY_TOP10_FAIL_OPEN: process.env.PRE_BUY_TOP10_FAIL_OPEN === "true",
    PRE_BUY_TOP10_MAX_ATTEMPTS: Number(process.env.PRE_BUY_TOP10_MAX_ATTEMPTS || 4),
    PRE_BUY_TOP10_RETRY_BASE_MS: Number(process.env.PRE_BUY_TOP10_RETRY_BASE_MS || 400),
    CREATOR_RISK_CHECK_ENABLED: process.env.CREATOR_RISK_CHECK_ENABLED !== "false",
    CREATOR_RISK_SIG_LIMIT: Number(process.env.CREATOR_RISK_SIG_LIMIT || 40),
    CREATOR_RISK_PARSED_TX_LIMIT: Number(process.env.CREATOR_RISK_PARSED_TX_LIMIT || 25),
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
    CREATOR_RISK_SPRAY_OUTBOUND_BLOCK_ENABLED: process.env.CREATOR_RISK_SPRAY_OUTBOUND_BLOCK_ENABLED !== "false",
    CREATOR_RISK_SPRAY_OUTBOUND_MIN_TRANSFERS: Number(process.env.CREATOR_RISK_SPRAY_OUTBOUND_MIN_TRANSFERS || 8),
    CREATOR_RISK_SPRAY_OUTBOUND_MIN_DESTINATIONS: Number(process.env.CREATOR_RISK_SPRAY_OUTBOUND_MIN_DESTINATIONS || 8),
    CREATOR_RISK_SPRAY_OUTBOUND_MAX_REL_STDDEV: Number(process.env.CREATOR_RISK_SPRAY_OUTBOUND_MAX_REL_STDDEV || 0.12),
    CREATOR_RISK_SPRAY_OUTBOUND_MAX_AMOUNT_RATIO: Number(process.env.CREATOR_RISK_SPRAY_OUTBOUND_MAX_AMOUNT_RATIO || 1.25),
    CREATOR_RISK_INBOUND_SPRAY_BLOCK_ENABLED: process.env.CREATOR_RISK_INBOUND_SPRAY_BLOCK_ENABLED !== "false",
    CREATOR_RISK_INBOUND_SPRAY_MIN_TRANSFERS: Number(process.env.CREATOR_RISK_INBOUND_SPRAY_MIN_TRANSFERS || 8),
    CREATOR_RISK_INBOUND_SPRAY_MIN_SOURCES: Number(process.env.CREATOR_RISK_INBOUND_SPRAY_MIN_SOURCES || 8),
    CREATOR_RISK_INBOUND_SPRAY_MAX_REL_STDDEV: Number(process.env.CREATOR_RISK_INBOUND_SPRAY_MAX_REL_STDDEV || 0.12),
    CREATOR_RISK_INBOUND_SPRAY_MAX_AMOUNT_RATIO: Number(process.env.CREATOR_RISK_INBOUND_SPRAY_MAX_AMOUNT_RATIO || 1.35),
    CREATOR_RISK_INBOUND_SPRAY_MAX_WINDOW_SEC: Number(process.env.CREATOR_RISK_INBOUND_SPRAY_MAX_WINDOW_SEC || 30),
    CREATOR_RISK_CREATOR_SEED_RATIO_BLOCK_ENABLED: process.env.CREATOR_RISK_CREATOR_SEED_RATIO_BLOCK_ENABLED !== "false",
    CREATOR_RISK_CREATOR_SEED_MIN_PCT_OF_CURRENT_LIQ: Number(process.env.CREATOR_RISK_CREATOR_SEED_MIN_PCT_OF_CURRENT_LIQ || 5),
    CREATOR_RISK_CREATOR_SEED_MAX_GROWTH_MULTIPLIER: Number(process.env.CREATOR_RISK_CREATOR_SEED_MAX_GROWTH_MULTIPLIER || 20),
    CREATOR_RISK_MICRO_INBOUND_MAX_SOL: Number(process.env.CREATOR_RISK_MICRO_INBOUND_MAX_SOL || 0.001),
    CREATOR_RISK_MICRO_INBOUND_MIN_TRANSFERS: Number(process.env.CREATOR_RISK_MICRO_INBOUND_MIN_TRANSFERS || 6),
    CREATOR_RISK_MICRO_INBOUND_MIN_SOURCES: Number(process.env.CREATOR_RISK_MICRO_INBOUND_MIN_SOURCES || 2),
    CREATOR_RISK_MICRO_INBOUND_WINDOW_SEC: Number(process.env.CREATOR_RISK_MICRO_INBOUND_WINDOW_SEC || 5),
    CREATOR_RISK_DIRECT_AMM_REENTRY_ENABLED: process.env.CREATOR_RISK_DIRECT_AMM_REENTRY_ENABLED !== "false",
    CREATOR_RISK_DIRECT_AMM_REENTRY_SIG_LIMIT: Number(process.env.CREATOR_RISK_DIRECT_AMM_REENTRY_SIG_LIMIT || 8),
    CREATOR_RISK_DIRECT_AMM_REENTRY_WINDOW_SEC: Number(process.env.CREATOR_RISK_DIRECT_AMM_REENTRY_WINDOW_SEC || 180),
    CREATOR_RISK_PRECREATE_BURST_BLOCK_ENABLED: process.env.CREATOR_RISK_PRECREATE_BURST_BLOCK_ENABLED !== "false",
    CREATOR_RISK_PRECREATE_BURST_WINDOW_SEC: Number(process.env.CREATOR_RISK_PRECREATE_BURST_WINDOW_SEC || 240),
    CREATOR_RISK_PRECREATE_BURST_SIG_LIMIT: Number(process.env.CREATOR_RISK_PRECREATE_BURST_SIG_LIMIT || 120),
    CREATOR_RISK_PRECREATE_BURST_PARSED_TX_LIMIT: Number(process.env.CREATOR_RISK_PRECREATE_BURST_PARSED_TX_LIMIT || 80),
    CREATOR_RISK_PRECREATE_BURST_MIN_TRANSFERS: Number(process.env.CREATOR_RISK_PRECREATE_BURST_MIN_TRANSFERS || 12),
    CREATOR_RISK_PRECREATE_BURST_MIN_DESTINATIONS: Number(process.env.CREATOR_RISK_PRECREATE_BURST_MIN_DESTINATIONS || 12),
    CREATOR_RISK_PRECREATE_BURST_MIN_MEDIAN_SOL: Number(process.env.CREATOR_RISK_PRECREATE_BURST_MIN_MEDIAN_SOL || 0.7),
    CREATOR_RISK_PRECREATE_BURST_MAX_MEDIAN_SOL: Number(process.env.CREATOR_RISK_PRECREATE_BURST_MAX_MEDIAN_SOL || 1.3),
    CREATOR_RISK_PRECREATE_BURST_MAX_REL_STDDEV: Number(process.env.CREATOR_RISK_PRECREATE_BURST_MAX_REL_STDDEV || 0.1),
    CREATOR_RISK_PRECREATE_BURST_MAX_AMOUNT_RATIO: Number(process.env.CREATOR_RISK_PRECREATE_BURST_MAX_AMOUNT_RATIO || 1.35),
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
    PAPER_CREATOR_RISK_PROBATION_ENABLED: process.env.PAPER_CREATOR_RISK_PROBATION_ENABLED === "true",
    PAPER_CREATOR_RISK_PROBATION_HOLD_MS: Number(process.env.PAPER_CREATOR_RISK_PROBATION_HOLD_MS || 10000),
    PAPER_CREATOR_CASHOUT_PROBATION_HOLD_MS: Number(process.env.PAPER_CREATOR_CASHOUT_PROBATION_HOLD_MS || 45000),
    MAX_CONCURRENT_OPERATIONS: Number(process.env.MAX_CONCURRENT_OPERATIONS || 2),
    PAPER_TRADE_MAX_LOSS_PCT: Number(process.env.PAPER_TRADE_MAX_LOSS_PCT || 80),
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
    creatorSeedSol?: number;
    creatorSeedPctOfCurrentLiq?: number;
    inboundSpraySources?: number;
    precreateBurstTransfers?: number;
};

function isProbationBypassForbidden(result?: CreatorRiskResult): boolean {
    const normalized = (result?.reason || "").toLowerCase();
    if (
        normalized.includes("creator in historical rug blacklist") ||
        normalized.includes("funder blacklisted") ||
        normalized.includes("relay funding recent on standard pool") ||
        normalized.includes("relay funding recent + micro burst") ||
        normalized.includes("creator direct amm re-entry") ||
        normalized.includes("creator seed too small")
    ) {
        return true;
    }

    return false;
}

function getProbationHoldMs(reason?: string): number {
    const normalized = (reason || "").toLowerCase();
    if (normalized.includes("creator cashout")) {
        return Math.max(1000, CONFIG.PAPER_CREATOR_CASHOUT_PROBATION_HOLD_MS);
    }
    return Math.max(1000, CONFIG.PAPER_CREATOR_RISK_PROBATION_HOLD_MS);
}

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

function getExitQuoteSolFromState(state: any, tokenMint: string, tokenOutAtomic: BN): number | null {
    if (!state || !tokenOutAtomic || tokenOutAtomic.lte(new BN(0))) return null;
    const orientation = getPoolOrientation(state, tokenMint);
    if (!orientation.hasWsol) return null;

    try {
        if (orientation.solIsBase) {
            const exit = buyQuoteInput({
                quote: tokenOutAtomic,
                slippage: CONFIG.SLIPPAGE_PERCENT,
                baseReserve: state.poolBaseAmount,
                quoteReserve: state.poolQuoteAmount,
                baseMintAccount: state.baseMintAccount,
                baseMint: state.baseMint,
                coinCreator: state.pool.coinCreator,
                creator: state.pool.creator,
                feeConfig: state.feeConfig,
                globalConfig: state.globalConfig,
            });
            const solOut = Number(exit.base.toString()) / 1e9;
            return Number.isFinite(solOut) ? solOut : null;
        }

        const exit = sellBaseInput({
            base: tokenOutAtomic,
            slippage: CONFIG.SLIPPAGE_PERCENT,
            baseReserve: state.poolBaseAmount,
            quoteReserve: state.poolQuoteAmount,
            baseMintAccount: state.baseMintAccount,
            baseMint: state.baseMint,
            coinCreator: state.pool.coinCreator,
            creator: state.pool.creator,
            feeConfig: state.feeConfig,
            globalConfig: state.globalConfig,
        });
        const solOut = Number(exit.uiQuote.toString()) / 1e9;
        return Number.isFinite(solOut) ? solOut : null;
    } catch {
        return null;
    }
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
        const creatorSeedSol = creatorAddress ? extractCreatorSeedSolFromCreateTx(tx, creatorAddress) : 0;
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
            creatorSeedSol,
        });
        let creatorRiskProbation = false;
        let creatorRiskProbationHoldMs = Math.max(1000, CONFIG.PAPER_CREATOR_RISK_PROBATION_HOLD_MS);
        if (!creatorRisk.ok) {
            if (
                MONITOR_ONLY &&
                CONFIG.PAPER_CREATOR_RISK_PROBATION_ENABLED &&
                !isProbationBypassForbidden(creatorRisk)
            ) {
                creatorRiskProbation = true;
                creatorRiskProbationHoldMs = getProbationHoldMs(creatorRisk.reason);
                stageLog(
                    ctx,
                    "PROBATION",
                    `paper-only bypass creator risk (${creatorRisk.reason || "unknown"}) ` +
                    `hold=${creatorRiskProbationHoldMs}ms`
                );
            } else {
                console.log(`🛑 SKIP: creator risk (${creatorRisk.reason})`);
                finalStatus = "SKIP: creator risk";
                return;
            }
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
                creatorRisk,
                creatorRiskProbation
                    ? {
                        forceHoldMs: creatorRiskProbationHoldMs,
                        suppressCreatorRiskRecheck: true,
                      }
                    : undefined,
            );
            if (!paper.ok) {
                if (paper.finalStatus) {
                    console.log(`⚠️ PAPER_TRADE: ${paper.reason}`);
                    finalStatus = paper.finalStatus;
                } else {
                    console.log(`🛑 SKIP: Paper simulation guard (${paper.reason})`);
                    finalStatus = "SKIP: paper simulation guard";
                }
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

    const unavailableResult = (reason: string) => {
        const policy = CONFIG.PRE_BUY_TOP10_FAIL_OPEN ? "fail-open" : "fail-closed";
        stageLog(ctx, "TOP10", `unavailable (${reason}) -> ${policy}`);
        if (CONFIG.PRE_BUY_TOP10_FAIL_OPEN) {
            return { ok: true };
        }
        return { ok: false, reason: `top10 unavailable: ${reason}` };
    };

    const maxAttempts = Math.max(1, CONFIG.PRE_BUY_TOP10_MAX_ATTEMPTS);
    const baseDelayMs = Math.max(0, CONFIG.PRE_BUY_TOP10_RETRY_BASE_MS);
    let lastUnavailableReason = "top10 check failed";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const mintKey = await resolveTop10MintKey(connection, tokenMint, poolAddress, ctx);
            if (!mintKey) {
                lastUnavailableReason = "no valid mint candidate";
                throw new Error(lastUnavailableReason);
            }

            let mintInfoErr: string | null = null;
            const mintInfo = await getMintInfoRobust(connection, mintKey).catch((e: any) => {
                mintInfoErr = e?.message || String(e);
                return null;
            });
            if (!mintInfo) {
                lastUnavailableReason = `mint info error: ${mintInfoErr || "unknown error"}`;
                throw new Error(lastUnavailableReason);
            }

            const totalSupplyRaw = Number(mintInfo.supply.toString());
            if (!Number.isFinite(totalSupplyRaw) || totalSupplyRaw <= 0) {
                lastUnavailableReason = "invalid token supply";
                throw new Error(lastUnavailableReason);
            }

            const largest = await getTop10LargestAccountsWithRetry(connection, mintKey, 8, 350);
            if (!largest) {
                lastUnavailableReason = "largest accounts error";
                throw new Error(lastUnavailableReason);
            }

            const top10Accounts = largest.value.slice(0, 10);
            if (top10Accounts.length === 0) {
                lastUnavailableReason = "no holder accounts found";
                throw new Error(lastUnavailableReason);
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
            lastUnavailableReason = e?.message || lastUnavailableReason;
            if (attempt < maxAttempts) {
                const retryDelayMs = Math.round(baseDelayMs * Math.pow(1.6, attempt - 1));
                stageLog(
                    ctx,
                    "TOP10",
                    `retry ${attempt}/${maxAttempts} after error: ${lastUnavailableReason} (wait ${retryDelayMs}ms)`
                );
                if (retryDelayMs > 0) {
                    await new Promise((r) => setTimeout(r, retryDelayMs));
                }
                continue;
            }
        }
    }

    return unavailableResult(lastUnavailableReason);
}

async function getTop10LargestAccountsWithRetry(
    connection: Connection,
    mintKey: PublicKey,
    maxAttempts: number,
    delayMs: number,
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

function classifySprayOutboundPattern(outboundTransfers: Array<{ destination: string; sol: number }>) {
    const positive = outboundTransfers.filter((t) => Number.isFinite(t.sol) && t.sol > 0);
    if (!positive.length) {
        return {
            detected: false,
            transfers: 0,
            destinations: 0,
            medianSol: 0,
            relStdDev: Infinity,
            amountRatio: Infinity,
        };
    }

    const values = positive.map((t) => t.sol).sort((a, b) => a - b);
    const destinations = new Set(positive.map((t) => t.destination)).size;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const relStdDev = mean > 0 ? stdDev / mean : Infinity;
    const medianSol =
        values.length % 2 === 0
            ? (values[(values.length / 2) - 1] + values[values.length / 2]) / 2
            : values[Math.floor(values.length / 2)];
    const amountRatio = values[0] > 0 ? values[values.length - 1] / values[0] : Infinity;

    const detected =
        positive.length >= CONFIG.CREATOR_RISK_SPRAY_OUTBOUND_MIN_TRANSFERS &&
        destinations >= CONFIG.CREATOR_RISK_SPRAY_OUTBOUND_MIN_DESTINATIONS &&
        relStdDev <= CONFIG.CREATOR_RISK_SPRAY_OUTBOUND_MAX_REL_STDDEV &&
        amountRatio <= CONFIG.CREATOR_RISK_SPRAY_OUTBOUND_MAX_AMOUNT_RATIO;

    return {
        detected,
        transfers: positive.length,
        destinations,
        medianSol,
        relStdDev,
        amountRatio,
    };
}

function classifyInboundSprayPattern(inboundTransfers: Array<{ source: string; sol: number }>) {
    const positive = inboundTransfers.filter((t) => Number.isFinite(t.sol) && t.sol > 0);
    if (!positive.length) {
        return {
            detected: false,
            transfers: 0,
            sources: 0,
            medianSol: 0,
            relStdDev: Infinity,
            amountRatio: Infinity,
        };
    }

    const values = positive.map((t) => t.sol).sort((a, b) => a - b);
    const sources = new Set(positive.map((t) => t.source)).size;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const relStdDev = mean > 0 ? stdDev / mean : Infinity;
    const medianSol =
        values.length % 2 === 0
            ? (values[(values.length / 2) - 1] + values[values.length / 2]) / 2
            : values[Math.floor(values.length / 2)];
    const amountRatio = values[0] > 0 ? values[values.length - 1] / values[0] : Infinity;

    const detected =
        positive.length >= CONFIG.CREATOR_RISK_INBOUND_SPRAY_MIN_TRANSFERS &&
        sources >= CONFIG.CREATOR_RISK_INBOUND_SPRAY_MIN_SOURCES &&
        relStdDev <= CONFIG.CREATOR_RISK_INBOUND_SPRAY_MAX_REL_STDDEV &&
        amountRatio <= CONFIG.CREATOR_RISK_INBOUND_SPRAY_MAX_AMOUNT_RATIO;

    return {
        detected,
        transfers: positive.length,
        sources,
        medianSol,
        relStdDev,
        amountRatio,
    };
}

function classifyPrecreateOutboundBurst(outboundTransfers: Array<{ destination: string; sol: number }>) {
    const positive = outboundTransfers.filter((t) => Number.isFinite(t.sol) && t.sol > 0);
    if (!positive.length) {
        return {
            detected: false,
            transfers: 0,
            destinations: 0,
            medianSol: 0,
            relStdDev: Infinity,
            amountRatio: Infinity,
        };
    }

    const values = positive.map((t) => t.sol).sort((a, b) => a - b);
    const destinations = new Set(positive.map((t) => t.destination)).size;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const relStdDev = mean > 0 ? stdDev / mean : Infinity;
    const medianSol =
        values.length % 2 === 0
            ? (values[(values.length / 2) - 1] + values[values.length / 2]) / 2
            : values[Math.floor(values.length / 2)];
    const amountRatio = values[0] > 0 ? values[values.length - 1] / values[0] : Infinity;

    const detected =
        positive.length >= CONFIG.CREATOR_RISK_PRECREATE_BURST_MIN_TRANSFERS &&
        destinations >= CONFIG.CREATOR_RISK_PRECREATE_BURST_MIN_DESTINATIONS &&
        medianSol >= CONFIG.CREATOR_RISK_PRECREATE_BURST_MIN_MEDIAN_SOL &&
        medianSol <= CONFIG.CREATOR_RISK_PRECREATE_BURST_MAX_MEDIAN_SOL &&
        relStdDev <= CONFIG.CREATOR_RISK_PRECREATE_BURST_MAX_REL_STDDEV &&
        amountRatio <= CONFIG.CREATOR_RISK_PRECREATE_BURST_MAX_AMOUNT_RATIO;

    return {
        detected,
        transfers: positive.length,
        destinations,
        medianSol,
        relStdDev,
        amountRatio,
    };
}

async function collectPrecreateOutboundTransfers(
    connection: Connection,
    creatorAddress: string,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
): Promise<Array<{ destination: string; sol: number }>> {
    if (!createPoolSignature || !createPoolBlockTime || !CONFIG.CREATOR_RISK_PRECREATE_BURST_BLOCK_ENABLED) {
        return [];
    }

    try {
        const sigs = await connection.getSignaturesForAddress(
            new PublicKey(creatorAddress),
            {
                limit: Math.max(20, CONFIG.CREATOR_RISK_PRECREATE_BURST_SIG_LIMIT),
                before: createPoolSignature,
            },
            "confirmed",
        );
        const windowSec = Math.max(1, CONFIG.CREATOR_RISK_PRECREATE_BURST_WINDOW_SEC);
        const parseLimit = Math.max(5, CONFIG.CREATOR_RISK_PRECREATE_BURST_PARSED_TX_LIMIT);
        const candidates = sigs
            .filter((s) => !s.err && !!s.blockTime)
            .filter((s) => {
                const t = s.blockTime || 0;
                return t <= createPoolBlockTime && createPoolBlockTime - t <= windowSec;
            })
            .sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0))
            .slice(-parseLimit);

        const outboundTransfers: Array<{ destination: string; sol: number }> = [];
        for (const sig of candidates) {
            const tx = await connection.getParsedTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            });
            if (!tx) continue;
            const noopCounterparties = new Set<string>();
            const noopLinks = new Set<string>();
            const outer = walkParsedInstructions(
                tx.transaction?.message?.instructions,
                creatorAddress,
                noopCounterparties,
                noopLinks,
                new Set<string>(),
            );
            outboundTransfers.push(...outer.outboundTransfers);

            for (const inner of tx.meta?.innerInstructions || []) {
                const part = walkParsedInstructions(
                    inner.instructions,
                    creatorAddress,
                    noopCounterparties,
                    noopLinks,
                    new Set<string>(),
                );
                outboundTransfers.push(...part.outboundTransfers);
            }
        }
        return outboundTransfers;
    } catch {
        return [];
    }
}

function extractCreatorSeedSolFromCreateTx(tx: any, creatorAddress: string): number {
    const counterparties = new Set<string>();
    const links = new Set<string>();
    const outer = walkParsedInstructions(
        tx.transaction?.message?.instructions,
        creatorAddress,
        counterparties,
        links,
        new Set<string>(),
    );
    const innerParts = (tx.meta?.innerInstructions || []).map((inner: any) =>
        walkParsedInstructions(inner.instructions, creatorAddress, counterparties, links, new Set<string>())
    );

    const outboundTransfers = [
        ...outer.outboundTransfers,
        ...innerParts.flatMap((part: any) => part.outboundTransfers),
    ].filter((transfer) => Number.isFinite(transfer.sol) && transfer.sol > 0);

    if (!outboundTransfers.length) return 0;
    return outboundTransfers.reduce((max, transfer) => Math.max(max, transfer.sol), 0);
}

function instructionProgramIdMatches(ix: any, expectedProgramId: string): boolean {
    const raw = ix?.programId;
    const programId =
        typeof raw === "string"
            ? raw
            : raw?.toBase58?.() || "";
    return programId === expectedProgramId;
}

function flattenParsedInstructions(tx: any): any[] {
    const all: any[] = [];
    const outer = tx?.transaction?.message?.instructions || [];
    for (const ix of outer) all.push(ix);
    const innerGroups = tx?.meta?.innerInstructions || [];
    for (const g of innerGroups) {
        for (const ix of (g.instructions || [])) all.push(ix);
    }
    return all;
}

function getOwnerMintDelta(tx: any, owner: string, mint: string): number {
    const pre = tx?.meta?.preTokenBalances || [];
    const post = tx?.meta?.postTokenBalances || [];
    let preAmt = 0;
    let postAmt = 0;

    for (const b of pre) {
        if (b?.owner !== owner || b?.mint !== mint) continue;
        const raw = Number(b?.uiTokenAmount?.amount || 0);
        const dec = Number(b?.uiTokenAmount?.decimals || 0);
        if (Number.isFinite(raw) && Number.isFinite(dec)) preAmt += raw / (10 ** dec);
    }
    for (const b of post) {
        if (b?.owner !== owner || b?.mint !== mint) continue;
        const raw = Number(b?.uiTokenAmount?.amount || 0);
        const dec = Number(b?.uiTokenAmount?.decimals || 0);
        if (Number.isFinite(raw) && Number.isFinite(dec)) postAmt += raw / (10 ** dec);
    }

    return postAmt - preAmt;
}

function getSystemInboundSolToCreator(tx: any, creatorAddress: string): number {
    let totalSol = 0;
    for (const ix of flattenParsedInstructions(tx)) {
        const parsed = ix?.parsed;
        if (!parsed || parsed.type !== "transfer") continue;
        const info = parsed.info || {};
        const from = info.source || info.from || null;
        const to = info.destination || info.to || null;
        const lamports = Number(info.lamports || 0);
        if (!from || !to || !Number.isFinite(lamports) || lamports <= 0) continue;
        if (to === creatorAddress) {
            totalSol += lamports / 1e9;
        }
    }
    return totalSol;
}

function txTouchesAddress(tx: any, address: string): boolean {
    const keys = tx?.transaction?.message?.accountKeys || [];
    return keys.some((k: any) => {
        const v = typeof k === "string"
            ? k
            : (k?.pubkey?.toBase58?.() || k?.toBase58?.() || null);
        return v === address;
    });
}

function isRemoveLiquidityLikeTx(tx: any, creatorAddress: string, poolAddress: string): {
    detected: boolean;
    wsolToCreator: number;
    solToCreator: number;
} {
    const touchesPumpAmm = flattenParsedInstructions(tx).some((ix) =>
        instructionProgramIdMatches(ix, PUMPFUN_AMM_PROGRAM_ID)
    );
    if (!touchesPumpAmm || !txTouchesAddress(tx, poolAddress)) {
        return { detected: false, wsolToCreator: 0, solToCreator: 0 };
    }

    const wsolToCreator = getOwnerMintDelta(tx, creatorAddress, WSOL);
    const solToCreator = getSystemInboundSolToCreator(tx, creatorAddress);
    const detected =
        wsolToCreator >= CONFIG.HOLD_REMOVE_LIQ_MIN_WSOL_TO_CREATOR ||
        solToCreator >= CONFIG.HOLD_REMOVE_LIQ_MIN_SOL_TO_CREATOR;

    return { detected, wsolToCreator, solToCreator };
}

async function detectRemoveLiquiditySince(
    connection: Connection,
    poolAddress: string,
    creatorAddress: string,
    seenSignatures: Set<string>,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
): Promise<{
    detected: boolean;
    signature?: string;
    wsolToCreator?: number;
    solToCreator?: number;
    creatorAmmTouch?: boolean;
    eventTimeSec?: number;
}> {
    try {
        const sigs = await connection.getSignaturesForAddress(
            new PublicKey(poolAddress),
            { limit: 15 },
            "confirmed"
        );
        const chronological = [...sigs]
            .filter((s) => !s.err)
            .filter((s) => !createPoolBlockTime || !s.blockTime || s.blockTime >= createPoolBlockTime)
            .sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0));

        for (const s of chronological) {
            if (s.signature === createPoolSignature) {
                seenSignatures.add(s.signature);
                continue;
            }
            if (seenSignatures.has(s.signature)) continue;
            seenSignatures.add(s.signature);

            const tx = await connection.getParsedTransaction(s.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            });
            if (!tx) continue;

            const touchesPumpAmm = flattenParsedInstructions(tx).some((ix) =>
                instructionProgramIdMatches(ix, PUMPFUN_AMM_PROGRAM_ID)
            );
            const touchesCreator = txTouchesAddress(tx, creatorAddress);
            const touchesPool = txTouchesAddress(tx, poolAddress);
            const creatorAmmTouch = touchesPumpAmm && touchesCreator && touchesPool;
            const eventTimeSec = s.blockTime || Math.floor(Date.now() / 1000);

            const m = isRemoveLiquidityLikeTx(tx, creatorAddress, poolAddress);
            if (m.detected) {
                return {
                    detected: true,
                    signature: s.signature,
                    wsolToCreator: m.wsolToCreator,
                    solToCreator: m.solToCreator,
                    creatorAmmTouch,
                    eventTimeSec,
                };
            }

            if (creatorAmmTouch) {
                return {
                    detected: false,
                    creatorAmmTouch: true,
                    signature: s.signature,
                    eventTimeSec,
                };
            }
        }
    } catch {
        // fail-open
    }

    return { detected: false };
}

async function detectCreatorLargeOutboundSince(
    connection: Connection,
    creatorAddress: string,
    poolAddress: string,
    seenSignatures: Set<string>,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
): Promise<{
    detected: boolean;
    signature?: string;
    outboundSol?: number;
    destination?: string;
    eventTimeSec?: number;
}> {
    try {
        const sigs = await connection.getSignaturesForAddress(
            new PublicKey(creatorAddress),
            { limit: 30 },
            "confirmed"
        );
        const chronological = [...sigs]
            .filter((s) => !s.err)
            .filter((s) => !createPoolBlockTime || !s.blockTime || s.blockTime >= createPoolBlockTime)
            .sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0));

        for (const s of chronological) {
            if (s.signature === createPoolSignature) {
                seenSignatures.add(s.signature);
                continue;
            }
            if (seenSignatures.has(s.signature)) continue;
            seenSignatures.add(s.signature);

            const tx = await connection.getParsedTransaction(s.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            });
            if (!tx) continue;

            for (const ix of flattenParsedInstructions(tx)) {
                const parsed = ix?.parsed;
                if (!parsed || parsed.type !== "transfer") continue;
                const info = parsed.info || {};
                const from = info.source || info.from || null;
                const to = info.destination || info.to || null;
                const lamports = Number(info.lamports || 0);
                if (
                    from !== creatorAddress ||
                    !to ||
                    to === poolAddress ||
                    !Number.isFinite(lamports) ||
                    lamports <= 0
                ) {
                    continue;
                }
                const outboundSol = lamports / 1e9;
                if (outboundSol >= CONFIG.HOLD_CREATOR_OUTBOUND_MIN_SOL) {
                    return {
                        detected: true,
                        signature: s.signature,
                        outboundSol,
                        destination: to,
                        eventTimeSec: s.blockTime || Math.floor(Date.now() / 1000),
                    };
                }
            }
        }
    } catch {
        // fail-open
    }

    return { detected: false };
}

async function collectCreatorOutboundTransfersSince(
    connection: Connection,
    creatorAddress: string,
    poolAddress: string,
    seenSignatures: Set<string>,
    createPoolSignature?: string,
    minBlockTimeSec?: number | null,
): Promise<Array<{ destination: string; sol: number; eventTimeSec: number; signature: string }>> {
    const events: Array<{ destination: string; sol: number; eventTimeSec: number; signature: string }> = [];

    try {
        const sigs = await connection.getSignaturesForAddress(
            new PublicKey(creatorAddress),
            { limit: 40 },
            "confirmed"
        );
        const chronological = [...sigs]
            .filter((s) => !s.err)
            .filter((s) => !minBlockTimeSec || !s.blockTime || s.blockTime >= minBlockTimeSec)
            .sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0));

        for (const s of chronological) {
            if (s.signature === createPoolSignature) {
                seenSignatures.add(s.signature);
                continue;
            }
            if (seenSignatures.has(s.signature)) continue;
            seenSignatures.add(s.signature);

            const tx = await connection.getParsedTransaction(s.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            });
            if (!tx) continue;

            for (const ix of flattenParsedInstructions(tx)) {
                const parsed = ix?.parsed;
                if (!parsed || parsed.type !== "transfer") continue;
                const info = parsed.info || {};
                const from = info.source || info.from || null;
                const to = info.destination || info.to || null;
                const lamports = Number(info.lamports || 0);
                if (
                    from !== creatorAddress ||
                    !to ||
                    to === poolAddress ||
                    !Number.isFinite(lamports) ||
                    lamports <= 0
                ) {
                    continue;
                }
                events.push({
                    destination: to,
                    sol: lamports / 1e9,
                    eventTimeSec: s.blockTime || Math.floor(Date.now() / 1000),
                    signature: s.signature,
                });
            }
        }
    } catch {
        // fail-open
    }

    return events;
}

async function collectCreatorInboundTransfersSince(
    connection: Connection,
    creatorAddress: string,
    poolAddress: string,
    seenSignatures: Set<string>,
    createPoolSignature?: string,
    minBlockTimeSec?: number | null,
): Promise<Array<{ source: string; sol: number; eventTimeSec: number; signature: string }>> {
    const events: Array<{ source: string; sol: number; eventTimeSec: number; signature: string }> = [];

    try {
        const sigs = await connection.getSignaturesForAddress(
            new PublicKey(creatorAddress),
            { limit: 40 },
            "confirmed"
        );
        const chronological = [...sigs]
            .filter((s) => !s.err)
            .filter((s) => !minBlockTimeSec || !s.blockTime || s.blockTime >= minBlockTimeSec)
            .sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0));

        for (const s of chronological) {
            if (s.signature === createPoolSignature) {
                seenSignatures.add(s.signature);
                continue;
            }
            if (seenSignatures.has(s.signature)) continue;
            seenSignatures.add(s.signature);

            const tx = await connection.getParsedTransaction(s.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            });
            if (!tx) continue;

            for (const ix of flattenParsedInstructions(tx)) {
                const parsed = ix?.parsed;
                if (!parsed || parsed.type !== "transfer") continue;
                const info = parsed.info || {};
                const from = info.source || info.from || null;
                const to = info.destination || info.to || null;
                const lamports = Number(info.lamports || 0);
                if (
                    to !== creatorAddress ||
                    !from ||
                    from === poolAddress ||
                    !Number.isFinite(lamports) ||
                    lamports <= 0
                ) {
                    continue;
                }
                events.push({
                    source: from,
                    sol: lamports / 1e9,
                    eventTimeSec: s.blockTime || Math.floor(Date.now() / 1000),
                    signature: s.signature,
                });
            }
        }
    } catch {
        // fail-open
    }

    return events;
}

function classifyHoldCreatorOutboundSpray(
    outboundTransfers: Array<{ destination: string; sol: number }>
) {
    const positive = outboundTransfers.filter((t) => Number.isFinite(t.sol) && t.sol > 0);
    if (!positive.length) {
        return {
            detected: false,
            transfers: 0,
            destinations: 0,
            medianSol: 0,
            relStdDev: Infinity,
            amountRatio: Infinity,
        };
    }

    const values = positive.map((t) => t.sol).sort((a, b) => a - b);
    const destinations = new Set(positive.map((t) => t.destination)).size;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const relStdDev = mean > 0 ? stdDev / mean : Infinity;
    const medianSol =
        values.length % 2 === 0
            ? (values[(values.length / 2) - 1] + values[values.length / 2]) / 2
            : values[Math.floor(values.length / 2)];
    const amountRatio = values[0] > 0 ? values[values.length - 1] / values[0] : Infinity;

    const detected =
        positive.length >= CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_MIN_TRANSFERS &&
        destinations >= CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_MIN_DESTINATIONS &&
        medianSol <= CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_MAX_MEDIAN_SOL &&
        relStdDev <= CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_MAX_REL_STDDEV &&
        amountRatio <= CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_MAX_AMOUNT_RATIO;

    return {
        detected,
        transfers: positive.length,
        destinations,
        medianSol,
        relStdDev,
        amountRatio,
    };
}

function classifyHoldCreatorInboundSpray(
    inboundTransfers: Array<{ source: string; sol: number }>
) {
    const positive = inboundTransfers.filter((t) => Number.isFinite(t.sol) && t.sol > 0);
    if (!positive.length) {
        return {
            detected: false,
            transfers: 0,
            sources: 0,
            medianSol: 0,
            relStdDev: Infinity,
            amountRatio: Infinity,
        };
    }

    const values = positive.map((t) => t.sol).sort((a, b) => a - b);
    const sources = new Set(positive.map((t) => t.source)).size;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const relStdDev = mean > 0 ? stdDev / mean : Infinity;
    const medianSol =
        values.length % 2 === 0
            ? (values[(values.length / 2) - 1] + values[values.length / 2]) / 2
            : values[Math.floor(values.length / 2)];
    const amountRatio = values[0] > 0 ? values[values.length - 1] / values[0] : Infinity;

    const detected =
        positive.length >= CONFIG.HOLD_CREATOR_INBOUND_SPRAY_MIN_TRANSFERS &&
        sources >= CONFIG.HOLD_CREATOR_INBOUND_SPRAY_MIN_SOURCES &&
        relStdDev <= CONFIG.HOLD_CREATOR_INBOUND_SPRAY_MAX_REL_STDDEV &&
        amountRatio <= CONFIG.HOLD_CREATOR_INBOUND_SPRAY_MAX_AMOUNT_RATIO;

    return {
        detected,
        transfers: positive.length,
        sources,
        medianSol,
        relStdDev,
        amountRatio,
    };
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

async function getPoolRecentChurnStats(
    connection: Connection,
    poolAddress: string,
    createPoolSignature?: string,
    minBlockTimeSec?: number | null,
): Promise<{
    shortCount: number;
    longCount: number;
    criticalCount: number;
}> {
    try {
        const sigs = await connection.getSignaturesForAddress(
            new PublicKey(poolAddress),
            { limit: Math.max(10, CONFIG.HOLD_POOL_CHURN_SIG_LIMIT) },
            "confirmed",
        );
        const nowSec = Math.floor(Date.now() / 1000);
        const shortCutoff = nowSec - Math.max(1, Math.floor(CONFIG.HOLD_POOL_CHURN_WINDOW_SHORT_MS / 1000));
        const longCutoff = nowSec - Math.max(1, Math.floor(CONFIG.HOLD_POOL_CHURN_WINDOW_LONG_MS / 1000));
        const criticalCutoff = nowSec - Math.max(1, Math.floor(CONFIG.HOLD_POOL_CHURN_WINDOW_CRITICAL_MS / 1000));
        let shortCount = 0;
        let longCount = 0;
        let criticalCount = 0;

        for (const sig of sigs) {
            if (sig.err) continue;
            if (sig.signature === createPoolSignature) continue;
            if (!sig.blockTime) continue;
            if (minBlockTimeSec && sig.blockTime < minBlockTimeSec) continue;

            if (sig.blockTime >= criticalCutoff) criticalCount++;
            if (sig.blockTime >= longCutoff) longCount++;
            if (sig.blockTime >= shortCutoff) shortCount++;
        }

        return { shortCount, longCount, criticalCount };
    } catch {
        return { shortCount: 0, longCount: 0, criticalCount: 0 };
    }
}

async function runCreatorRiskCheck(
    connection: Connection,
    creatorAddress: string,
    ctx: string,
    options: {
        forceRefresh?: boolean;
        entrySolLiquidity?: number;
        createPoolSignature?: string;
        createPoolBlockTime?: number | null;
        creatorSeedSol?: number;
    } = {},
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

        const sampleSignatures = new Set(sample.map((s) => s.signature));
        const ingestParsedTx = (tx: any) => {
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
                funder = outer.inboundSources[0] || innerParts.flatMap((p: any) => p.inboundSources)[0] || null;
            }

            if (funder) {
                const outerRefunds = outer.outboundDestinations.filter((d) => d === funder).length > 0 ? outer.solOutSol : 0;
                const innerRefunds = innerParts
                    .filter((p: any) => p.outboundDestinations.filter((d: string) => d === funder).length > 0)
                    .reduce((sum: number, p: any) => sum + p.solOutSol, 0);
                funderRefundSol += outerRefunds + innerRefunds;
            }
        };

        for (const sig of sample) {
            const tx = await connection.getParsedTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
            });
            if (!tx) continue;
            ingestParsedTx(tx);
        }

        // When risk-check runs immediately after create_pool, address history can lag and miss
        // the create tx in `getSignaturesForAddress`. Force-include that tx to avoid blind spots.
        if (options.createPoolSignature && !sampleSignatures.has(options.createPoolSignature)) {
            try {
                const createTx = await connection.getParsedTransaction(options.createPoolSignature, {
                    maxSupportedTransactionVersion: 0,
                    commitment: "confirmed",
                });
                if (createTx) {
                    ingestParsedTx(createTx);
                }
            } catch {
                // fail-open
            }
        }

        const uniqueCounterparties = counterparties.size;
        const firstSigTime = sample[0]?.blockTime || null;
        const lastSigTime = sample[sample.length - 1]?.blockTime || null;
        const augmentedFirstSigTime =
            options.createPoolBlockTime && firstSigTime
                ? Math.min(firstSigTime, options.createPoolBlockTime)
                : (firstSigTime ?? options.createPoolBlockTime ?? null);
        const augmentedLastSigTime =
            options.createPoolBlockTime && lastSigTime
                ? Math.max(lastSigTime, options.createPoolBlockTime)
                : (lastSigTime ?? options.createPoolBlockTime ?? null);
        const compressedWindowSec =
            augmentedFirstSigTime && augmentedLastSigTime && augmentedLastSigTime >= augmentedFirstSigTime
                ? augmentedLastSigTime - augmentedFirstSigTime
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
        const sprayOutbound = classifySprayOutboundPattern(outboundTransfers);
        const sprayInbound = classifyInboundSprayPattern(inboundTransfers);
        const precreateBurst = classifyPrecreateOutboundBurst(
            await collectPrecreateOutboundTransfers(
                connection,
                creatorAddress,
                options.createPoolSignature,
                options.createPoolBlockTime,
            )
        );
        const relayFunding = await classifyRecentRelayFunding(connection, creatorAddress, funder);
        const directAmmReentry = await detectCreatorDirectAmmReentry(
            connection,
            creatorAddress,
            options.createPoolSignature,
            options.createPoolBlockTime,
        );
        const creatorSeedSol = Number.isFinite(options.creatorSeedSol) ? Math.max(0, options.creatorSeedSol || 0) : 0;
        const creatorSeedPctOfCurrentLiq =
            options.entrySolLiquidity && options.entrySolLiquidity > 0 && creatorSeedSol > 0
                ? (creatorSeedSol / options.entrySolLiquidity) * 100
                : 0;
        const creatorSeedGrowthMultiple =
            creatorSeedSol > 0 && options.entrySolLiquidity && options.entrySolLiquidity > 0
                ? options.entrySolLiquidity / creatorSeedSol
                : Infinity;

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
        if (creatorSeedSol > 0 && options.entrySolLiquidity && options.entrySolLiquidity > 0) {
            stageLog(
                ctx,
                "SEED",
                `creator=${creatorSeedSol.toFixed(3)} SOL pct=${creatorSeedPctOfCurrentLiq.toFixed(2)}% growth=${creatorSeedGrowthMultiple.toFixed(2)}x`
            );
        }
        if (sprayInbound.detected) {
            stageLog(
                ctx,
                "ISPRAY",
                `in=${sprayInbound.transfers} src=${sprayInbound.sources} median=${sprayInbound.medianSol.toFixed(3)} ` +
                `rel_std=${sprayInbound.relStdDev.toFixed(2)} ratio=${sprayInbound.amountRatio.toFixed(2)}`
            );
        }
        if (sprayOutbound.detected) {
            stageLog(
                ctx,
                "SPRAY",
                `out=${sprayOutbound.transfers} dest=${sprayOutbound.destinations} median=${sprayOutbound.medianSol.toFixed(3)} ` +
                `rel_std=${sprayOutbound.relStdDev.toFixed(2)} ratio=${sprayOutbound.amountRatio.toFixed(2)}`
            );
        }
        if (precreateBurst.detected) {
            stageLog(
                ctx,
                "PBURST",
                `precreate out=${precreateBurst.transfers} dest=${precreateBurst.destinations} median=${precreateBurst.medianSol.toFixed(3)} ` +
                `rel_std=${precreateBurst.relStdDev.toFixed(2)} ratio=${precreateBurst.amountRatio.toFixed(2)}`
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
            CONFIG.CREATOR_RISK_CREATOR_SEED_RATIO_BLOCK_ENABLED &&
            creatorSeedSol > 0 &&
            options.entrySolLiquidity &&
            options.entrySolLiquidity > 0 &&
            creatorSeedPctOfCurrentLiq < CONFIG.CREATOR_RISK_CREATOR_SEED_MIN_PCT_OF_CURRENT_LIQ &&
            creatorSeedGrowthMultiple >= CONFIG.CREATOR_RISK_CREATOR_SEED_MAX_GROWTH_MULTIPLIER
        ) {
            const result = {
                ok: false,
                reason:
                    `creator seed too small ${creatorSeedSol.toFixed(3)} SOL ` +
                    `(${creatorSeedPctOfCurrentLiq.toFixed(2)}% of liq, growth ${creatorSeedGrowthMultiple.toFixed(2)}x)`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                creatorSeedSol,
                creatorSeedPctOfCurrentLiq,
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
            CONFIG.CREATOR_RISK_INBOUND_SPRAY_BLOCK_ENABLED &&
            compressedWindowSec !== null &&
            compressedWindowSec <= CONFIG.CREATOR_RISK_INBOUND_SPRAY_MAX_WINDOW_SEC &&
            sprayInbound.detected
        ) {
            const result = {
                ok: false,
                reason:
                    `inbound collector pattern ${sprayInbound.transfers} transfers ` +
                    `from ${sprayInbound.sources} sources in ${compressedWindowSec}s ` +
                    `(median ${sprayInbound.medianSol.toFixed(3)} SOL, rel_std ${sprayInbound.relStdDev.toFixed(2)})`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                creatorSeedSol,
                creatorSeedPctOfCurrentLiq,
                inboundSpraySources: sprayInbound.sources,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (
            CONFIG.CREATOR_RISK_SPRAY_OUTBOUND_BLOCK_ENABLED &&
            sprayOutbound.detected
        ) {
            const result = {
                ok: false,
                reason:
                    `spray outbound pattern ${sprayOutbound.transfers} transfers ` +
                    `to ${sprayOutbound.destinations} destinations ` +
                    `(median ${sprayOutbound.medianSol.toFixed(3)} SOL, rel_std ${sprayOutbound.relStdDev.toFixed(2)})`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                creatorSeedSol,
                creatorSeedPctOfCurrentLiq,
            };
            creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            return result;
        }

        if (precreateBurst.detected) {
            const result = {
                ok: false,
                reason:
                    `precreate uniform outbound burst ${precreateBurst.transfers} transfers ` +
                    `to ${precreateBurst.destinations} destinations ` +
                    `(median ${precreateBurst.medianSol.toFixed(3)} SOL, rel_std ${precreateBurst.relStdDev.toFixed(2)})`,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                precreateBurstTransfers: precreateBurst.transfers,
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
            CONFIG.CREATOR_RISK_SPRAY_OUTBOUND_BLOCK_ENABLED &&
            relayFunding.root &&
            isSuspiciousRelayRoot(relayFunding.root, rugHistory) &&
            sprayOutbound.detected
        ) {
            const result = {
                ok: false,
                reason:
                    `spray outbound pattern root=${relayFunding.root} ` +
                    `out=${sprayOutbound.transfers} dest=${sprayOutbound.destinations} ` +
                    `median=${sprayOutbound.medianSol.toFixed(3)} rel_std=${sprayOutbound.relStdDev.toFixed(2)}`,
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
            creatorSeedSol,
            creatorSeedPctOfCurrentLiq,
            inboundSpraySources: sprayInbound.sources,
            precreateBurstTransfers: precreateBurst.transfers,
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

type PaperTradeResult = {
    ok: boolean;
    reason?: string;
    finalStatus?: string;
};

type PaperSimulationOptions = {
    forceHoldMs?: number;
    suppressCreatorRiskRecheck?: boolean;
};

async function maybeRunPaperTradeSimulation(
    connection: Connection,
    poolAddress: string,
    tokenMint: string,
    ctx = "",
    creatorAddress?: string,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
    initialCreatorRisk?: CreatorRiskResult,
    options?: PaperSimulationOptions,
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
        stageLog(ctx, "BUY_QUOTE", `${tokenOutUi.toFixed(6)} token for ${formatSolDecimal(CONFIG.TRADE_AMOUNT_SOL)}`);

        const suspiciousRelay =
            CONFIG.HOLD_SUSPICIOUS_RELAY_SHORT_HOLD_ENABLED &&
            !!initialCreatorRisk?.relayFundingRoot;
        const forcedProbationHoldMs =
            options?.forceHoldMs && Number.isFinite(options.forceHoldMs)
                ? Math.max(1000, options.forceHoldMs)
                : 0;
        const effectiveHoldMs = forcedProbationHoldMs > 0
            ? forcedProbationHoldMs
            : suspiciousRelay
            ? Math.max(1000, CONFIG.HOLD_SUSPICIOUS_RELAY_SHORT_HOLD_MS)
            : Math.max(1000, CONFIG.AUTO_SELL_DELAY_MS);
        if (forcedProbationHoldMs > 0) {
            stageLog(ctx, "HOLD", `probation hold ${effectiveHoldMs}ms (paper creator-risk bypass)`);
        } else if (suspiciousRelay) {
            stageLog(
                ctx,
                "HOLD",
                `suspicious relay root ${shortSig(initialCreatorRisk?.relayFundingRoot || "-")} -> short hold ${effectiveHoldMs}ms`
            );
        }

        const exitState = await waitForExitStateWithLiquidityStop(
            connection,
            poolAddress,
            fetchStateWithRetry,
            entryState,
            tokenMint,
            tokenDecimals,
            tokenOutAtomic,
            ctx,
            effectiveHoldMs,
            !!options?.suppressCreatorRiskRecheck,
            creatorAddress,
            createPoolSignature,
            createPoolBlockTime,
            initialCreatorRisk,
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
            const pnlSol = -CONFIG.TRADE_AMOUNT_SOL;
            const pnlPct = -100;
            stageLog(ctx, "SELL_SPOT", `~${formatSolCompact(0)}/token`);
            stageLog(ctx, "SELL_QUOTE", `${formatSolDecimal(0)} for ${tokenOutUi.toFixed(6)} token`);
            stageLog(ctx, "PNL", `-${formatSolDecimal(Math.abs(pnlSol))} (${pnlPct.toFixed(2)}%)`);
            return { ok: false, reason: "exit returned 0 SOL", finalStatus: "PAPER LOSS" };
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
        stageLog(ctx, "SELL_QUOTE", `${formatSolDecimal(solOut)} for ${tokenOutUi.toFixed(6)} token`);
        stageLog(ctx, "PNL", `${pnlSol >= 0 ? "+" : "-"}${formatSolDecimal(Math.abs(pnlSol))} (${pnlPct.toFixed(2)}%)`);
        if (pnlPct <= -Math.abs(CONFIG.PAPER_TRADE_MAX_LOSS_PCT)) {
            return {
                ok: false,
                reason: `pnl ${pnlPct.toFixed(2)}% <= -${Math.abs(CONFIG.PAPER_TRADE_MAX_LOSS_PCT)}%`,
                finalStatus: "PAPER LOSS",
            };
        }
        return { ok: true };
    } catch (e: any) {
        console.log(`⚠️ PAPER_TRADE failed: ${e.message}`);
        return { ok: false, reason: e?.message || "paper simulation failed" };
    }
}

async function waitForExitStateWithLiquidityStop(
    connection: Connection,
    poolAddress: string,
    fetchStateWithRetry: () => Promise<any | null>,
    entryState: any,
    _tokenMint: string,
    _tokenDecimals: number,
    tokenOutAtomic: BN,
    logPrefix: string,
    holdMs: number,
    suppressCreatorRiskRecheck: boolean,
    creatorAddress?: string,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
    initialCreatorRisk?: CreatorRiskResult,
): Promise<any | null> {
    const startedAtMs = Date.now();
    const deadlineMs = startedAtMs + Math.max(1000, holdMs);
    const pollIntervalMs = Math.max(250, Math.min(CONFIG.HOLD_REMOVE_LIQ_CHECK_INTERVAL_MS, 1500));
    const removeLiqCheckIntervalMs = Math.max(500, CONFIG.HOLD_REMOVE_LIQ_CHECK_INTERVAL_MS);
    const entrySolLiquidity = getSolLiquidityFromState(entryState, _tokenMint) || 0;
    let latestState: any | null = entryState;
    let lastCreatorRiskCheckAtMs = 0;
    let lastRemoveLiqCheckAtMs = 0;
    let lastCreatorOutboundCheckAtMs = 0;
    let lastCreatorOutboundSprayCheckAtMs = 0;
    let lastCreatorInboundSprayCheckAtMs = 0;
    let lastPoolChurnCheckAtMs = 0;
    let lastPoolChurnWarnAtMs = 0;
    const seenPoolSignatures = new Set<string>();
    const seenCreatorSignatures = new Set<string>();
    const seenCreatorSpraySignatures = new Set<string>();
    const seenCreatorInboundSpraySignatures = new Set<string>();
    const creatorAmmTouchTimesSec: number[] = [];
    const creatorOutboundSprayEvents: Array<{ destination: string; sol: number; eventTimeSec: number; signature: string }> = [];
    const creatorInboundSprayEvents: Array<{ source: string; sol: number; eventTimeSec: number; signature: string }> = [];
    const baselineCreatorCashoutSol = Number(initialCreatorRisk?.creatorCashoutSol || 0);
    const baselineExitQuoteSol = getExitQuoteSolFromState(entryState, _tokenMint, tokenOutAtomic);
    if (createPoolSignature) seenPoolSignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorSignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorSpraySignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorInboundSpraySignatures.add(createPoolSignature);

    while (Date.now() < deadlineMs) {
        const s = await fetchStateWithRetry();
        if (s) {
            latestState = s;

            if (
                creatorAddress &&
                !suppressCreatorRiskRecheck &&
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
                    if (suppressCreatorRiskRecheck) {
                        const reason = (creatorRisk.reason || "").toLowerCase();
                        const cashoutDeltaSol = Math.max(
                            0,
                            Number(creatorRisk.creatorCashoutSol || 0) - baselineCreatorCashoutSol
                        );
                        const hardReason =
                            reason.includes("creator cashout") ||
                            reason.includes("creator direct amm re-entry") ||
                            reason.includes("spray outbound") ||
                            reason.includes("micro inbound burst") ||
                            reason.includes("relay funding recent + micro burst");
                        if (cashoutDeltaSol >= CONFIG.HOLD_PROBATION_CASHOUT_DELTA_MIN_SOL || hardReason) {
                            console.log(
                                `⚠️ CREATOR RISK EXIT (probation hard): ${creatorRisk.reason}` +
                                ` (cashout_delta=${cashoutDeltaSol.toFixed(3)} SOL)`
                            );
                            return s;
                        }
                    } else {
                        console.log(`⚠️ CREATOR RISK EXIT: ${creatorRisk.reason}`);
                        return s;
                    }
                }
            }

            if (
                creatorAddress &&
                CONFIG.HOLD_REMOVE_LIQ_DETECT_ENABLED &&
                Date.now() - lastRemoveLiqCheckAtMs >= removeLiqCheckIntervalMs
            ) {
                lastRemoveLiqCheckAtMs = Date.now();
                const removeLiq = await detectRemoveLiquiditySince(
                    connection,
                    poolAddress,
                    creatorAddress,
                    seenPoolSignatures,
                    createPoolSignature,
                    createPoolBlockTime,
                );
                if (removeLiq.detected) {
                    console.log(
                        `⚠️ REMOVE LIQUIDITY EXIT: ` +
                        `${shortSig(removeLiq.signature || "-")} ` +
                        `(wsol_to_creator=${(removeLiq.wsolToCreator || 0).toFixed(3)} ` +
                        `sol_to_creator=${(removeLiq.solToCreator || 0).toFixed(3)} ` +
                        `entry_liq=${entrySolLiquidity.toFixed(2)} SOL)`
                    );
                    return s;
                }
                if (CONFIG.HOLD_CREATOR_AMM_BURST_DETECT_ENABLED && removeLiq.creatorAmmTouch) {
                    const eventTimeSec = removeLiq.eventTimeSec || Math.floor(Date.now() / 1000);
                    creatorAmmTouchTimesSec.push(eventTimeSec);
                    const windowSec = Math.max(1, CONFIG.HOLD_CREATOR_AMM_BURST_WINDOW_SEC);
                    const minTxs = Math.max(2, CONFIG.HOLD_CREATOR_AMM_BURST_MIN_TXS);
                    const cutoff = eventTimeSec - windowSec;
                    while (creatorAmmTouchTimesSec.length && creatorAmmTouchTimesSec[0] < cutoff) {
                        creatorAmmTouchTimesSec.shift();
                    }
                    if (creatorAmmTouchTimesSec.length >= minTxs) {
                        console.log(
                            `⚠️ CREATOR AMM BURST EXIT: ` +
                            `${creatorAmmTouchTimesSec.length} tx in ${windowSec}s ` +
                            `(${shortSig(removeLiq.signature || "-")})`
                        );
                        return s;
                    }
                }
            }

            if (
                CONFIG.HOLD_POOL_CHURN_DETECT_ENABLED &&
                baselineExitQuoteSol &&
                baselineExitQuoteSol > 0 &&
                Date.now() - lastPoolChurnCheckAtMs >= Math.max(500, CONFIG.HOLD_POOL_CHURN_CHECK_INTERVAL_MS)
            ) {
                lastPoolChurnCheckAtMs = Date.now();
                const churn = await getPoolRecentChurnStats(
                    connection,
                    poolAddress,
                    createPoolSignature,
                    Math.max(createPoolBlockTime || 0, Math.floor(startedAtMs / 1000)),
                );
                const currentExitQuoteSol = getExitQuoteSolFromState(s, _tokenMint, tokenOutAtomic);
                if (currentExitQuoteSol && currentExitQuoteSol > 0) {
                    const dropPct = ((baselineExitQuoteSol - currentExitQuoteSol) / baselineExitQuoteSol) * 100;
                    const shortTriggered =
                        churn.shortCount >= Math.max(1, CONFIG.HOLD_POOL_CHURN_TX_SHORT_MIN);
                    const criticalTriggered =
                        churn.criticalCount >= Math.max(1, CONFIG.HOLD_POOL_CHURN_TX_CRITICAL_MIN) &&
                        dropPct >= Math.abs(CONFIG.HOLD_POOL_CHURN_CRITICAL_SELL_DROP_PCT);
                    const longTriggered =
                        churn.longCount >= Math.max(1, CONFIG.HOLD_POOL_CHURN_TX_LONG_MIN) &&
                        dropPct >= Math.abs(CONFIG.HOLD_POOL_CHURN_SELL_DROP_PCT);

                    if (
                        shortTriggered &&
                        Date.now() - lastPoolChurnWarnAtMs >= Math.max(5000, CONFIG.HOLD_POOL_CHURN_WINDOW_SHORT_MS)
                    ) {
                        lastPoolChurnWarnAtMs = Date.now();
                        console.log(
                            `⚠️ POOL CHURN WARN: ${churn.shortCount} tx in ${(CONFIG.HOLD_POOL_CHURN_WINDOW_SHORT_MS / 1000).toFixed(0)}s ` +
                            `(sell_quote ${baselineExitQuoteSol.toFixed(6)} -> ${currentExitQuoteSol.toFixed(6)} SOL, ` +
                            `drop ${dropPct.toFixed(2)}%)`
                        );
                    }

                    if (criticalTriggered || longTriggered) {
                        const windowMs = criticalTriggered
                            ? CONFIG.HOLD_POOL_CHURN_WINDOW_CRITICAL_MS
                            : CONFIG.HOLD_POOL_CHURN_WINDOW_LONG_MS;
                        const txCount = criticalTriggered ? churn.criticalCount : churn.longCount;
                        console.log(
                            `⚠️ POOL CHURN EXIT: ${txCount} tx in ${(windowMs / 1000).toFixed(0)}s ` +
                            `(sell_quote ${baselineExitQuoteSol.toFixed(6)} -> ${currentExitQuoteSol.toFixed(6)} SOL, ` +
                            `drop ${dropPct.toFixed(2)}%)`
                        );
                        return s;
                    }
                }
            }

            if (
                creatorAddress &&
                CONFIG.HOLD_CREATOR_OUTBOUND_EXIT_ENABLED &&
                Date.now() - lastCreatorOutboundCheckAtMs >= Math.max(500, CONFIG.HOLD_CREATOR_OUTBOUND_CHECK_INTERVAL_MS)
            ) {
                lastCreatorOutboundCheckAtMs = Date.now();
                const creatorOutbound = await detectCreatorLargeOutboundSince(
                    connection,
                    creatorAddress,
                    poolAddress,
                    seenCreatorSignatures,
                    createPoolSignature,
                    createPoolBlockTime,
                );
                if (creatorOutbound.detected) {
                    console.log(
                        `⚠️ CREATOR OUTBOUND EXIT: ` +
                        `${shortSig(creatorOutbound.signature || "-")} ` +
                        `(${(creatorOutbound.outboundSol || 0).toFixed(3)} SOL -> ${shortSig(creatorOutbound.destination || "-")})`
                    );
                    return s;
                }
            }

            if (
                creatorAddress &&
                CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_EXIT_ENABLED &&
                Date.now() - lastCreatorOutboundSprayCheckAtMs >= Math.max(500, CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_CHECK_INTERVAL_MS)
            ) {
                lastCreatorOutboundSprayCheckAtMs = Date.now();
                const minBlockTimeSec = Math.max(
                    createPoolBlockTime || 0,
                    Math.floor(startedAtMs / 1000)
                );
                const newEvents = await collectCreatorOutboundTransfersSince(
                    connection,
                    creatorAddress,
                    poolAddress,
                    seenCreatorSpraySignatures,
                    createPoolSignature,
                    minBlockTimeSec,
                );
                if (newEvents.length) {
                    creatorOutboundSprayEvents.push(...newEvents);
                }
                const windowSec = Math.max(5, CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_WINDOW_SEC);
                const nowSec = Math.floor(Date.now() / 1000);
                const cutoff = nowSec - windowSec;
                while (creatorOutboundSprayEvents.length && creatorOutboundSprayEvents[0].eventTimeSec < cutoff) {
                    creatorOutboundSprayEvents.shift();
                }
                const spray = classifyHoldCreatorOutboundSpray(creatorOutboundSprayEvents);
                if (spray.detected) {
                    const latestSig = creatorOutboundSprayEvents[creatorOutboundSprayEvents.length - 1]?.signature || "-";
                    console.log(
                        `⚠️ CREATOR OUTBOUND SPRAY EXIT: ` +
                        `${spray.transfers} transfers to ${spray.destinations} destinations in ${windowSec}s ` +
                        `(median ${spray.medianSol.toFixed(3)} SOL, rel_std ${spray.relStdDev.toFixed(2)}, ` +
                        `ratio ${spray.amountRatio.toFixed(2)}, sig=${shortSig(latestSig)})`
                    );
                    return s;
                }
            }

            if (
                creatorAddress &&
                CONFIG.HOLD_CREATOR_INBOUND_SPRAY_EXIT_ENABLED &&
                Date.now() - lastCreatorInboundSprayCheckAtMs >= Math.max(500, CONFIG.HOLD_CREATOR_INBOUND_SPRAY_CHECK_INTERVAL_MS)
            ) {
                lastCreatorInboundSprayCheckAtMs = Date.now();
                const minBlockTimeSec = Math.max(
                    createPoolBlockTime || 0,
                    Math.floor(startedAtMs / 1000)
                );
                const newEvents = await collectCreatorInboundTransfersSince(
                    connection,
                    creatorAddress,
                    poolAddress,
                    seenCreatorInboundSpraySignatures,
                    createPoolSignature,
                    minBlockTimeSec,
                );
                if (newEvents.length) {
                    creatorInboundSprayEvents.push(...newEvents);
                }
                const windowSec = Math.max(5, CONFIG.HOLD_CREATOR_INBOUND_SPRAY_WINDOW_SEC);
                const nowSec = Math.floor(Date.now() / 1000);
                const cutoff = nowSec - windowSec;
                while (creatorInboundSprayEvents.length && creatorInboundSprayEvents[0].eventTimeSec < cutoff) {
                    creatorInboundSprayEvents.shift();
                }
                const spray = classifyHoldCreatorInboundSpray(creatorInboundSprayEvents);
                if (spray.detected) {
                    const latestSig = creatorInboundSprayEvents[creatorInboundSprayEvents.length - 1]?.signature || "-";
                    console.log(
                        `⚠️ CREATOR INBOUND SPRAY EXIT: ` +
                        `${spray.transfers} transfers from ${spray.sources} sources in ${windowSec}s ` +
                        `(median ${spray.medianSol.toFixed(3)} SOL, rel_std ${spray.relStdDev.toFixed(2)}, ` +
                        `ratio ${spray.amountRatio.toFixed(2)}, sig=${shortSig(latestSig)})`
                    );
                    return s;
                }
            }
        }

        await new Promise(r => setTimeout(r, pollIntervalMs));
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
