import { buyQuoteInput, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { Connection } from "@solana/web3.js";
import { CONFIG } from "../../app/config";
import { CreatorRiskResult, PaperSimulationOptions, PreBuyEntryValidationResult } from "../../domain/types";
import { stageLog } from "../reporting/stageLog";
import { formatSolCompact } from "../../utils/format";
import { shortSig } from "../../utils/pubkeys";
import { getPoolOrientation, getSolLiquidityFromState, getSpotSolPerTokenFromState } from "./quote";

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

    const orientation = getPoolOrientation(entryState, tokenMint);
    if (!orientation.hasWsol) {
        return { ok: false, reason: "pool has no WSOL side" };
    }

    const entrySolLiquidity = getSolLiquidityFromState(entryState, tokenMint) || 0;
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
    if (tokenOutAtomic.lte(new BN(0)) || !Number.isFinite(tokenOutUi) || tokenOutUi <= 0) {
        return { ok: false, reason: "entry produced 0 tokens" };
    }

    const entrySpotSolPerToken = getSpotSolPerTokenFromState(entryState, tokenMint, tokenDecimals) || 0;
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
        entryState,
        tokenOutAtomic,
        tokenOutUi,
        entrySpotSolPerToken,
    };
}
