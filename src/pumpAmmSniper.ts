import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import bs58 from "bs58";
import { OnlinePumpAmmSdk, PumpAmmSdk, buyQuoteInput, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { AccountLayout, getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction } from "@solana/spl-token";
import { startApp } from "./app/bootstrap";
import { CONFIG, EARLY_ROOT_DIR, IS_WORKER_PROCESS, WORKER_SLOT } from "./app/config";
import { createSupervisorRuntime } from "./app/runtime";
import { runWorkerTask } from "./app/worker";
import {
    CreatorRiskResult,
    PaperSimulationOptions,
    ParsedCreatorRiskTx,
    RugHistory,
} from "./domain/types";
import { createCreatorRiskService } from "./services/creator-risk";
import { createDevHoldingsService } from "./services/dev-holdings";
import { createLiquidityService } from "./services/liquidity";
import { createPaperTradeService } from "./services/paper-trade";
import { calcSpotSolPerToken, getExitQuoteSolFromState, getPoolOrientation, getSolLiquidityFromState, getSpotSolPerTokenFromState } from "./services/paper-trade/quote";
import { patchConsoleWithTimestamp, stageLog } from "./services/reporting/stageLog";
import { createTop10Service } from "./services/top10";
import { checkTokenSecurity, getMintInfoRobust } from "./services/token-security";
import { formatLiquiditySol, formatQuoteMovePct, formatSolCompact, formatSolDecimal } from "./utils/format";
import { instructionAccountToBase58, instructionProgramIdToBase58, pubkeyToBase58, shortSig } from "./utils/pubkeys";

patchConsoleWithTimestamp();

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
const lowLiquidityPools = new Map<string, number>();
let cachedSolPriceUsd: number | null = null;
let cachedSolPriceAtMs = 0;
let cachedRugHistoryAtMs = 0;
let cachedRugHistory: RugHistory | null = null;
const recentFunderCreators = new Map<string, Array<{ creator: string; seenAtMs: number }>>();

const ROOT_DIR = process.cwd();
const PAPER_LOG_PATH = path.join(ROOT_DIR, "paper.log");
const PAPER_REPORT_JSON_PATH = path.join(ROOT_DIR, "logs", "paper-report.json");
const LOW_LIQUIDITY_STATE_PATH = path.join(ROOT_DIR, "logs", "low-liquidity-pools.json");
const BLACKLISTS_DIR = path.join(ROOT_DIR, "blacklists");
const BLACKLIST_CREATORS_PATH = path.join(BLACKLISTS_DIR, "creators.txt");
const BLACKLIST_FUNDERS_PATH = path.join(BLACKLISTS_DIR, "funders.txt");
const BLACKLIST_MICRO_BURST_SOURCES_PATH = path.join(BLACKLISTS_DIR, "micro-burst-sources.txt");
const BLACKLIST_CASHOUT_RELAYS_PATH = path.join(BLACKLISTS_DIR, "cashout-relays.txt");
const BLACKLIST_FUNDER_COUNTS_PATH = path.join(BLACKLISTS_DIR, "funder-counts.json");
const WORKER_LOG_DIR = path.join(ROOT_DIR, "logs");

function readLowLiquidityPoolState(): Record<string, number> {
    try {
        const raw = fs.readFileSync(LOW_LIQUIDITY_STATE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        const out: Record<string, number> = {};
        for (const [pool, ts] of Object.entries(parsed)) {
            if (typeof ts === "number" && Number.isFinite(ts)) {
                out[pool] = ts;
            }
        }
        return out;
    } catch {
        return {};
    }
}

function writeLowLiquidityPoolState(state: Record<string, number>) {
    fs.mkdirSync(path.dirname(LOW_LIQUIDITY_STATE_PATH), { recursive: true });
    fs.writeFileSync(LOW_LIQUIDITY_STATE_PATH, JSON.stringify(state));
}

function pruneLowLiquidityPoolState(nowMs: number, cooldownMs: number): Record<string, number> {
    const state = readLowLiquidityPoolState();
    if (cooldownMs <= 0) return state;
    let changed = false;
    for (const [pool, ts] of Object.entries(state)) {
        if (nowMs - ts > cooldownMs) {
            delete state[pool];
            changed = true;
        }
    }
    if (changed) {
        writeLowLiquidityPoolState(state);
    }
    return state;
}

function getWorkerEntryCommand(): { cmd: string; args: string[] } {
    const distEntry = path.join(ROOT_DIR, "dist", "pumpAmmSniper.js");
    if (fs.existsSync(distEntry)) {
        return { cmd: process.execPath, args: [distEntry] };
    }
    return { cmd: "npx", args: ["ts-node", "src/pumpAmmSniper.ts"] };
}

function isRateLimitedMessage(message?: string): boolean {
    const normalized = (message || "").toLowerCase();
    return (
        normalized.includes("429 too many requests") ||
        normalized.includes("rate limited") ||
        normalized.includes("server responded with 429")
    );
}

// Initialize SDKs
let onlineSdk: OnlinePumpAmmSdk;
let offlineSdk: PumpAmmSdk;

function createRuntimeConnection() {
    const rpcEndpoint = process.env.SVS_UNSTAKED_RPC || "https://api.mainnet-beta.solana.com";
    return new Connection(rpcEndpoint, { commitment: "confirmed" });
}

function describeRpcEndpoint(): string {
    const rpcEndpoint = process.env.SVS_UNSTAKED_RPC || "https://api.mainnet-beta.solana.com";
    try {
        const parsed = new URL(rpcEndpoint);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
        return rpcEndpoint;
    }
}

function initSdks(connection: Connection) {
    onlineSdk = new OnlinePumpAmmSdk(connection);
    offlineSdk = new PumpAmmSdk();
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
        let fallbackPoolAddress: string | null = null;
        let fallbackTokenMint: string | null = null;
        let fallbackCreatorAddress: string | null = null;
        for (const ix of instructions) {
            // Check if this instruction is to the Pump AMM program
            const programId = instructionProgramIdToBase58(ix, accountKeys);
            
            if (programId === PUMPFUN_AMM_PROGRAM_ID) {
                const ixAccounts = Array.isArray(ix.accounts) ? ix.accounts : [];
                stageLog(ctx, "TX", `pump-amm instruction accounts=${ixAccounts.length}`);
                // Extract accounts based on IDL order: pool=0, creator=2, base_mint=3, quote_mint=4
                if (ixAccounts.length >= 5) {
                    const candidatePool = instructionAccountToBase58(ixAccounts[0], accountKeys);
                    const candidateCreator = instructionAccountToBase58(ixAccounts[2], accountKeys);
                    const candidateBaseMint = instructionAccountToBase58(ixAccounts[3], accountKeys);
                    const candidateQuoteMint = instructionAccountToBase58(ixAccounts[4], accountKeys);

                    if (!fallbackPoolAddress && candidatePool) fallbackPoolAddress = candidatePool;
                    if (!fallbackCreatorAddress && candidateCreator) fallbackCreatorAddress = candidateCreator;
                    if (!fallbackTokenMint && candidateBaseMint && candidateBaseMint !== WSOL) fallbackTokenMint = candidateBaseMint;

                    if (candidatePool && candidateBaseMint && candidateQuoteMint === WSOL) {
                        poolAddress = candidatePool;
                        tokenMint = candidateBaseMint;
                        creatorAddress = candidateCreator;
                        break;
                    }
                }
            }
        }

        if (!poolAddress && fallbackPoolAddress) poolAddress = fallbackPoolAddress;
        if (!tokenMint && fallbackTokenMint) tokenMint = fallbackTokenMint;
        if (!creatorAddress && fallbackCreatorAddress) creatorAddress = fallbackCreatorAddress;
        if (creatorAddress) {
            stageLog(ctx, "CREATOR", creatorAddress);
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
                const txSigner = pubkeyToBase58(tx.transaction.message.accountKeys[0]);
                const poolBalance = balances.find((b: any) => b.mint === WSOL && b.owner !== txSigner);
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

        const nowMs = Date.now();
        const lowLiqCooldownMs = Math.max(0, CONFIG.LOW_LIQUIDITY_POOL_COOLDOWN_MS);
        if (lowLiqCooldownMs > 0) {
            for (const [pool, atMs] of lowLiquidityPools.entries()) {
                if (nowMs - atMs > lowLiqCooldownMs) {
                    lowLiquidityPools.delete(pool);
                }
            }
            const persistedState = pruneLowLiquidityPoolState(nowMs, lowLiqCooldownMs);
            const recentLowAt = Math.max(
                lowLiquidityPools.get(poolAddress) || 0,
                persistedState[poolAddress] || 0,
            );
            if (recentLowAt && nowMs - recentLowAt <= lowLiqCooldownMs) {
                stageLog(ctx, "LIQ", `pool recently low-liq (${Math.round((nowMs - recentLowAt) / 1000)}s ago), cooldown`);
                finalStatus = "IGNORED: repeated low-liquidity pool";
                return;
            }
        }

        // Always require a creator address (fail-closed).
        // If not present in tx accounts, resolve it from on-chain pool state.
        if (!creatorAddress) {
            creatorAddress = await resolveCreatorFromPool(connection, poolAddress);
            if (creatorAddress) {
                stageLog(ctx, "CREATOR", `resolved ${creatorAddress}`);
            }
        }

        if (!creatorAddress) {
            if (!CONFIG.CREATOR_RESOLUTION_FAIL_OPEN) {
                console.log(`🛑 SKIP: creator not resolvable`);
                finalStatus = "SKIP: creator unresolved";
                return;
            }
            stageLog(ctx, "CREATOR", "unresolved (fail-open)");
        }

        stageLog(ctx, "STEP 3/7", "liquidity check");
        // Check liquidity from on-chain pool state (preferred) with retries, then tx fallback.
        let liquiditySOL = 0;
        const observerUser = walletKeypair?.publicKey ?? Keypair.generate().publicKey;
        const poolKey = new PublicKey(poolAddress);
        for (let i = 0; i < 6; i++) {
            try {
                const poolState = await onlineSdk.swapSolanaState(poolKey, observerUser);
                const orientation = getPoolOrientation(poolState, tokenMint);
                if (!orientation.hasWsol) {
                    stageLog(ctx, "LIQ", "pool has no WSOL side");
                    console.log(`🛑 SKIP: pool has no WSOL side`);
                    finalStatus = "SKIP: no WSOL side";
                    return;
                }
                const liq = getSolLiquidityFromState(poolState, tokenMint);
                if (liq !== null && liq > 0) {
                    liquiditySOL = liq;
                    break;
                }
            } catch {
                // pool may not be indexable yet, retry shortly
            }
            await new Promise((r) => setTimeout(r, 250));
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
                // Last-resort fallback: derive pool index from accountKeys, not from instruction[0]
                // (instruction[0] is often ComputeBudget and has no pool account).
                const poolAccountIndex = accountKeys.findIndex((k: any) => pubkeyToBase58(k) === poolAddress);
                if (poolAccountIndex >= 0) {
                    const poolLamports = tx.meta.postBalances?.[poolAccountIndex] || 0;
                    liquiditySOL = poolLamports / 1e9;
                }
            }
        }

        const solPriceUsd = await getSolPriceUsd();
        let liquidityUSD: number | null = null;
        const creatorSeedSol = creatorAddress ? extractCreatorSeedSolFromCreateTx(tx, creatorAddress) : 0;
        const liqSolFmt = formatLiquiditySol(liquiditySOL);
        if (solPriceUsd !== null) {
            liquidityUSD = liquiditySOL * solPriceUsd;
            stageLog(ctx, "LIQ", `${liqSolFmt} SOL (~$${liquidityUSD.toFixed(0)})`);
        } else {
            stageLog(ctx, "LIQ", `${liqSolFmt} SOL (USD unavailable)`);
        }

        if (liquiditySOL < CONFIG.MIN_POOL_LIQUIDITY_SOL) {
            liquiditySOL = await liquidityService.recheckLowLiquidity(poolAddress, tokenMint, ctx, liquiditySOL);
        }

        const failedSolThreshold = liquiditySOL < CONFIG.MIN_POOL_LIQUIDITY_SOL;
        if (failedSolThreshold) {
            const markedAtMs = Date.now();
            lowLiquidityPools.set(poolAddress, markedAtMs);
            const persistedState = pruneLowLiquidityPoolState(markedAtMs, lowLiqCooldownMs);
            persistedState[poolAddress] = markedAtMs;
            writeLowLiquidityPoolState(persistedState);
            const liqSolFinalFmt = formatLiquiditySol(liquiditySOL);
            if (solPriceUsd !== null) {
                liquidityUSD = liquiditySOL * solPriceUsd;
            }
            const usdPart = liquidityUSD !== null ? `$${liquidityUSD.toFixed(0)}` : "USD N/A";
            console.log(
                `🛑 SKIP: Liquidity too low ` +
                `(${liqSolFinalFmt} SOL / ${usdPart}; ` +
                `min ${CONFIG.MIN_POOL_LIQUIDITY_SOL} SOL)`
            );
            finalStatus = "SKIP: low liquidity";
            return;
        }
        lowLiquidityPools.delete(poolAddress);
        if (lowLiqCooldownMs > 0) {
            const persistedState = pruneLowLiquidityPoolState(Date.now(), lowLiqCooldownMs);
            if (persistedState[poolAddress]) {
                delete persistedState[poolAddress];
                writeLowLiquidityPoolState(persistedState);
            }
        }

        stageLog(ctx, "STEP 4/7", "mint/freeze security");
        // 🛡️ SAFETY CHECKS
        const isSafe = await checkTokenSecurity(connection, tokenMint);
        if (!isSafe) {
            console.log(`🛑 SKIP: Token failed safety checks.`);
            finalStatus = "SKIP: token security";
            return;
        }

        let creatorRisk: CreatorRiskResult = { ok: true, reason: "creator unresolved (fail-open)" };
        stageLog(ctx, "STEP 5/7", "creator risk");
        if (creatorAddress) {
            creatorRisk = await creatorRiskService.runCheckWithRetry(connection, creatorAddress, ctx, {
                entrySolLiquidity: liquiditySOL,
                createPoolSignature: signature,
                createPoolBlockTime: tx.blockTime || null,
                creatorSeedSol,
                allowFastPathOnDeepTimeout: MONITOR_ONLY,
                deepCheckBudgetMs: CONFIG.CREATOR_RISK_DEEP_CHECK_BUDGET_MS,
            });
        } else {
            stageLog(ctx, "CRISK", "skipped (creator unresolved + fail-open)");
        }
        const creatorRiskProbationForbidden = creatorRisk.transientError ? false : creatorRiskService.isProbationBypassForbidden(creatorRisk);
        let creatorRiskProbation = false;
        let creatorRiskProbationHoldMs = Math.max(1000, CONFIG.PAPER_CREATOR_RISK_PROBATION_HOLD_MS);
        if (!creatorRisk.ok) {
            if (
                MONITOR_ONLY &&
                CONFIG.PAPER_CREATOR_RISK_PROBATION_ENABLED &&
                !creatorRiskProbationForbidden
            ) {
                creatorRiskProbation = true;
                creatorRiskProbationHoldMs = creatorRiskService.getProbationHoldMs(creatorRisk.reason);
                stageLog(
                    ctx,
                    "PROBATION",
                    `paper-only bypass creator risk (${creatorRisk.reason || "unknown"}) ` +
                    `hold=${creatorRiskProbationHoldMs}ms`
                );
            } else {
                if (
                    creatorRiskProbationForbidden &&
                    Number(creatorRisk.creatorCashoutPctOfEntryLiquidity || 0) >= CONFIG.PAPER_CREATOR_RISK_EXTREME_CASHOUT_MIN_PCT_OF_LIQ
                ) {
                    stageLog(
                        ctx,
                        "RISK",
                        `extreme creator cashout ${Number(creatorRisk.creatorCashoutPctOfEntryLiquidity || 0).toFixed(2)}% liq ` +
                        `(score ${Number(creatorRisk.creatorCashoutScore || 0).toFixed(2)})`
                    );
                }
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
            const top10 = await top10Service.runCheck(connection, tokenMint, poolAddress, ctx);
            if (!top10.ok) {
                console.log(`🛑 SKIP: pre-buy top10 (${top10.reason})`);
                finalStatus = "SKIP: pre-buy top10";
                return;
            }
            stageLog(ctx, "STEP 6/7", "paper simulation");
            const paper = await paperTradeService.runSimulation(
                connection,
                poolAddress,
                tokenMint,
                liquiditySOL,
                ctx,
                creatorAddress || undefined,
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
            if (creatorAddress) {
                const devCheckOk = await devHoldingsService.runCheck(connection, creatorAddress, tokenMint, postTokenBalances, ctx, false);
                if (devCheckOk) {
                    console.log(`✅ Checks passed`);
                }
            } else {
                stageLog(ctx, "DEV", "skipped (creator unresolved + fail-open)");
                console.log(`✅ Checks passed`);
            }
            stageLog(ctx, "MODE", "MONITOR_ONLY no live trade");
            return;
        }

        if (creatorAddress) {
            const devCheckOk = await devHoldingsService.runCheck(connection, creatorAddress, tokenMint, postTokenBalances, ctx, true);
            if (!devCheckOk) {
                finalStatus = "SKIP: dev holdings";
                return;
            }
        } else {
            stageLog(ctx, "DEV", "skipped (creator unresolved + fail-open)");
        }

        if (CONFIG.PRE_BUY_WAIT_MS > 0) {
            const preEntry = await preEntryWaitAndCheck(connection, signature, poolAddress, tokenMint, liquiditySOL, ctx);
            if (!preEntry.ok) {
                console.log(`🛑 SKIP: pre-entry guard (${preEntry.reason})`);
                finalStatus = "SKIP: pre-entry guard";
                return;
            }
        }
        const top10 = await top10Service.runCheck(connection, tokenMint, poolAddress, ctx);
        if (!top10.ok) {
            console.log(`🛑 SKIP: pre-buy top10 (${top10.reason})`);
            finalStatus = "SKIP: pre-buy top10";
            return;
        }

        if (CONFIG.PRE_BUY_REVALIDATION_ENABLED) {
            let tokenDecimals = 6;
            try {
                tokenDecimals = (await getMintInfoRobust(connection, new PublicKey(tokenMint))).decimals;
            } catch {
                // fallback
            }
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
            const preBuy = await paperTradeService.validatePreBuy(
                connection,
                fetchStateWithRetry,
                tokenMint,
                tokenDecimals,
                buyAmountLamports,
                liquiditySOL,
                ctx,
                creatorAddress || undefined,
                poolAddress,
                signature,
                tx.blockTime || null,
            );
            if (!preBuy.ok) {
                console.log(`🛑 SKIP: pre-buy revalidation (${preBuy.reason})`);
                finalStatus = "SKIP: pre-buy revalidation";
                return;
            }
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
    const observerUser = walletKeypair?.publicKey ?? Keypair.generate().publicKey;
    const poolKey = new PublicKey(poolAddress);
    for (let i = 0; i < 8; i++) {
        try {
            const state = await onlineSdk.swapSolanaState(poolKey, observerUser);
            const creator = pubkeyToBase58(state?.pool?.creator);
            if (creator) return creator;
        } catch {
            // pool may not be immediately indexable after creation
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    return null;
}

async function waitForFirstPoolTrade(
    connection: Connection,
    createSignature: string,
    poolAddress: string,
    ctx: string,
): Promise<{ firstTradeAtMs: number } | null> {
    if (CONFIG.PRE_BUY_WAIT_MS <= 0) return null;

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
                stageLog(
                    ctx,
                    "WAIT",
                    `first trade ${shortSig(firstTrade.signature)} seen, starting flow gate`
                );
                return { firstTradeAtMs };
            }
        } catch (e: any) {
            stageLog(ctx, "WAIT", `first trade lookup retry (${e?.message || "unknown error"})`);
        }

        await new Promise(r => setTimeout(r, 500));
    }
}

async function waitForPreEntryFlowSignal(
    connection: Connection,
    createSignature: string,
    poolAddress: string,
    tokenMint: string,
    ctx: string,
): Promise<{ ok: boolean; reason?: string }> {
    const windowMs = Math.max(0, CONFIG.PRE_BUY_WAIT_MS);
    if (windowMs <= 0) return { ok: true };

    const observerUser = walletKeypair?.publicKey ?? Keypair.generate().publicKey;
    const poolKey = new PublicKey(poolAddress);
    const buyAmountLamports = new BN(Math.floor(CONFIG.TRADE_AMOUNT_SOL * 1e9));
    const deadlineMs = Date.now() + windowMs;
    const pollMs = Math.max(100, CONFIG.PRE_BUY_CONFIRM_INTERVAL_MS);
    const minTrades = Math.max(1, CONFIG.PRE_BUY_SIGNAL_MIN_TRADES);
    const minQuoteImprovementPct = CONFIG.PRE_BUY_SIGNAL_MIN_QUOTE_IMPROVEMENT_PCT;

    let baselineExitQuoteSol: number | null = null;
    let baselineTokenOutAtomic: BN | null = null;

    while (Date.now() <= deadlineMs) {
        const signatures = await connection.getSignaturesForAddress(poolKey, { limit: Math.max(20, minTrades + 5) }, "confirmed");
        const tradeCount = signatures.filter((s: any) => s.signature !== createSignature).length;

        const state = await onlineSdk.swapSolanaState(poolKey, observerUser);
        const orientation = getPoolOrientation(state, tokenMint);
        if (!orientation.hasWsol) {
            return { ok: false, reason: "pool has no WSOL side on pre-entry flow gate" };
        }

        if (!baselineTokenOutAtomic) {
            baselineTokenOutAtomic = orientation.solIsBase
                ? sellBaseInput({
                    base: buyAmountLamports,
                    slippage: CONFIG.SLIPPAGE_PERCENT,
                    baseReserve: state.poolBaseAmount,
                    quoteReserve: state.poolQuoteAmount,
                    baseMintAccount: state.baseMintAccount,
                    baseMint: state.baseMint,
                    coinCreator: state.pool.coinCreator,
                    creator: state.pool.creator,
                    feeConfig: state.feeConfig,
                    globalConfig: state.globalConfig,
                }).uiQuote
                : buyQuoteInput({
                    quote: buyAmountLamports,
                    slippage: CONFIG.SLIPPAGE_PERCENT,
                    baseReserve: state.poolBaseAmount,
                    quoteReserve: state.poolQuoteAmount,
                    baseMintAccount: state.baseMintAccount,
                    baseMint: state.baseMint,
                    coinCreator: state.pool.coinCreator,
                    creator: state.pool.creator,
                    feeConfig: state.feeConfig,
                    globalConfig: state.globalConfig,
                }).base;
            baselineExitQuoteSol = getExitQuoteSolFromState(state, tokenMint, baselineTokenOutAtomic);
        }

        const currentExitQuoteSol =
            baselineTokenOutAtomic && baselineExitQuoteSol !== null
                ? getExitQuoteSolFromState(state, tokenMint, baselineTokenOutAtomic)
                : null;

        if (
            baselineExitQuoteSol !== null &&
            baselineExitQuoteSol > 0 &&
            currentExitQuoteSol !== null &&
            currentExitQuoteSol > 0
        ) {
            const improvementPct = ((currentExitQuoteSol - baselineExitQuoteSol) / baselineExitQuoteSol) * 100;
            if (improvementPct >= minQuoteImprovementPct) {
                stageLog(
                    ctx,
                    "WAIT",
                    `pre-entry flow ok: sell_quote ${baselineExitQuoteSol.toFixed(6)} -> ${currentExitQuoteSol.toFixed(6)} SOL ` +
                    `(${formatQuoteMovePct(baselineExitQuoteSol, currentExitQuoteSol)}, trades=${tradeCount})`
                );
                return { ok: true };
            }
        }

        if (tradeCount >= minTrades) {
            stageLog(ctx, "WAIT", `pre-entry flow ok: ${tradeCount} pool trades seen (min ${minTrades})`);
            return { ok: true };
        }

        await new Promise((r) => setTimeout(r, pollMs));
    }

    return {
        ok: false,
        reason: `no quote improvement and only < ${minTrades} pool trades within ${windowMs}ms`,
    };
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

    const flowSignal = await waitForPreEntryFlowSignal(connection, createSignature, poolAddress, tokenMint, ctx);
    if (!flowSignal.ok) {
        return { ok: false, reason: flowSignal.reason || "pre-entry flow gate failed", currentLiquiditySol: baselineLiquiditySol };
    }

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

async function fetchParsedTransactionsForSignatures(
    connection: Connection,
    signatures: Array<{ signature: string; blockTime?: number | null }>,
): Promise<Array<{ signature: string; blockTime: number | null; tx: any }>> {
    const results = await Promise.all(
        signatures.map(async (sig) => {
            try {
                const tx = await connection.getParsedTransaction(sig.signature, {
                    maxSupportedTransactionVersion: 0,
                    commitment: "confirmed",
                });
                if (!tx) return null;
                return {
                    signature: sig.signature,
                    blockTime: sig.blockTime ?? tx.blockTime ?? null,
                    tx,
                };
            } catch {
                return null;
            }
        })
    );

    return results.filter((item): item is { signature: string; blockTime: number | null; tx: any } => !!item);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ timedOut: boolean; value?: T }> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return promise.then((value) => ({ timedOut: false, value }));
    }

    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
        promise
            .then((value) => {
                clearTimeout(timer);
                resolve({ timedOut: false, value });
            })
            .catch(() => {
                clearTimeout(timer);
                resolve({ timedOut: true });
            });
    });
}

async function classifyCreatorCashoutRisk(
    connection: Connection,
    creatorAddress: string,
    funder: string | null,
    outboundTransfers: Array<{ destination: string; sol: number }>,
    entrySolLiquidity?: number,
    excludedDestinations?: Set<string>,
): Promise<{ totalSol: number; maxSingleSol: number; pctOfEntryLiquidity: number; score: number; destination: string | null }> {
    if (!outboundTransfers.length) {
        return { totalSol: 0, maxSingleSol: 0, pctOfEntryLiquidity: 0, score: 0, destination: null };
    }

    const merged = new Map<string, number>();
    for (const transfer of outboundTransfers) {
        if (!transfer.destination || transfer.destination === creatorAddress) continue;
        if (excludedDestinations?.has(transfer.destination)) continue;
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
    const positive = outboundTransfers.filter(
        (t) =>
            Number.isFinite(t.sol) &&
            t.sol >= CONFIG.CREATOR_RISK_PRECREATE_BURST_MIN_TRANSFER_SOL
    );
    if (!positive.length) {
        return {
            detected: false,
            transfers: 0,
            destinations: 0,
            medianSol: 0,
            totalSol: 0,
            relStdDev: Infinity,
            amountRatio: Infinity,
        };
    }

    const values = positive.map((t) => t.sol).sort((a, b) => a - b);
    const destinations = new Set(positive.map((t) => t.destination)).size;
    const totalSol = values.reduce((sum, v) => sum + v, 0);
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
        totalSol >= CONFIG.CREATOR_RISK_PRECREATE_BURST_MIN_TOTAL_SOL &&
        medianSol >= CONFIG.CREATOR_RISK_PRECREATE_BURST_MIN_MEDIAN_SOL &&
        medianSol <= CONFIG.CREATOR_RISK_PRECREATE_BURST_MAX_MEDIAN_SOL &&
        relStdDev <= CONFIG.CREATOR_RISK_PRECREATE_BURST_MAX_REL_STDDEV &&
        amountRatio <= CONFIG.CREATOR_RISK_PRECREATE_BURST_MAX_AMOUNT_RATIO;

    return {
        detected,
        transfers: positive.length,
        destinations,
        medianSol,
        totalSol,
        relStdDev,
        amountRatio,
    };
}

async function collectPrecreateCreatorRiskTxs(
    connection: Connection,
    creatorAddress: string,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
    prefetchedCreatorRiskTxs: ParsedCreatorRiskTx[] = [],
): Promise<ParsedCreatorRiskTx[]> {
    if (!createPoolSignature || !createPoolBlockTime || !CONFIG.CREATOR_RISK_PRECREATE_BURST_BLOCK_ENABLED) {
        return [];
    }

    try {
        const windowSec = Math.max(1, CONFIG.CREATOR_RISK_PRECREATE_BURST_WINDOW_SEC);
        const prefetchedInWindow = prefetchedCreatorRiskTxs
            .filter((parsed) => {
                const blockTime = parsed.blockTime || 0;
                return !!blockTime && blockTime <= createPoolBlockTime && createPoolBlockTime - blockTime <= windowSec;
            });

        const sigs = await connection.getSignaturesForAddress(
            new PublicKey(creatorAddress),
            {
                limit: Math.max(20, CONFIG.CREATOR_RISK_PRECREATE_BURST_SIG_LIMIT),
                before: createPoolSignature,
            },
            "confirmed",
        );
        const parseLimit = Math.max(5, CONFIG.CREATOR_RISK_PRECREATE_BURST_PARSED_TX_LIMIT);
        const candidates = sigs
            .filter((s) => !s.err && !!s.blockTime)
            .filter((s) => {
                const t = s.blockTime || 0;
                return t <= createPoolBlockTime && createPoolBlockTime - t <= windowSec;
            })
            .sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0))
            .filter((s) => !prefetchedInWindow.some((parsed) => parsed.signature === s.signature))
            .slice(-parseLimit);

        const parsedCandidates = await fetchParsedTransactionsForSignatures(connection, candidates);
        const bySig = new Map<string, ParsedCreatorRiskTx>();
        for (const entry of [...prefetchedInWindow, ...parsedCandidates]) {
            bySig.set(entry.signature, entry);
        }
        return [...bySig.values()].sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0));
    } catch {
        return [];
    }
}

