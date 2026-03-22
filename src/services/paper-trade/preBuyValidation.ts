import { buyQuoteInput, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { Connection } from "@solana/web3.js";
import { CONFIG } from "../../app/config";
import { CreatorRiskResult, PaperSimulationOptions, PreBuyEntryValidationResult } from "../../domain/types";
import { stageLog } from "../reporting/stageLog";
import { formatSolCompact } from "../../utils/format";
import { shortSig } from "../../utils/pubkeys";
import { describePoolMints, getPoolOrientation, getSolLiquidityFromState, getSpotSolPerTokenFromState } from "./quote";

type ValidatePreBuyDeps = {
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
    ) => Promise<{
        detected: boolean;
        signature?: string | null;
        wsolToCreator?: number;
        solToCreator?: number;
        tokenToCreator?: number;
    }>;
};

function quoteTokenOutFromState(
    state: any,
    tokenMint: string,
    buyAmountLamports: BN,
    tokenDecimals: number,
): { tokenOutAtomic: BN; tokenOutUi: number; orientation: { solIsBase: boolean; tokenIsBase: boolean; hasWsol: boolean } } | null {
    const orientation = getPoolOrientation(state, tokenMint);
    if (!orientation.hasWsol) return null;

    let tokenOutAtomic: BN;
    if (orientation.solIsBase) {
        const entry = sellBaseInput({
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
        });
        tokenOutAtomic = entry.uiQuote;
    } else {
        const entry = buyQuoteInput({
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
        });
        tokenOutAtomic = entry.base;
    }

    const tokenOutUi = Number(tokenOutAtomic.toString()) / 10 ** tokenDecimals;
    if (tokenOutAtomic.lte(new BN(0)) || !Number.isFinite(tokenOutUi) || tokenOutUi <= 0) {
        return null;
    }

    return { tokenOutAtomic, tokenOutUi, orientation };
}

