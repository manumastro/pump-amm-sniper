import { buyQuoteInput, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { CONFIG, HOLD_WINNER_PROFILE } from "../../app/config";
import { CreatorRiskResult, PaperSimulationOptions, PaperTradeResult } from "../../domain/types";
import { stageLog } from "../reporting/stageLog";
import { formatSolCompact, formatSolDecimal } from "../../utils/format";
import { shortSig } from "../../utils/pubkeys";
import { waitForExitStateWithLiquidityStop } from "./holdMonitor";
import { validatePreBuyEntryState } from "./preBuyValidation";
import { getPoolOrientation, getSolLiquidityFromState, getSpotSolPerTokenFromState } from "./quote";

type PaperTradeDeps = {
    getObserverPublicKey: () => PublicKey;
    fetchSwapState: (poolAddress: string, observerUser: PublicKey) => Promise<any | null>;
    getMintDecimals: (connection: Connection, tokenMint: string) => Promise<number>;
    recheckCreatorRisk: (
        connection: Connection,
        creatorAddress: string,
        ctx: string,
        baselineLiquiditySol: number,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
        initialCreatorRisk?: CreatorRiskResult,
    ) => Promise<CreatorRiskResult>;
    shouldEscalateProbationCreatorRisk: (
        creatorRisk: CreatorRiskResult,
        baselineCreatorCashoutSol?: number,
    ) => { escalate: boolean; cashoutDeltaSol: number };
    detectRemoveLiquiditySince: (
        connection: Connection,
        poolAddress: string,
        creatorAddress: string,
        tokenMint: string,
        seenPoolSignatures: Set<string>,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
    ) => Promise<any>;
    getPoolRecentChurnStats: (
        connection: Connection,
        poolAddress: string,
        createPoolSignature?: string,
        minBlockTimeSec?: number | null,
    ) => Promise<{ shortCount: number; longCount: number; criticalCount: number }>;
    detectCreatorLargeOutboundSince: any;
    collectCreatorCloseAccountEventsSince: any;
    collectCreatorOutboundTransfersSince: any;
    collectCreatorInboundTransfersSince: any;
    classifyHoldCreatorCloseAccountBurst: any;
    classifyHoldCreatorOutboundSpray: any;
    classifyHoldCreatorInboundSpray: any;
};

export function createPaperTradeService(deps: PaperTradeDeps) {
    async function validatePreBuy(
        connection: Connection,
        fetchStateWithRetry: () => Promise<any | null>,
        tokenMint: string,
        tokenDecimals: number,
        buyAmountLamports: BN,
        baselineLiquiditySol: number,
        ctx: string,
        creatorAddress?: string,
        poolAddress?: string,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
        initialCreatorRisk?: CreatorRiskResult,
        options?: PaperSimulationOptions,
    ) {
        return validatePreBuyEntryState(
            {
                recheckCreatorRisk: deps.recheckCreatorRisk,
                shouldEscalateProbationCreatorRisk: deps.shouldEscalateProbationCreatorRisk,
                detectRemoveLiquiditySince: deps.detectRemoveLiquiditySince,
            },
            connection,
            fetchStateWithRetry,
            tokenMint,
            tokenDecimals,
            buyAmountLamports,
            baselineLiquiditySol,
            ctx,
            creatorAddress,
            poolAddress,
            createPoolSignature,
            createPoolBlockTime,
            initialCreatorRisk,
            options,
        );
    }

    async function runSimulation(
        connection: Connection,
        poolAddress: string,
        tokenMint: string,
        baselineLiquiditySol: number,
        ctx = "",
        creatorAddress?: string,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
        initialCreatorRisk?: CreatorRiskResult,
        options?: PaperSimulationOptions,
    ): Promise<PaperTradeResult> {
        if (!CONFIG.PAPER_TRADE_ENABLED) return { ok: true };

        const observerUser = deps.getObserverPublicKey();
        const buyAmountLamports = new BN(Math.floor(CONFIG.TRADE_AMOUNT_SOL * 1e9));

        const fetchStateWithRetry = async () => {
            for (let i = 0; i < 12; i++) {
                const state = await deps.fetchSwapState(poolAddress, observerUser);
                if (state?.poolBaseAmount?.gt?.(new BN(0)) && state?.poolQuoteAmount?.gt?.(new BN(0))) {
                    return state;
                }
                await new Promise((r) => setTimeout(r, 250));
            }
            return null;
        };

        try {
            stageLog(ctx, "PAPER", "simulate buy->sell");
            let tokenDecimals = 6;
            try {
                tokenDecimals = await deps.getMintDecimals(connection, tokenMint);
            } catch {
                // fallback to common pump token decimals
            }

            const preBuy = await validatePreBuy(
                connection,
                fetchStateWithRetry,
                tokenMint,
                tokenDecimals,
                buyAmountLamports,
                baselineLiquiditySol,
                ctx,
                creatorAddress,
                poolAddress,
                createPoolSignature,
                createPoolBlockTime,
                initialCreatorRisk,
                options,
            );
            if (!preBuy.ok || !preBuy.entryState || !preBuy.tokenOutAtomic || !preBuy.tokenOutUi) {
                return { ok: false, reason: preBuy.reason || "pre-buy validation failed" };
            }

            const entryState = preBuy.entryState;
            const tokenOutAtomic = preBuy.tokenOutAtomic;
            const tokenOutUi = preBuy.tokenOutUi;
            const entrySpotSolPerToken = preBuy.entrySpotSolPerToken || 0;
            const orientation = getPoolOrientation(entryState, tokenMint);
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

            // Adjust winner profile based on CP value
            const cpValue = initialCreatorRisk?.uniqueCounterparties;
            let activeWinnerProfile = HOLD_WINNER_PROFILE;
            
            if (cpValue === 1) {
                // CP=1: Higher take profit (100%)
                activeWinnerProfile = {
                    ...HOLD_WINNER_PROFILE,
                    hardTakeProfitPct: CONFIG.HOLD_WINNER_HARD_TAKE_PROFIT_PCT_CP1,
                };
            } else if (cpValue === 0) {
                // CP=0: Tighter trailing stop (10%) to protect against slow rugs
                activeWinnerProfile = {
                    ...HOLD_WINNER_PROFILE,
                    trailingDropPct: CONFIG.HOLD_WINNER_TRAILING_DROP_PCT_CP0,
                };
            }

            if (forcedProbationHoldMs > 0) {
                stageLog(ctx, "HOLD", `probation hold ${effectiveHoldMs}ms (paper creator-risk bypass)`);
            } else if (suspiciousRelay) {
                stageLog(
                    ctx,
                    "HOLD",
                    `suspicious relay root ${shortSig(initialCreatorRisk?.relayFundingRoot || "-")} -> short hold ${effectiveHoldMs}ms`
                );
            }

            const exitOutcome = await waitForExitStateWithLiquidityStop(
                {
                    recheckCreatorRisk: deps.recheckCreatorRisk,
                    shouldEscalateProbationCreatorRisk: deps.shouldEscalateProbationCreatorRisk,
                    detectRemoveLiquiditySince: deps.detectRemoveLiquiditySince,
                    getPoolRecentChurnStats: deps.getPoolRecentChurnStats,
                    detectCreatorLargeOutboundSince: deps.detectCreatorLargeOutboundSince,
                    collectCreatorCloseAccountEventsSince: deps.collectCreatorCloseAccountEventsSince,
                    collectCreatorOutboundTransfersSince: deps.collectCreatorOutboundTransfersSince,
                    collectCreatorInboundTransfersSince: deps.collectCreatorInboundTransfersSince,
                    classifyHoldCreatorCloseAccountBurst: deps.classifyHoldCreatorCloseAccountBurst,
                    classifyHoldCreatorOutboundSpray: deps.classifyHoldCreatorOutboundSpray,
                    classifyHoldCreatorInboundSpray: deps.classifyHoldCreatorInboundSpray,
                },
                connection,
                poolAddress,
                fetchStateWithRetry,
                entryState,
                tokenMint,
                tokenOutAtomic,
                ctx,
                effectiveHoldMs,
                !!options?.suppressCreatorRiskRecheck,
                creatorAddress,
                createPoolSignature,
                createPoolBlockTime,
                initialCreatorRisk,
                activeWinnerProfile,
            );
            if (!exitOutcome?.state) {
                console.log("⚠️ PAPER_TRADE: no exit pool state");
                return { ok: false, reason: "exit state unavailable" };
            }
            const exitState = exitOutcome.state;
            const exitReason = exitOutcome.exitReason;

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
                return { ok: false, reason: "exit returned 0 SOL", finalStatus: "PAPER LOSS", pnlSol, pnlPct, exitReason };
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
                return { ok: false, reason: "exit quote exceeded pool liquidity", exitReason };
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
                    pnlSol,
                    pnlPct,
                    exitReason,
                };
            }

            return { ok: true, finalStatus: "COMPLETED", pnlSol, pnlPct, exitReason };
        } catch (e: any) {
            console.log(`⚠️ PAPER_TRADE failed: ${e.message}`);
            return { ok: false, reason: e?.message || "paper simulation failed" };
        }
    }

    return {
        runSimulation,
        validatePreBuy,
    };
}
