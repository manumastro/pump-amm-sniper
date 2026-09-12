import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { OnlinePumpAmmSdk, buyQuoteInput, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import { CONFIG } from "../../app/config";
import { DexAdapter, PoolOrientation, WSOL } from "./types";

export const PUMPSWAP_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

let onlineSdk: OnlinePumpAmmSdk | null = null;

export function initPumpSwapSdk(connection: Connection) {
    onlineSdk = new OnlinePumpAmmSdk(connection);
}

function toMintString(value: any): string {
    if (!value) return "";
    return value?.toBase58?.() || String(value);
}

function calcSpotSolPerToken(baseReserve: BN, quoteReserve: BN, tokenDecimals: number): number {
    const baseSol = Number(baseReserve.toString()) / 1e9;
    const quoteTokens = Number(quoteReserve.toString()) / 10 ** tokenDecimals;
    if (!Number.isFinite(baseSol) || !Number.isFinite(quoteTokens) || quoteTokens <= 0) return 0;
    return baseSol / quoteTokens;
}

/** I campi che l'SDK Pump richiede a ogni quote, identici per entry e exit. */
function quoteArgs(state: any) {
    return {
        slippage: CONFIG.SLIPPAGE_PERCENT,
        baseReserve: state.poolBaseAmount,
        quoteReserve: state.poolQuoteAmount,
        baseMintAccount: state.baseMintAccount,
        baseMint: state.baseMint,
        coinCreator: state.pool.coinCreator,
        creator: state.pool.creator,
        feeConfig: state.feeConfig,
        globalConfig: state.globalConfig,
    };
}

export const pumpSwapAdapter: DexAdapter = {
    name: "pumpswap",
    programId: PUMPSWAP_PROGRAM_ID,
    createPoolLogMarkers: ["create_pool", "createpool"],

    init(connection: Connection) {
        initPumpSwapSdk(connection);
    },

    async fetchPoolState(poolAddress: PublicKey, user: PublicKey) {
        if (!onlineSdk) throw new Error("pumpswap adapter non inizializzato: chiamare init(connection)");
        return await onlineSdk.swapSolanaState(poolAddress, user);
    },

    getOrientation(state: any, tokenMint: string): PoolOrientation {
        const baseMintStr = toMintString(state?.baseMint);
        const quoteMintStr = toMintString(state?.quoteMint);
        return {
            solIsBase: baseMintStr === WSOL,
            tokenIsBase: baseMintStr === tokenMint,
            hasWsol: baseMintStr === WSOL || quoteMintStr === WSOL,
        };
    },

    describePoolMints(state: any, tokenMint: string): string {
        const baseMintStr = toMintString(state?.baseMint) || "-";
        const quoteMintStr = toMintString(state?.quoteMint) || "-";
        return `base=${baseMintStr} quote=${quoteMintStr} token=${tokenMint}`;
    },

    getSolLiquidity(state: any, tokenMint: string): number | null {
        const { solIsBase, hasWsol } = this.getOrientation(state, tokenMint);
        if (!hasWsol) return null;
        const solRaw = solIsBase ? state.poolBaseAmount : state.poolQuoteAmount;
        return Number(solRaw.toString()) / 1e9;
    },

    getSpotSolPerToken(state: any, tokenMint: string, tokenDecimals: number): number | null {
        const { solIsBase, hasWsol } = this.getOrientation(state, tokenMint);
        if (!hasWsol) return null;
        return solIsBase
            ? calcSpotSolPerToken(state.poolBaseAmount, state.poolQuoteAmount, tokenDecimals)
            : calcSpotSolPerToken(state.poolQuoteAmount, state.poolBaseAmount, tokenDecimals);
    },

    getEntryTokenOut(state: any, tokenMint: string, solLamports: BN): BN | null {
        const orientation = this.getOrientation(state, tokenMint);
        if (!orientation.hasWsol) return null;
        try {
            return orientation.solIsBase
                ? sellBaseInput({ base: solLamports, ...quoteArgs(state) }).uiQuote
                : buyQuoteInput({ quote: solLamports, ...quoteArgs(state) }).base;
        } catch {
            return null;
        }
    },

    getExitQuoteSol(state: any, tokenMint: string, tokenOutAtomic: BN): number | null {
        if (!state || !tokenOutAtomic || tokenOutAtomic.lte(new BN(0))) return null;
        const orientation = this.getOrientation(state, tokenMint);
        if (!orientation.hasWsol) return null;
        try {
            // orientamento invertito rispetto all'entry: qui si vende il token
            const solOutRaw = orientation.solIsBase
                ? buyQuoteInput({ quote: tokenOutAtomic, ...quoteArgs(state) }).base
                : sellBaseInput({ base: tokenOutAtomic, ...quoteArgs(state) }).uiQuote;
            const solOut = Number(solOutRaw.toString()) / 1e9;
            return Number.isFinite(solOut) ? solOut : null;
        } catch {
            return null;
        }
    },
};
