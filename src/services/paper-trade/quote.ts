/**
 * Facciata storica sul layer DEX.
 *
 * La logica di prezzo vive ora in src/services/dex/ dietro l'interfaccia DexAdapter.
 * Questo file resta come punto di ingresso per i ~40 call site esistenti e instrada
 * tutto sull'adapter di default (PumpSwap). Quando la propagazione del program per
 * evento sara completa, i chiamanti prenderanno l'adapter dal registro e questa
 * facciata potra sparire.
 */
import BN from "bn.js";
import { defaultAdapter } from "../dex";

export { WSOL } from "../dex";

export function describePoolMints(state: any, tokenMint: string): string {
    return defaultAdapter.describePoolMints(state, tokenMint);
}

export function getPoolOrientation(state: any, tokenMint: string) {
    return defaultAdapter.getOrientation(state, tokenMint);
}

export function getSolLiquidityFromState(state: any, tokenMint: string): number | null {
    return defaultAdapter.getSolLiquidity(state, tokenMint);
}

export function getSpotSolPerTokenFromState(state: any, tokenMint: string, tokenDecimals: number): number | null {
    return defaultAdapter.getSpotSolPerToken(state, tokenMint, tokenDecimals);
}

export function getEntryTokenOutFromState(state: any, tokenMint: string, solLamports: BN): BN | null {
    return defaultAdapter.getEntryTokenOut(state, tokenMint, solLamports);
}

export function getExitQuoteSolFromState(state: any, tokenMint: string, tokenOutAtomic: BN): number | null {
    return defaultAdapter.getExitQuoteSol(state, tokenMint, tokenOutAtomic);
}

/** usata dai report per il prezzo spot grezzo, senza passare dall'orientamento */
export function calcSpotSolPerToken(baseReserve: BN, quoteReserve: BN, tokenDecimals: number): number {
    const baseSol = Number(baseReserve.toString()) / 1e9;
    const quoteTokens = Number(quoteReserve.toString()) / 10 ** tokenDecimals;
    if (!Number.isFinite(baseSol) || !Number.isFinite(quoteTokens) || quoteTokens <= 0) return 0;
    return baseSol / quoteTokens;
}