async function collectPrecreateOutboundTransfers(
    connection: Connection,
    creatorAddress: string,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
    prefetchedCreatorRiskTxs: ParsedCreatorRiskTx[] = [],
): Promise<Array<{ destination: string; sol: number }>> {
    try {
        const precreateEntries = await collectPrecreateCreatorRiskTxs(
            connection,
            creatorAddress,
            createPoolSignature,
            createPoolBlockTime,
            prefetchedCreatorRiskTxs,
        );
        const outboundTransfers: Array<{ destination: string; sol: number }> = [];
        for (const parsed of precreateEntries) {
            const noopCounterparties = new Set<string>();
            const noopLinks = new Set<string>();
            const outer = walkParsedInstructions(
                parsed.tx.transaction?.message?.instructions,
                creatorAddress,
                noopCounterparties,
                noopLinks,
                new Set<string>(),
            );
            outboundTransfers.push(...outer.outboundTransfers);

            for (const inner of parsed.tx.meta?.innerInstructions || []) {
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

function isRemoveLiquidityLikeTx(
    tx: any,
    creatorAddress: string,
    poolAddress: string,
    tokenMint?: string,
): {
    detected: boolean;
    wsolToCreator: number;
    solToCreator: number;
    tokenToCreator: number;
    creatorAmmTouch: boolean;
} {
    const touchesPumpAmm = flattenParsedInstructions(tx).some((ix) =>
        instructionProgramIdMatches(ix, PUMPFUN_AMM_PROGRAM_ID)
    );
    const touchesPool = txTouchesAddress(tx, poolAddress);
    const touchesCreator = txTouchesAddress(tx, creatorAddress);
    const creatorAmmTouch = touchesPumpAmm && touchesPool && touchesCreator;
    if (!creatorAmmTouch) {
        return { detected: false, wsolToCreator: 0, solToCreator: 0, tokenToCreator: 0, creatorAmmTouch: false };
    }

    const wsolToCreator = getOwnerMintDelta(tx, creatorAddress, WSOL);
    const solToCreator = getSystemInboundSolToCreator(tx, creatorAddress);
    const tokenToCreator = tokenMint ? getOwnerMintDelta(tx, creatorAddress, tokenMint) : 0;
    const detected =
        wsolToCreator >= CONFIG.HOLD_REMOVE_LIQ_MIN_WSOL_TO_CREATOR ||
        solToCreator >= CONFIG.HOLD_REMOVE_LIQ_MIN_SOL_TO_CREATOR ||
        tokenToCreator > 0;

    return { detected, wsolToCreator, solToCreator, tokenToCreator, creatorAmmTouch };
}

type CreatorRepeatPatternRisk = {
    detected: boolean;
    creates: number;
    removes: number;
    cashouts: number;
    windowSec: number | null;
    maxCashoutSol: number;
    signatures: string[];
};

function getCreatorTxFlowSummary(tx: any, creatorAddress: string): {
    solOutSol: number;
    solInSol: number;
    outboundTransfers: Array<{ destination: string; sol: number }>;
} {
    const empty = new Set<string>();
    const outer = walkParsedInstructions(tx?.transaction?.message?.instructions, creatorAddress, empty, empty, empty);
    const innerParts = (tx?.meta?.innerInstructions || []).map((inner: any) =>
        walkParsedInstructions(inner.instructions, creatorAddress, empty, empty, empty)
    );

    let solOutSol = outer.solOutSol;
    let solInSol = outer.solInSol;
    const outboundTransfers = [...outer.outboundTransfers];

    for (const inner of innerParts) {
        solOutSol += inner.solOutSol;
        solInSol += inner.solInSol;
        outboundTransfers.push(...inner.outboundTransfers);
    }

    return { solOutSol, solInSol, outboundTransfers };
}

function classifyRecentCreateRemovePattern(
    entries: ParsedCreatorRiskTx[],
    creatorAddress: string,
    options: {
        currentCreatePoolSignature?: string;
        currentCreatePoolBlockTime?: number | null;
    } = {},
): CreatorRepeatPatternRisk {
    if (!CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_BLOCK_ENABLED) {
        return {
            detected: false,
            creates: 0,
            removes: 0,
            cashouts: 0,
            windowSec: null,
            maxCashoutSol: 0,
            signatures: [],
        };
    }

    const anchorTime =
        options.currentCreatePoolBlockTime ??
        (entries.reduce((max, entry) => Math.max(max, entry.blockTime || 0), 0) || null);
    if (!anchorTime) {
        return {
            detected: false,
            creates: 0,
            removes: 0,
            cashouts: 0,
            windowSec: null,
            maxCashoutSol: 0,
            signatures: [],
        };
    }

    const minTime = anchorTime - CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_WINDOW_SEC;
    const recentEntries = entries
        .filter((entry) => entry.blockTime && entry.blockTime >= minTime && entry.blockTime <= anchorTime)
        .sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0));

    let creates = 0;
    let removes = 0;
    let cashouts = 0;
    let maxCashoutSol = 0;
    const signatures: string[] = [];

    for (const entry of recentEntries) {
        const tx = entry.tx;
        const touchesPumpAmm = flattenParsedInstructions(tx).some((ix) =>
            instructionProgramIdMatches(ix, PUMPFUN_AMM_PROGRAM_ID)
        );
        const { solOutSol, solInSol, outboundTransfers } = getCreatorTxFlowSummary(tx, creatorAddress);
        const wsolDelta = getOwnerMintDelta(tx, creatorAddress, WSOL);
        const maxOutboundSol = outboundTransfers.reduce((max, transfer) => Math.max(max, transfer.sol), 0);

        const isCreateLike =
            touchesPumpAmm &&
            (
                entry.signature === options.currentCreatePoolSignature ||
                solOutSol >= CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_MIN_CREATE_SOL ||
                Math.abs(Math.min(wsolDelta, 0)) >= CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_MIN_CREATE_SOL
            );
        const isRemoveLike =
            touchesPumpAmm &&
            (
                wsolDelta >= CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_MIN_REMOVE_SOL ||
                solInSol >= CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_MIN_REMOVE_SOL
            );
        const isCashoutLike =
            !touchesPumpAmm &&
            maxOutboundSol >= CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_MIN_CASHOUT_SOL;

        if (isCreateLike) {
            creates += 1;
            signatures.push(entry.signature);
        }
        if (isRemoveLike) {
            removes += 1;
            signatures.push(entry.signature);
        }
        if (isCashoutLike) {
            cashouts += 1;
            maxCashoutSol = Math.max(maxCashoutSol, maxOutboundSol);
            signatures.push(entry.signature);
        }
    }

    const uniqueSignatures = [...new Set(signatures)];
    const detected =
        creates >= CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_MIN_CREATES &&
        removes >= CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_MIN_REMOVES &&
        cashouts >= CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_MIN_CASHOUTS;

    return {
        detected,
        creates,
        removes,
        cashouts,
        windowSec: CONFIG.CREATOR_RISK_REPEAT_CREATE_REMOVE_WINDOW_SEC,
        maxCashoutSol,
        signatures: uniqueSignatures,
    };
}

async function detectRemoveLiquiditySince(
    connection: Connection,
    poolAddress: string,
    creatorAddress: string,
    tokenMint: string,
    seenSignatures: Set<string>,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
): Promise<{
    detected: boolean;
    signature?: string;
    wsolToCreator?: number;
    solToCreator?: number;
    tokenToCreator?: number;
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

            const m = isRemoveLiquidityLikeTx(tx, creatorAddress, poolAddress, tokenMint);
            if (m.detected) {
                return {
                    detected: true,
                    signature: s.signature,
                    wsolToCreator: m.wsolToCreator,
                    solToCreator: m.solToCreator,
                    tokenToCreator: m.tokenToCreator,
                    creatorAmmTouch: m.creatorAmmTouch,
                    eventTimeSec,
                };
            }

            if (m.creatorAmmTouch) {
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

async function collectCreatorCloseAccountEventsSince(
    connection: Connection,
    creatorAddress: string,
    seenSignatures: Set<string>,
    createPoolSignature?: string,
    minBlockTimeSec?: number | null,
): Promise<Array<{ closeCount: number; eventTimeSec: number; signature: string }>> {
    const events: Array<{ closeCount: number; eventTimeSec: number; signature: string }> = [];

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

            const feePayer = tx?.transaction?.message?.accountKeys?.[0]?.pubkey?.toBase58?.()
                || tx?.transaction?.message?.accountKeys?.[0]?.pubkey
                || null;
            if (feePayer !== creatorAddress) continue;

            let closeCount = 0;
            for (const ix of flattenParsedInstructions(tx)) {
                const parsed = ix?.parsed;
                const type = String(parsed?.type || "").toLowerCase();
                if (type === "closeaccount" || type === "close_account") {
                    closeCount += 1;
                }
            }

            if (closeCount > 0) {
                events.push({
                    closeCount,
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

function classifyHoldCreatorCloseAccountBurst(
    closeEvents: Array<{ closeCount: number; signature: string }>
) {
    const positive = closeEvents.filter((e) => Number.isFinite(e.closeCount) && e.closeCount > 0);
    const totalCloseCount = positive.reduce((sum, e) => sum + e.closeCount, 0);

    return {
        detected:
            positive.length >= Math.max(1, CONFIG.HOLD_CREATOR_CLOSE_ACCOUNT_BURST_MIN_TXS) &&
            totalCloseCount >= Math.max(1, CONFIG.HOLD_CREATOR_CLOSE_ACCOUNT_BURST_MIN_CLOSES),
        txCount: positive.length,
        totalCloseCount,
        latestSignature: positive[positive.length - 1]?.signature || "-",
    };
}

async function detectCreatorDirectAmmReentry(
    connection: Connection,
    creatorAddress: string,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
    prefetchedCreatorRiskTxs: ParsedCreatorRiskTx[] = [],
): Promise<{ detected: boolean; signature: string | null; blockTime: number | null }> {
    if (!CONFIG.CREATOR_RISK_DIRECT_AMM_REENTRY_ENABLED) {
        return { detected: false, signature: null, blockTime: null };
    }

    try {
        for (const parsed of prefetchedCreatorRiskTxs) {
            if (createPoolSignature && parsed.signature === createPoolSignature) continue;
            if (
                createPoolBlockTime &&
                parsed.blockTime &&
                parsed.blockTime < createPoolBlockTime
            ) {
                continue;
            }
            if (
                createPoolBlockTime &&
                parsed.blockTime &&
                parsed.blockTime - createPoolBlockTime > CONFIG.CREATOR_RISK_DIRECT_AMM_REENTRY_WINDOW_SEC
            ) {
                continue;
            }

            const hasOuterAmm = (parsed.tx.transaction?.message?.instructions || []).some((ix: any) => {
                return instructionProgramIdMatches(ix, PUMPFUN_AMM_PROGRAM_ID);
            });
            const hasInnerAmm = (parsed.tx.meta?.innerInstructions || []).some((inner: any) =>
                (inner.instructions || []).some((ix: any) => {
                    return instructionProgramIdMatches(ix, PUMPFUN_AMM_PROGRAM_ID);
                })
            );

            if (hasOuterAmm || hasInnerAmm) {
                return { detected: true, signature: parsed.signature, blockTime: parsed.blockTime || null };
            }
        }

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
            if (prefetchedCreatorRiskTxs.some((parsed) => parsed.signature === sig.signature)) continue;

            const parsed = (await fetchParsedTransactionsForSignatures(connection, [sig]))[0];
            if (!parsed) continue;

            const hasOuterAmm = (parsed.tx.transaction?.message?.instructions || []).some((ix: any) => {
                return instructionProgramIdMatches(ix, PUMPFUN_AMM_PROGRAM_ID);
            });
            const hasInnerAmm = (parsed.tx.meta?.innerInstructions || []).some((inner: any) =>
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

const creatorRiskService = createCreatorRiskService({
    monitorOnly: MONITOR_ONLY,
    pumpfunAmmProgramId: PUMPFUN_AMM_PROGRAM_ID,
    buildRugHistory,
    fetchParsedTransactionsForSignatures,
    walkParsedInstructions,
    classifyRecentCreateRemovePattern,
    detectCreatorDirectAmmReentry,
    classifySprayOutboundPattern,
    classifyInboundSprayPattern,
    classifyCreatorCashoutRisk,
    collectPrecreateCreatorRiskTxs,
    collectPrecreateOutboundTransfers,
    classifyRecentRelayFunding,
    classifyPrecreateOutboundBurst,
    isStandardRelayRiskPool,
    isSuspiciousRelayRoot,
    trackRecentFunderCreator,
    withTimeout,
    isRateLimitedMessage,
});

const paperTradeService = createPaperTradeService({
    getObserverPublicKey: () => walletKeypair?.publicKey ?? Keypair.generate().publicKey,
    fetchSwapState: async (poolAddress: string, observerUser: PublicKey) => {
        const poolKey = new PublicKey(poolAddress);
        try {
            return await onlineSdk.swapSolanaState(poolKey, observerUser);
        } catch {
            return null;
        }
    },
    getMintDecimals: async (connection: Connection, tokenMint: string) => {
        return (await getMintInfoRobust(connection, new PublicKey(tokenMint))).decimals;
    },
    recheckCreatorRisk: async (
        connection: Connection,
        creatorAddress: string,
        ctx: string,
        baselineLiquiditySol: number,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
        initialCreatorRisk?: CreatorRiskResult,
    ) => {
        return creatorRiskService.runCheckWithRetry(connection, creatorAddress, ctx, {
            forceRefresh: true,
            entrySolLiquidity: baselineLiquiditySol,
            createPoolSignature,
            createPoolBlockTime,
            previousResult: initialCreatorRisk,
            allowReuseIfNoNewActivity: true,
            allowFastPathOnDeepTimeout: true,
            deepCheckBudgetMs: CONFIG.CREATOR_RISK_RECHECK_DEEP_CHECK_BUDGET_MS,
        });
    },
    shouldEscalateProbationCreatorRisk: creatorRiskService.shouldEscalateProbationCreatorRisk,
    detectRemoveLiquiditySince,
    getPoolRecentChurnStats,
    detectCreatorLargeOutboundSince,
    collectCreatorCloseAccountEventsSince,
    collectCreatorOutboundTransfersSince,
    collectCreatorInboundTransfersSince,
    classifyHoldCreatorCloseAccountBurst,
    classifyHoldCreatorOutboundSpray,
    classifyHoldCreatorInboundSpray,
});

const liquidityService = createLiquidityService({
    getObserverPublicKey: () => walletKeypair?.publicKey ?? Keypair.generate().publicKey,
    fetchSwapState: async (poolAddress: string, observerUser: PublicKey) => {
        const poolKey = new PublicKey(poolAddress);
        try {
            return await onlineSdk.swapSolanaState(poolKey, observerUser);
        } catch {
            return null;
        }
    },
    getSolLiquidityFromState,
});

const top10Service = createTop10Service({
    getObserverPublicKey: () => walletKeypair?.publicKey ?? Keypair.generate().publicKey,
    fetchSwapState: async (poolAddress: string, observerUser: PublicKey) => {
        const poolKey = new PublicKey(poolAddress);
        try {
            return await onlineSdk.swapSolanaState(poolKey, observerUser);
        } catch {
            return null;
        }
    },
    ensureMintInfo: getMintInfoRobust,
});

const devHoldingsService = createDevHoldingsService({
    monitorOnly: MONITOR_ONLY,
    getMintDecimals: async (connection: Connection, mintKey: PublicKey) => {
        return (await getMintInfoRobust(connection, mintKey)).decimals;
    },
});

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

const supervisorRuntime = createSupervisorRuntime({
    rootDir: ROOT_DIR,
    workerLogDir: WORKER_LOG_DIR,
    maxConcurrentOperations: CONFIG.MAX_CONCURRENT_OPERATIONS,
    queueMaxPendingSignatures: CONFIG.QUEUE_MAX_PENDING_SIGNATURES,
    signatureCacheTtlMs: CONFIG.SIGNATURE_CACHE_TTL_MS,
    signatureCacheMaxSize: CONFIG.SIGNATURE_CACHE_MAX_SIZE,
    logStaleResubscribeMs: CONFIG.LOG_STALE_RESUBSCRIBE_MS,
    healthcheckIntervalMs: CONFIG.HEALTHCHECK_INTERVAL_MS,
    programId: PUMPFUN_AMM_PROGRAM_ID,
    createConnection: createRuntimeConnection,
    initSdks,
    handleNewPool,
    shortSig,
    getWorkerEntryCommand,
    stageLog,
    onStartupLog: (workerCount) => {
        console.log("🎯 STARTING PUMP.FUN AMM SNIPER 🎯");
        console.log(`Program: ${PUMPFUN_AMM_PROGRAM_ID}`);
        console.log(`Mode: ${MONITOR_ONLY ? "MONITOR_ONLY" : "TRADING"}`);
        console.log(`Wallet: ${walletKeypair ? walletKeypair.publicKey.toBase58() : "N/A (no private key loaded)"}`);
        console.log(`RPC: ${describeRpcEndpoint()}`);
        console.log(`Min Liquidity: ${CONFIG.MIN_POOL_LIQUIDITY_SOL} SOL`);
        console.log(`Max Parallel Ops: ${workerCount}`);
        if (!MONITOR_ONLY) {
            console.log(`Amount: ${CONFIG.TRADE_AMOUNT_SOL} SOL`);
            console.log(`Auto-Sell: ${CONFIG.AUTO_SELL_DELAY_MS / 1000} seconds`);
        } else if (CONFIG.PAPER_TRADE_ENABLED) {
            console.log(`Paper Trade: enabled (every valid pool, exit delay ${CONFIG.AUTO_SELL_DELAY_MS / 1000}s)`);
        }
        console.log("");
    },
});

startApp({
    isWorkerProcess: IS_WORKER_PROCESS,
    runWorkerTask: async () => {
        const signature = process.env.WORKER_TASK_SIGNATURE;
        if (!signature) {
            throw new Error("WORKER_TASK_SIGNATURE missing");
        }
        await runWorkerTask({
            signature,
            workerSlot: WORKER_SLOT || 1,
            createConnection: createRuntimeConnection,
            initSdks,
            handleNewPool,
            shortSig,
            stageLog,
        });
    },
    runSupervisor: () => supervisorRuntime.runSupervisor(),
}).catch((err) => {
    console.error("❌ Terminal Error:", err);
});
