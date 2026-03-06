import dotenv from "dotenv";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { OnlinePumpAmmSdk, PumpAmmSdk, buyQuoteInput, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction } from "@solana/spl-token";

dotenv.config();

function timestampNow(): string {
    const d = new Date();
    const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function patchConsoleWithTimestamp() {
    const wrap = (fn: (...args: any[]) => void) => (...args: any[]) => fn(`[${timestampNow()}]`, ...args);
    console.log = wrap(console.log.bind(console));
    console.warn = wrap(console.warn.bind(console));
    console.error = wrap(console.error.bind(console));
}

patchConsoleWithTimestamp();

// ═══════════════════════════════════════════════════════════════════════════════
// 🎛️ PUMP.FUN AMM SNIPER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
    // 💰 TRADING
    TRADE_AMOUNT_SOL: 0.001,               // Amount to buy per snipe
    
    // 🔒 ENTRY FILTERS
    MIN_POOL_LIQUIDITY_USD: 20000,        // Minimum liquidity in USD
    MIN_POOL_LIQUIDITY_SOL: 40,          // Kept as hard floor in SOL
    
    // ⏱️ TIMING
    AUTO_SELL_DELAY_MS: 16000,            // Sell after N seconds
    PRE_BUY_WAIT_MS: Number(process.env.PRE_BUY_WAIT_MS || 1500), // Wait before entering
    PRE_BUY_MAX_LIQ_DROP_PCT: Number(process.env.PRE_BUY_MAX_LIQ_DROP_PCT || 10), // Skip if liq drops too much during wait
    
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

    // 📈 PAPER TRADE (simulation only)
    PAPER_TRADE_ENABLED: process.env.PAPER_TRADE_ENABLED === "true",
    PAPER_TRADE_MAX_LOSS_PCT: Number(process.env.PAPER_TRADE_MAX_LOSS_PCT || 80),
    LIQUIDITY_STOP_ENABLED: process.env.LIQUIDITY_STOP_ENABLED !== "false",
    LIQUIDITY_STOP_DROP_PCT: Number(process.env.LIQUIDITY_STOP_DROP_PCT || 30),
    LIQUIDITY_STOP_CHECK_INTERVAL_MS: Number(process.env.LIQUIDITY_STOP_CHECK_INTERVAL_MS || 300),
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
let isPositionOpen = false;
let logSubscriptionId: number | null = null;
let lastLogAtMs = Date.now();
let healthcheckInterval: NodeJS.Timeout | null = null;
const seenSignatures = new Map<string, number>();
let cachedSolPriceUsd: number | null = null;
let cachedSolPriceAtMs = 0;

function shortSig(sig: string): string {
    if (sig.length <= 14) return sig;
    return `${sig.slice(0, 6)}...${sig.slice(-6)}`;
}

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

// Initialize SDKs
let onlineSdk: OnlinePumpAmmSdk;
let offlineSdk: PumpAmmSdk;

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    const rpcEndpoint = process.env.SVS_UNSTAKED_RPC || "https://api.mainnet-beta.solana.com";
    const connection = new Connection(rpcEndpoint, { commitment: "confirmed" });

    // Initialize SDKs with connection
    onlineSdk = new OnlinePumpAmmSdk(connection);
    offlineSdk = new PumpAmmSdk();

    console.log("🎯 STARTING PUMP.FUN AMM SNIPER 🎯");
    console.log(`Program: ${PUMPFUN_AMM_PROGRAM_ID}`);
    console.log(`Mode: ${MONITOR_ONLY ? "MONITOR_ONLY" : "TRADING"}`);
    console.log(`Wallet: ${walletKeypair ? walletKeypair.publicKey.toBase58() : "N/A (no private key loaded)"}`);
    console.log(`Min Liquidity: ${CONFIG.MIN_POOL_LIQUIDITY_SOL} SOL (~$${CONFIG.MIN_POOL_LIQUIDITY_USD}, live SOL/USD)`);
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

                console.log("");
                console.log("────────────────────────────────────────────────────────");
                console.log(`🆕 NEW POOL [${shortSig(logs.signature)}]`);
                console.log(`   Signature: ${logs.signature}`);
                if (isPositionOpen) {
                    console.log(`   ⏭️ Busy, skip [${shortSig(logs.signature)}]`);
                    console.log("────────────────────────────────────────────────────────");
                    return;
                }
                await handleNewPool(connection, logs.signature);
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

        process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLE NEW POOL
// ═══════════════════════════════════════════════════════════════════════════════

async function handleNewPool(connection: Connection, signature: string) {
    isPositionOpen = true;
    let keepPositionOpen = false;
    const ctx = `[${shortSig(signature)}]`;
    const eventStartedAt = Date.now();
    let finalStatus = "COMPLETED";

    console.log(`⏳ ${ctx} Processing pool`);
    console.log(`   ${ctx} STEP 1/6 Parse transaction`);
    
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
            console.log(`❌ ${ctx} Could not fetch transaction data. Skipping.`);
            finalStatus = "SKIP: tx unavailable";
            return;
        }

        // Extract pool address and token mint from transaction
        // According to IDL: pool=0, global_config=1, creator=2, base_mint=3, quote_mint=4
        const accountKeys = tx.transaction.message.accountKeys;
        let poolAddress: string | null = null;
        let tokenMint: string | null = null;

        // Debug: Log account keys
        console.log(`   ${ctx} TX accounts=${accountKeys.length}`);

        // Find the create_pool instruction within the transaction
        let creatorAddress: string | null = null;
        const instructions = tx.transaction.message.instructions;
        for (const ix of instructions) {
            // Check if this instruction is to the Pump AMM program
            const programId = accountKeys[ix.programIdIndex]?.pubkey?.toBase58();
            
            if (programId === PUMPFUN_AMM_PROGRAM_ID) {
                console.log(`   ✅ Found Pump AMM instruction with ${ix.accounts?.length || 0} accounts`);
                // Extract accounts based on IDL order
                if (ix.accounts && ix.accounts.length >= 5) {
                    poolAddress = accountKeys[ix.accounts[0]]?.pubkey?.toBase58() || null;
                    tokenMint = accountKeys[ix.accounts[3]]?.pubkey?.toBase58() || null;
                    creatorAddress = accountKeys[ix.accounts[2]]?.pubkey?.toBase58() || null;
                    if (creatorAddress) {
                        console.log(`   👤 Creator: ${creatorAddress}`);
                    }
                }
                break;
            }
        }

        // Fallback for tokenMint/pool if instructions didn't match (sometimes it's inner instructions)
        if (!tokenMint || !poolAddress) {
            console.log(`   ${ctx} Fallback: postTokenBalances`);
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
            console.log(`❌ ${ctx} Could not extract pool/token from TX. Skipping.`);
            finalStatus = "SKIP: pool/token unresolved";
            return;
        }

        console.log(`   ${ctx} STEP 2/6 Resolve token/pool/creator`);
        console.log(`🎯 ${ctx} Token: ${tokenMint}`);
        console.log(`📦 ${ctx} Pool: ${poolAddress}`);
        console.log(`🔗 ${ctx} GMGN: https://gmgn.ai/sol/token/${tokenMint}`);

        // Always require a creator address (fail-closed).
        // If not present in tx accounts, resolve it from on-chain pool state.
        if (!creatorAddress) {
            creatorAddress = await resolveCreatorFromPool(connection, poolAddress);
            if (creatorAddress) {
                console.log(`   👤 Creator (resolved from pool): ${creatorAddress}`);
            }
        }

        if (!creatorAddress) {
            console.log(`🛑 ${ctx} SKIP: creator not resolvable`);
            finalStatus = "SKIP: creator unresolved";
            return;
        }

        console.log(`   ${ctx} STEP 3/6 Liquidity check`);
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
            console.log(`💧 ${ctx} Liquidity: ${liquiditySOL.toFixed(2)} SOL (~$${liquidityUSD.toFixed(0)})`);
        } else {
            console.log(`💧 ${ctx} Liquidity: ${liquiditySOL.toFixed(2)} SOL (USD unavailable)`);
        }

        const failedSolThreshold = liquiditySOL < CONFIG.MIN_POOL_LIQUIDITY_SOL;
        const failedUsdThreshold = liquidityUSD !== null && liquidityUSD < CONFIG.MIN_POOL_LIQUIDITY_USD;
        if (failedSolThreshold || failedUsdThreshold) {
            const usdPart = liquidityUSD !== null
                ? `$${liquidityUSD.toFixed(0)}`
                : "USD N/A";
            console.log(
                `🛑 ${ctx} SKIP: Liquidity too low ` +
                `(${liquiditySOL.toFixed(2)} SOL / ${usdPart}; ` +
                `min ${CONFIG.MIN_POOL_LIQUIDITY_SOL} SOL / $${CONFIG.MIN_POOL_LIQUIDITY_USD})`
            );
            finalStatus = "SKIP: low liquidity";
            return;
        }

        console.log(`   ${ctx} STEP 4/6 Mint/freeze security`);
        // 🛡️ SAFETY CHECKS
        const isSafe = await checkTokenSecurity(connection, tokenMint);
        if (!isSafe) {
            console.log(`🛑 ${ctx} SKIP: Token failed safety checks.`);
            finalStatus = "SKIP: token security";
            return;
        }

        if (MONITOR_ONLY) {
            if (CONFIG.PRE_BUY_WAIT_MS > 0) {
                const preEntry = await preEntryWaitAndCheck(connection, poolAddress, liquiditySOL, ctx);
                if (!preEntry.ok) {
                    console.log(`🛑 ${ctx} SKIP: pre-entry guard (${preEntry.reason})`);
                    finalStatus = "SKIP: pre-entry guard";
                    return;
                }
                liquiditySOL = preEntry.currentLiquiditySol;
            }
            console.log(`   ${ctx} STEP 5/6 Paper simulation`);
            const paper = await maybeRunPaperTradeSimulation(connection, poolAddress, tokenMint, ctx);
            if (!paper.ok) {
                console.log(`🛑 ${ctx} SKIP: Paper simulation guard (${paper.reason})`);
                finalStatus = "SKIP: paper simulation guard";
                return;
            }
            console.log(`   ${ctx} STEP 6/6 Dev holdings check`);
            const devCheckOk = await runDevHoldingsCheck(connection, creatorAddress, tokenMint, postTokenBalances, ctx, false);
            if (devCheckOk) {
                console.log(`✅ ${ctx} Checks passed`);
            }
            console.log(`👀 ${ctx} MONITOR_ONLY: no live trade`);
            return;
        }

        const devCheckOk = await runDevHoldingsCheck(connection, creatorAddress, tokenMint, postTokenBalances, ctx, true);
        if (!devCheckOk) {
            finalStatus = "SKIP: dev holdings";
            return;
        }

        if (CONFIG.PRE_BUY_WAIT_MS > 0) {
            const preEntry = await preEntryWaitAndCheck(connection, poolAddress, liquiditySOL, ctx);
            if (!preEntry.ok) {
                console.log(`🛑 ${ctx} SKIP: pre-entry guard (${preEntry.reason})`);
                finalStatus = "SKIP: pre-entry guard";
                return;
            }
        }

        console.log(`✅ ${ctx} Checks passed`);

        // Execute buy
        console.log(`🚀 ${ctx} Executing buy`);
        keepPositionOpen = await executeBuy(connection, poolAddress, tokenMint);

    } catch (e: any) {
        console.error(`❌ Error in handleNewPool: ${e.message}`);
        finalStatus = `ERROR: ${e.message}`;
    } finally {
        if (!keepPositionOpen) {
            isPositionOpen = false;
        }
        console.log(`🏁 ${ctx} END (${Date.now() - eventStartedAt}ms) ${finalStatus}`);
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

async function preEntryWaitAndCheck(
    connection: Connection,
    poolAddress: string,
    baselineLiquiditySol: number,
    ctx: string,
): Promise<{ ok: boolean; reason?: string; currentLiquiditySol: number }> {
    console.log(`   ${ctx} Pre-entry wait: ${CONFIG.PRE_BUY_WAIT_MS}ms`);
    await new Promise(r => setTimeout(r, CONFIG.PRE_BUY_WAIT_MS));

    try {
        const observerUser = walletKeypair?.publicKey ?? Keypair.generate().publicKey;
        const state = await onlineSdk.swapSolanaState(new PublicKey(poolAddress), observerUser);
        const currentLiquiditySol = Number(state.poolBaseAmount.toString()) / 1e9;

        if (baselineLiquiditySol > 0) {
            const minAllowed = baselineLiquiditySol * (1 - Math.abs(CONFIG.PRE_BUY_MAX_LIQ_DROP_PCT) / 100);
            if (currentLiquiditySol < minAllowed) {
                return {
                    ok: false,
                    reason: `liquidity dropped ${baselineLiquiditySol.toFixed(2)} -> ${currentLiquiditySol.toFixed(2)} SOL`,
                    currentLiquiditySol,
                };
            }
        }

        console.log(`   ${ctx} Pre-entry liquidity check: ${currentLiquiditySol.toFixed(2)} SOL`);
        return { ok: true, currentLiquiditySol };
    } catch (e: any) {
        return { ok: false, reason: e?.message || "pre-entry liquidity fetch failed", currentLiquiditySol: baselineLiquiditySol };
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
        console.log(`   ${ctx} Dev holdings check: disabled`);
        return true;
    }

    const devCheckStart = Date.now();
    try {
        const creatorBalanceRaw = await getCreatorTokenBalanceRawWithRetry(connection, creatorAddress, tokenMint, postTokenBalances);
        const mintInfo = await getMintInfoRobust(connection, new PublicKey(tokenMint));
        const totalSupplyRaw = 1_000_000_000n * (10n ** BigInt(mintInfo.decimals)); // Pump tokens are 1B supply

        const devPct = Number((creatorBalanceRaw * 10000n) / totalSupplyRaw) / 100;
        console.log(`   ${ctx} Dev holding: ${creatorBalanceRaw.toString()} (${devPct.toFixed(2)}%)`);
        if (creatorBalanceRaw < 1n) {
            console.log(`   ${ctx} Creator wallet token balance is 0 after create_pool (can be normal).`);
        }
        console.log(`   ${ctx} Dev check duration: ${Date.now() - devCheckStart}ms`);

        if (devPct > CONFIG.MAX_DEV_HOLDINGS_PCT) {
            if (enforceGate) {
                console.log(`🛑 ${ctx} SKIP: Dev holds too much (${devPct.toFixed(1)}% > ${CONFIG.MAX_DEV_HOLDINGS_PCT}%)`);
                return false;
            }
            console.log(`⚠️ ${ctx} Dev holds too much (${devPct.toFixed(1)}% > ${CONFIG.MAX_DEV_HOLDINGS_PCT}%)`);
        }
        return true;
    } catch (e: any) {
        const reason = e?.message || String(e);
        const durationMs = Date.now() - devCheckStart;
        if (MONITOR_ONLY && !enforceGate) {
            console.log(`⚠️ ${ctx} Dev check failed after ${durationMs}ms: ${reason}`);
            console.log(`   ${ctx} Dev check fail-open in MONITOR_ONLY`);
            return true;
        }
        console.log(`🛑 ${ctx} SKIP: Dev check failed after ${durationMs}ms: ${reason}`);
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

async function maybeRunPaperTradeSimulation(connection: Connection, poolAddress: string, tokenMint: string, ctx = ""): Promise<PaperTradeResult> {
    if (!CONFIG.PAPER_TRADE_ENABLED) return { ok: true };
    const p = ctx ? `${ctx} ` : "";

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
        console.log(`📈 ${p}PAPER_TRADE: simulate buy->sell`);
        let tokenDecimals = 6;
        try {
            tokenDecimals = (await getMintInfoRobust(connection, new PublicKey(tokenMint))).decimals;
        } catch {
            // fallback to common pump token decimals
        }

        const entryState = await fetchStateWithRetry();
        if (!entryState) {
            console.log(`⚠️ ${p}PAPER_TRADE: no entry pool state`);
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
            console.log(`⚠️ ${p}PAPER_TRADE: entry received 0 tokens`);
            return { ok: false, reason: "entry produced 0 tokens" };
        }
        const entrySpotSolPerToken = orientation.solIsBase
            ? calcSpotSolPerToken(entryState.poolBaseAmount, entryState.poolQuoteAmount, tokenDecimals)
            : calcSpotSolPerToken(entryState.poolQuoteAmount, entryState.poolBaseAmount, tokenDecimals);
        console.log(`   ${p}Buy Spot:  ~${formatSolCompact(entrySpotSolPerToken)}/token`);

        const exitState = await waitForExitStateWithLiquidityStop(
            fetchStateWithRetry,
            entryState,
            tokenDecimals,
            p,
        );
        if (!exitState) {
            console.log(`⚠️ ${p}PAPER_TRADE: no exit pool state`);
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
        const pnlSol = solOut - CONFIG.TRADE_AMOUNT_SOL;
        const pnlPct = (pnlSol / CONFIG.TRADE_AMOUNT_SOL) * 100;
        const exitSpotSolPerToken = orientation.solIsBase
            ? calcSpotSolPerToken(exitState.poolBaseAmount, exitState.poolQuoteAmount, tokenDecimals)
            : calcSpotSolPerToken(exitState.poolQuoteAmount, exitState.poolBaseAmount, tokenDecimals);

        console.log(`   ${p}Sell Spot: ~${formatSolCompact(exitSpotSolPerToken)}/token`);
        console.log(`   ${p}PnL: ${pnlSol >= 0 ? "+" : ""}${formatSolCompact(Math.abs(pnlSol))} (${pnlPct.toFixed(2)}%)`);
        if (!Number.isFinite(solOut) || solOut <= 0) {
            return { ok: false, reason: "exit returned 0 SOL" };
        }
        if (pnlPct <= -Math.abs(CONFIG.PAPER_TRADE_MAX_LOSS_PCT)) {
            return { ok: false, reason: `pnl ${pnlPct.toFixed(2)}% <= -${Math.abs(CONFIG.PAPER_TRADE_MAX_LOSS_PCT)}%` };
        }
        return { ok: true };
    } catch (e: any) {
        console.log(`⚠️ ${p}PAPER_TRADE failed: ${e.message}`);
        return { ok: false, reason: e?.message || "paper simulation failed" };
    }
}

async function waitForExitStateWithLiquidityStop(
    fetchStateWithRetry: () => Promise<any | null>,
    entryState: any,
    tokenDecimals: number,
    logPrefix: string,
): Promise<any | null> {
    const deadlineMs = Date.now() + CONFIG.AUTO_SELL_DELAY_MS;
    const entrySpot = calcSpotSolPerToken(entryState.poolBaseAmount, entryState.poolQuoteAmount, tokenDecimals);
    const entryBaseLamports = Number(entryState.poolBaseAmount.toString());
    const dropFactor = 1 - (Math.abs(CONFIG.LIQUIDITY_STOP_DROP_PCT) / 100);
    let latestState: any | null = entryState;

    while (Date.now() < deadlineMs) {
        await new Promise(r => setTimeout(r, CONFIG.LIQUIDITY_STOP_CHECK_INTERVAL_MS));
        const s = await fetchStateWithRetry();
        if (!s) continue;
        latestState = s;

        if (!CONFIG.LIQUIDITY_STOP_ENABLED) continue;

        const curSpot = calcSpotSolPerToken(s.poolBaseAmount, s.poolQuoteAmount, tokenDecimals);
        const curBaseLamports = Number(s.poolBaseAmount.toString());

        const spotTriggered =
            Number.isFinite(entrySpot) &&
            entrySpot > 0 &&
            Number.isFinite(curSpot) &&
            curSpot > 0 &&
            curSpot <= entrySpot * dropFactor;

        const baseTriggered =
            Number.isFinite(entryBaseLamports) &&
            entryBaseLamports > 0 &&
            Number.isFinite(curBaseLamports) &&
            curBaseLamports > 0 &&
            curBaseLamports <= entryBaseLamports * dropFactor;

        if (spotTriggered || baseTriggered) {
            console.log(
                `⚠️ ${logPrefix}LIQUIDITY STOP: trigger early exit ` +
                `(spot ${formatSolCompact(curSpot)}/token, base ${(curBaseLamports / 1e9).toFixed(2)} SOL)`
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
            isPositionOpen = false;
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
            isPositionOpen = false;
            return false;
        }

        console.log("🚀 BUY CONFIRMED! Scheduling Auto-Sell...");
        setTimeout(() => executeSell(connection, poolAddress, tokenMint), CONFIG.AUTO_SELL_DELAY_MS);
        return true;

    } catch (e: any) {
        console.error("❌ Buy Error:", e.message);
        isPositionOpen = false;
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
            isPositionOpen = false;
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
        isPositionOpen = false;
    }
}

main().catch(err => {
    console.error("❌ Terminal Error:", err);
});
