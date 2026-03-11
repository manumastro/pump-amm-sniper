import { buyQuoteInput, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import BN from "bn.js";
import { CONFIG } from "../../app/config";

export const WSOL = "So11111111111111111111111111111111111111112";

export function calcSpotSolPerToken(baseReserve: BN, quoteReserve: BN, tokenDecimals: number): number {
    const baseSol = Number(baseReserve.toString()) / 1e9;
    const quoteTokens = Number(quoteReserve.toString()) / 10 ** tokenDecimals;
    if (!Number.isFinite(baseSol) || !Number.isFinite(quoteTokens) || quoteTokens <= 0) return 0;
    return baseSol / quoteTokens;
}

export function getPoolOrientation(state: any, tokenMint: string): { solIsBase: boolean; tokenIsBase: boolean; hasWsol: boolean } {
    const baseMintStr = state.baseMint?.toBase58?.() || String(state.baseMint);
    const tokenIsBase = baseMintStr === tokenMint;
    const solIsBase = baseMintStr === WSOL;
    const hasWsol = solIsBase || !tokenIsBase;
    return { solIsBase, tokenIsBase, hasWsol };
}

export function getSolLiquidityFromState(state: any, tokenMint: string): number | null {
    const { solIsBase, hasWsol } = getPoolOrientation(state, tokenMint);
    if (!hasWsol) return null;
    const solRaw = solIsBase ? state.poolBaseAmount : state.poolQuoteAmount;
    return Number(solRaw.toString()) / 1e9;
}

export function getSpotSolPerTokenFromState(state: any, tokenMint: string, tokenDecimals: number): number | null {
    const { solIsBase, hasWsol } = getPoolOrientation(state, tokenMint);
    if (!hasWsol) return null;
    return solIsBase
        ? calcSpotSolPerToken(state.poolBaseAmount, state.poolQuoteAmount, tokenDecimals)
        : calcSpotSolPerToken(state.poolQuoteAmount, state.poolBaseAmount, tokenDecimals);
}

export function getExitQuoteSolFromState(state: any, tokenMint: string, tokenOutAtomic: BN): number | null {
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
