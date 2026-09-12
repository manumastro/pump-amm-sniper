import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { OnlinePumpAmmSdk, buyQuoteInput, sellBaseInput } from "@pump-fun/pump-swap-sdk";
import { CONFIG } from "../../app/config";
import { instructionAccountToBase58, pubkeyToBase58 } from "../../utils/pubkeys";
import { instructionsForProgram } from "./txScan";
import { DexAdapter, PoolOrientation, ResolvedPool, WSOL } from "./types";

export const PUMPSWAP_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

let onlineSdk: OnlinePumpAmmSdk | null = null;

export function initPumpSwapSdk(connection: Connection) {
    onlineSdk = new OnlinePumpAmmSdk(connection);
}

function toMintString(value: any): string {
    if (!value) return "";
    return value?.toBase58?.() || String(value);
}

/**
 * swapSolanaState espone `baseMint` in cima ma **non** `quoteMint`: quello sta dentro
 * `state.pool`. Leggendolo dal posto sbagliato risulta sempre vuoto, e il pool sembra
 * senza lato WSOL ogni volta che il layout e base=token / quote=WSOL — che e la meta
 * dei pool PumpSwap. Il bot li scartava come "liquidita non leggibile".
 */
function poolMints(state: any): { base: string; quote: string } {
    return {
        base: toMintString(state?.baseMint ?? state?.pool?.baseMint),
        quote: toMintString(state?.quoteMint ?? state?.pool?.quoteMint),
    };
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

/**
 * Ultima spiaggia comune a tutti gli AMM: la creazione compare comunque nei token
 * balance della tx. Il token e il mint che non e WSOL, il pool e il proprietario
 * dell'account WSOL che non appartiene al signer.
 */
export function resolveFromTokenBalances(tx: any): ResolvedPool | null {
    const balances = tx?.meta?.postTokenBalances || [];
    const tokenBalance = balances.find((b: any) => b.mint !== WSOL);
    if (!tokenBalance) return null;

    const signer = pubkeyToBase58(tx?.transaction?.message?.accountKeys?.[0]);
    const poolBalance = balances.find((b: any) => b.mint === WSOL && b.owner && b.owner !== signer);
    if (!poolBalance) return null;

    // creator lasciato nullo di proposito: il chiamante lo risolve dal pool on-chain,
    // che e piu affidabile del signer della tx di creazione
    return { poolAddress: poolBalance.owner, tokenMint: tokenBalance.mint, creatorAddress: null };
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

    /**
     * Ordine account di create_pool secondo l'IDL Pump:
     * pool=0, global_config=1, creator=2, base_mint=3, quote_mint=4.
     *
     * Il pool viene sempre confrontato con quello ricavato dai token balance della tx.
     * Serve perche la creazione arriva spesso come CPI (migrazione dalla bonding curve) e
     * fra le istruzioni interne ce ne sono altre dello stesso program — swap compresi —
     * con abbastanza account da superare un controllo basato sui soli offset. Leggendo il
     * loro account[0] come se fosse un pool si ottiene un indirizzo plausibile e sbagliato,
     * che poi non quota. I token balance dicono invece con certezza chi possiede il conto
     * WSOL del pool, quindi fanno da verifica; l'istruzione serve solo per il creator,
     * che i balance non conoscono.
     */
    async resolvePoolFromCreateTx(tx: any): Promise<ResolvedPool | null> {
        const accountKeys = tx?.transaction?.message?.accountKeys || [];
        const fromBalances = resolveFromTokenBalances(tx);

        let firstWsolCandidate: ResolvedPool | null = null;

        for (const ix of instructionsForProgram(tx, PUMPSWAP_PROGRAM_ID)) {
            const ixAccounts = Array.isArray(ix.accounts) ? ix.accounts : [];
            if (ixAccounts.length < 5) continue;

            const pool = instructionAccountToBase58(ixAccounts[0], accountKeys);
            const creator = instructionAccountToBase58(ixAccounts[2], accountKeys);
            const baseMint = instructionAccountToBase58(ixAccounts[3], accountKeys);
            const quoteMint = instructionAccountToBase58(ixAccounts[4], accountKeys);
            if (!pool || !baseMint || quoteMint !== WSOL) continue;

            const candidate: ResolvedPool = { poolAddress: pool, tokenMint: baseMint, creatorAddress: creator };
            if (fromBalances && pool === fromBalances.poolAddress) return candidate;
            if (!firstWsolCandidate) firstWsolCandidate = candidate;
        }

        // i balance hanno l'ultima parola sul pool; l'istruzione contribuisce il creator
        // solo se parlava dello stesso pool, altrimenti lo risolve il chiamante on-chain
        if (fromBalances) return fromBalances;
        return firstWsolCandidate;
    },

    getOrientation(state: any, tokenMint: string): PoolOrientation {
        const { base, quote } = poolMints(state);
        return {
            solIsBase: base === WSOL,
            tokenIsBase: base === tokenMint,
            hasWsol: base === WSOL || quote === WSOL,
        };
    },

    describePoolMints(state: any, tokenMint: string): string {
        const { base, quote } = poolMints(state);
        return `base=${base || "-"} quote=${quote || "-"} token=${tokenMint}`;
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
