import { buyQuoteInput, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { CONFIG, HOLD_WINNER_PROFILE, WINNER_AGGRESSIVE_AUDIT_PROFILE, WINNER_SHADOW_AUDIT_PROFILE, WINNER_ULTRA_AUDIT_PROFILE } from "../../app/config";
import { CreatorRiskResult, PaperSimulationOptions, PaperTradeResult, WinnerManagementProfile } from "../../domain/types";
import { stageLog } from "../reporting/stageLog";
import { formatSolCompact, formatSolDecimal } from "../../utils/format";
import { shortSig } from "../../utils/pubkeys";
import { waitForExitStateWithLiquidityStop } from "./holdMonitor";
import { validatePreBuyEntryState } from "./preBuyValidation";
import { getExitQuoteSolFromState, getPoolOrientation, getSolLiquidityFromState, getSpotSolPerTokenFromState } from "./quote";

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
    async function runWinnerShadowAudit(
        filter: string,
        profile: WinnerManagementProfile,
        maxExtraHoldMs: number,
        fetchStateWithRetry: () => Promise<any | null>,
        tokenMint: string,
        tokenOutAtomic: BN,
        initialState: any,
        actualExitReason: string,
        actualPnlSol: number,
        actualPnlPct: number,
        ctx: string,
        alreadyHeldMs: number,
        peakExitQuoteSol: number,
    ) {
        if (!profile.enabled) return;

        const startedAtMs = Date.now();
        const deadlineMs = startedAtMs + Math.max(5000, maxExtraHoldMs);
        let latestState: any | null = initialState;
        let lastCheckAtMs = 0;
        let shadowPeakExitQuoteSol = Math.max(
            peakExitQuoteSol,
            getExitQuoteSolFromState(initialState, tokenMint, tokenOutAtomic) || 0,
        );
        let shadowExitQuoteSol = getExitQuoteSolFromState(initialState, tokenMint, tokenOutAtomic);
        let shadowExitReason = "winner shadow timeout";

        while (Date.now() < deadlineMs) {
            const state = await fetchStateWithRetry();
            if (state) {
                latestState = state;
                const currentExitQuoteSol = getExitQuoteSolFromState(state, tokenMint, tokenOutAtomic);
                if (currentExitQuoteSol !== null && currentExitQuoteSol > 0) {
                    shadowExitQuoteSol = currentExitQuoteSol;
                    shadowPeakExitQuoteSol = Math.max(shadowPeakExitQuoteSol, currentExitQuoteSol);
                    if (
                        Date.now() - lastCheckAtMs >= Math.max(250, profile.checkIntervalMs) &&
                        alreadyHeldMs + (Date.now() - startedAtMs) >= Math.max(0, profile.minHoldMs)
                    ) {
                        lastCheckAtMs = Date.now();
                        const currentPnlPct = ((currentExitQuoteSol - CONFIG.TRADE_AMOUNT_SOL) / CONFIG.TRADE_AMOUNT_SOL) * 100;
                        const peakPnlPct = ((shadowPeakExitQuoteSol - CONFIG.TRADE_AMOUNT_SOL) / CONFIG.TRADE_AMOUNT_SOL) * 100;
                        const drawdownFromPeakPct =
                            shadowPeakExitQuoteSol > 0
                                ? ((shadowPeakExitQuoteSol - currentExitQuoteSol) / shadowPeakExitQuoteSol) * 100
                                : 0;
                        if (
                            profile.hardTakeProfitPct > 0 &&
                            currentPnlPct >= profile.hardTakeProfitPct
                        ) {
                            shadowExitReason = "winner shadow hard take profit";
                            break;
                        }
                        if (
                            shadowPeakExitQuoteSol >= Math.max(0, profile.minPeakSol) &&
                            peakPnlPct >= profile.armPnlPct &&
                            drawdownFromPeakPct >= Math.abs(profile.trailingDropPct)
                        ) {
                            shadowExitReason = "winner shadow trailing stop";
                            break;
                        }
                    }
                }
            }
            await new Promise((r) => setTimeout(r, Math.max(250, profile.checkIntervalMs)));
        }

        if (!Number.isFinite(shadowExitQuoteSol) || shadowExitQuoteSol === null) {
            shadowExitQuoteSol = getExitQuoteSolFromState(latestState, tokenMint, tokenOutAtomic);
        }
        if (!Number.isFinite(shadowExitQuoteSol) || shadowExitQuoteSol === null) {
            stageLog(ctx, "AUDIT", JSON.stringify({
                filter,
                reason: actualExitReason,
                ok: false,
                finalStatus: null,
                resultReason: "winner shadow quote unavailable",
                pnlSol: null,
                pnlPct: null,
                observed: true,
                source: "winner-shadow",
            }));
            return;
        }

        const shadowPnlSol = shadowExitQuoteSol - CONFIG.TRADE_AMOUNT_SOL;
        const shadowPnlPct = (shadowPnlSol / CONFIG.TRADE_AMOUNT_SOL) * 100;
        stageLog(ctx, "AUDIT", JSON.stringify({
            filter,
            reason: actualExitReason,
            ok: shadowExitQuoteSol > 0,
            finalStatus: shadowExitQuoteSol > 0 ? "COMPLETED" : "PAPER LOSS",
            resultReason: shadowExitReason,
            pnlSol: Number(shadowPnlSol.toFixed(9)),
            pnlPct: Number(shadowPnlPct.toFixed(4)),
            observed: true,
            source: "winner-shadow",
            actualPnlSol: Number(actualPnlSol.toFixed(9)),
            actualPnlPct: Number(actualPnlPct.toFixed(4)),
            deltaPnlSol: Number((shadowPnlSol - actualPnlSol).toFixed(9)),
            deltaPnlPct: Number((shadowPnlPct - actualPnlPct).toFixed(4)),
            peakPnlPct: Number((((shadowPeakExitQuoteSol - CONFIG.TRADE_AMOUNT_SOL) / CONFIG.TRADE_AMOUNT_SOL) * 100).toFixed(4)),
        }));
    }

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
            if (!options?.auditMode) {
                stageLog(ctx, "PAPER", "simulate buy->sell");
            }
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
            if (!options?.auditMode) {
                stageLog(ctx, "BUY_SPOT", `~${formatSolCompact(entrySpotSolPerToken)}/token`);
                stageLog(ctx, "BUY_QUOTE", `${tokenOutUi.toFixed(6)} token for ${formatSolDecimal(CONFIG.TRADE_AMOUNT_SOL)}`);
            }

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

            if (!options?.auditMode && forcedProbationHoldMs > 0) {
                stageLog(ctx, "HOLD", `probation hold ${effectiveHoldMs}ms (paper creator-risk bypass)`);
            } else if (!options?.auditMode && suspiciousRelay) {
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
                HOLD_WINNER_PROFILE,
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
                if (!options?.auditMode) {
                    stageLog(ctx, "SELL_SPOT", `~${formatSolCompact(0)}/token`);
                    stageLog(ctx, "SELL_QUOTE", `${formatSolDecimal(0)} for ${tokenOutUi.toFixed(6)} token`);
                    stageLog(ctx, "PNL", `-${formatSolDecimal(Math.abs(pnlSol))} (${pnlPct.toFixed(2)}%)`);
                }
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

            if (
                !options?.auditMode &&
                (exitReason === "winner take profit" || exitReason === "winner trailing stop")
            ) {
                const peakExitQuoteSol = Math.max(
                    getExitQuoteSolFromState(entryState, tokenMint, tokenOutAtomic) || 0,
                    getExitQuoteSolFromState(exitState, tokenMint, tokenOutAtomic) || 0,
                );
                const winnerShadowRuns = [
                    {
                        filter: "winner-management-ambitious",
                        profile: WINNER_SHADOW_AUDIT_PROFILE,
                        maxExtraHoldMs: CONFIG.WINNER_SHADOW_AUDIT_MAX_EXTRA_HOLD_MS,
                    },
                    {
                        filter: "winner-management-aggressive",
                        profile: WINNER_AGGRESSIVE_AUDIT_PROFILE,
                        maxExtraHoldMs: CONFIG.WINNER_AGGRESSIVE_AUDIT_MAX_EXTRA_HOLD_MS,
                    },
                    {
                        filter: "winner-management-ultra",
                        profile: WINNER_ULTRA_AUDIT_PROFILE,
                        maxExtraHoldMs: CONFIG.WINNER_ULTRA_AUDIT_MAX_EXTRA_HOLD_MS,
                    },
                ];
                for (const shadowRun of winnerShadowRuns) {
                    if (!shadowRun.profile.enabled) continue;
                    void runWinnerShadowAudit(
                        shadowRun.filter,
                        shadowRun.profile,
                        shadowRun.maxExtraHoldMs,
                        fetchStateWithRetry,
                        tokenMint,
                        tokenOutAtomic,
                        exitState,
                        exitReason,
                        pnlSol,
                        pnlPct,
                        ctx,
                        effectiveHoldMs,
                        peakExitQuoteSol,
                    ).catch((e: any) => {
                        stageLog(ctx, "AUDIT", JSON.stringify({
                            filter: shadowRun.filter,
                            reason: exitReason,
                            ok: false,
                            finalStatus: null,
                            resultReason: e?.message || "winner shadow audit failed",
                            pnlSol: null,
                            pnlPct: null,
                            observed: true,
                            source: "winner-shadow",
                        }));
                    });
                }
            }

            if (!options?.auditMode) {
                stageLog(ctx, "SELL_SPOT", `~${formatSolCompact(exitSpotSolPerToken)}/token`);
                stageLog(ctx, "SELL_QUOTE", `${formatSolDecimal(solOut)} for ${tokenOutUi.toFixed(6)} token`);
                stageLog(ctx, "PNL", `${pnlSol >= 0 ? "+" : "-"}${formatSolDecimal(Math.abs(pnlSol))} (${pnlPct.toFixed(2)}%)`);
            }
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