export async function validatePreBuyEntryState(
    deps: ValidatePreBuyDeps,
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
): Promise<PreBuyEntryValidationResult> {
    if (
        creatorAddress &&
        CONFIG.PRE_BUY_FINAL_CREATOR_RISK_RECHECK_ENABLED &&
        !options?.skipCreatorRiskRecheck
    ) {
        const creatorRisk = await deps.recheckCreatorRisk(
            connection,
            creatorAddress,
            ctx,
            baselineLiquiditySol,
            createPoolSignature,
            createPoolBlockTime,
            initialCreatorRisk,
        );
        if (!creatorRisk.ok) {
            if (creatorRisk.transientError) {
                return { ok: false, reason: `creator risk recheck (${creatorRisk.reason})` };
            }

            if (options?.suppressCreatorRiskRecheck) {
                const baselineCreatorCashoutSol = Number(initialCreatorRisk?.creatorCashoutSol || 0);
                const probationEscalation = deps.shouldEscalateProbationCreatorRisk(
                    creatorRisk,
                    baselineCreatorCashoutSol,
                );
                if (probationEscalation.escalate) {
                    return {
                        ok: false,
                        reason:
                            `creator risk recheck (${creatorRisk.reason}) ` +
                            `[probation hard, cashout_delta=${probationEscalation.cashoutDeltaSol.toFixed(3)} SOL]`,
                    };
                }
            } else {
                return { ok: false, reason: `creator risk recheck (${creatorRisk.reason})` };
            }
        }
    }

    if (creatorAddress && poolAddress && CONFIG.PRE_BUY_FINAL_REMOVE_LIQ_CHECK_ENABLED) {
        const removeLiq = await deps.detectRemoveLiquiditySince(
            connection,
            poolAddress,
            creatorAddress,
            tokenMint,
            new Set<string>(),
            createPoolSignature,
            createPoolBlockTime,
        );
        if (removeLiq.detected) {
            return {
                ok: false,
                reason:
                    `remove liquidity detected before entry ` +
                    `(${shortSig(removeLiq.signature || "-")}, ` +
                    `wsol=${Number(removeLiq.wsolToCreator || 0).toFixed(3)} ` +
                    `sol=${Number(removeLiq.solToCreator || 0).toFixed(3)} ` +
                    `token=${Number(removeLiq.tokenToCreator || 0).toFixed(3)})`,
            };
        }
    }

    const entryState = await fetchStateWithRetry();
    if (!entryState) {
        return { ok: false, reason: "entry state unavailable" };
    }

    const entryQuote = quoteTokenOutFromState(entryState, tokenMint, buyAmountLamports, tokenDecimals);
    if (!entryQuote) {
        return { ok: false, reason: `pool has no WSOL side (${describePoolMints(entryState, tokenMint)})` };
    }

    let effectiveEntryState = entryState;
    let effectiveEntryQuote = entryQuote;
    const entrySolLiquidity = getSolLiquidityFromState(effectiveEntryState, tokenMint) || 0;
    const minAllowedLiq = baselineLiquiditySol > 0
        ? baselineLiquiditySol * (1 - Math.abs(CONFIG.PRE_BUY_REVALIDATION_MAX_LIQ_DROP_PCT) / 100)
        : CONFIG.MIN_POOL_LIQUIDITY_SOL;
    if (
        CONFIG.PRE_BUY_REVALIDATION_ENABLED &&
        (
            entrySolLiquidity < CONFIG.MIN_POOL_LIQUIDITY_SOL ||
            (baselineLiquiditySol > 0 && entrySolLiquidity < minAllowedLiq)
        )
    ) {
        stageLog(ctx, "PREBUY", `liq ${entrySolLiquidity.toFixed(6)} SOL (baseline ${baselineLiquiditySol.toFixed(2)} SOL)`);
        return { ok: false, reason: `liquidity ${entrySolLiquidity.toFixed(6)} SOL below revalidation threshold` };
    }

    if (CONFIG.PRE_BUY_ULTRA_SHORT_RUG_GUARD_ENABLED) {
        const guardWindowMs = Math.max(0, CONFIG.PRE_BUY_ULTRA_SHORT_RUG_GUARD_WINDOW_MS);
        const guardIntervalMs = Math.max(100, CONFIG.PRE_BUY_ULTRA_SHORT_RUG_GUARD_INTERVAL_MS);
        const guardStartMs = Date.now();
        let maxObservedLiqDropPct = 0;
        let maxObservedQuoteDropPct = 0;

        while (Date.now() - guardStartMs < guardWindowMs) {
            await new Promise((r) => setTimeout(r, guardIntervalMs));
            const probeState = await fetchStateWithRetry();
            if (!probeState) {
                return { ok: false, reason: "ultra-short rug guard state unavailable" };
            }

            const probeQuote = quoteTokenOutFromState(probeState, tokenMint, buyAmountLamports, tokenDecimals);
            if (!probeQuote) {
                return { ok: false, reason: `pool has no WSOL side (${describePoolMints(probeState, tokenMint)})` };
            }

            const probeSolLiquidity = getSolLiquidityFromState(probeState, tokenMint) || 0;
            if (!Number.isFinite(probeSolLiquidity) || probeSolLiquidity <= 0) {
                return { ok: false, reason: "ultra-short rug guard invalid liquidity" };
            }

            const liqDropPct = entrySolLiquidity > 0
                ? ((entrySolLiquidity - probeSolLiquidity) / entrySolLiquidity) * 100
                : 0;
            if (Number.isFinite(liqDropPct)) {
                maxObservedLiqDropPct = Math.max(maxObservedLiqDropPct, liqDropPct);
            }
            if (Number.isFinite(liqDropPct) && liqDropPct >= CONFIG.PRE_BUY_ULTRA_SHORT_RUG_GUARD_MAX_LIQ_DROP_PCT) {
                stageLog(ctx, "PREBUY", `ultra-guard liq drop ${liqDropPct.toFixed(2)}% in ${Date.now() - guardStartMs}ms`);
                return { ok: false, reason: `ultra-short rug guard liquidity drop ${liqDropPct.toFixed(2)}%` };
            }

            const quoteDropPct = ((effectiveEntryQuote.tokenOutUi - probeQuote.tokenOutUi) / effectiveEntryQuote.tokenOutUi) * 100;
            if (Number.isFinite(quoteDropPct)) {
                maxObservedQuoteDropPct = Math.max(maxObservedQuoteDropPct, quoteDropPct);
            }
            if (Number.isFinite(quoteDropPct) && quoteDropPct >= CONFIG.PRE_BUY_ULTRA_SHORT_RUG_GUARD_MAX_QUOTE_DROP_PCT) {
                stageLog(ctx, "PREBUY", `ultra-guard quote drop ${quoteDropPct.toFixed(2)}% in ${Date.now() - guardStartMs}ms`);
                return { ok: false, reason: `ultra-short rug guard quote drop ${quoteDropPct.toFixed(2)}%` };
            }

            effectiveEntryState = probeState;
            effectiveEntryQuote = probeQuote;
        }

        stageLog(
            ctx,
            "PREGUARD",
            `ultra-short pass ` +
                `liq_drop_max=${maxObservedLiqDropPct.toFixed(2)}% ` +
                `quote_drop_max=${maxObservedQuoteDropPct.toFixed(2)}% ` +
                `(max_liq=${CONFIG.PRE_BUY_ULTRA_SHORT_RUG_GUARD_MAX_LIQ_DROP_PCT.toFixed(2)}% ` +
                `max_quote=${CONFIG.PRE_BUY_ULTRA_SHORT_RUG_GUARD_MAX_QUOTE_DROP_PCT.toFixed(2)}% ` +
                `window=${guardWindowMs}ms interval=${guardIntervalMs}ms)`
        );
    }

    const tokenOutAtomic = effectiveEntryQuote.tokenOutAtomic;
    const tokenOutUi = effectiveEntryQuote.tokenOutUi;

    const entrySpotSolPerToken = getSpotSolPerTokenFromState(effectiveEntryState, tokenMint, tokenDecimals) || 0;
    if (CONFIG.PRE_BUY_REVALIDATION_ENABLED && entrySpotSolPerToken > 0) {
        const quoteSolPerToken = CONFIG.TRADE_AMOUNT_SOL / tokenOutUi;
        const quoteVsSpotRatio = quoteSolPerToken / entrySpotSolPerToken;
        if (
            Number.isFinite(quoteVsSpotRatio) &&
            quoteVsSpotRatio > Math.max(1, CONFIG.PRE_BUY_REVALIDATION_MAX_QUOTE_VS_SPOT_RATIO)
        ) {
            stageLog(
                ctx,
                "PREBUY",
                `quote_vs_spot=${quoteVsSpotRatio.toFixed(2)}x spot=${formatSolCompact(entrySpotSolPerToken)}/token`,
            );
            return { ok: false, reason: `quote sanity ${quoteVsSpotRatio.toFixed(2)}x spot` };
        }
    }

    return {
        ok: true,
        entryState: effectiveEntryState,
        tokenOutAtomic,
        tokenOutUi,
        entrySpotSolPerToken,
    };
}
