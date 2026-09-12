import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import {
    CpAmm,
    Rounding,
    getAmountAFromLiquidityDelta,
    getAmountBFromLiquidityDelta,
} from "@meteora-ag/cp-amm-sdk";
import { CONFIG } from "../../app/config";
import { accountsTouchedByProgram, getAccountsChunked } from "./txScan";
import { DexAdapter, PoolOrientation, ResolvedPool, WSOL } from "./types";

export const METEORA_DAMM_V2_PROGRAM_ID = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";

/** Solana produce ~2,5 slot al secondo: basta per stimare lo slot tra due letture */
const SLOTS_PER_SECOND = 2.5;
const SLOT_REFRESH_MS = 60_000;

type DammPoolState = {
    poolAddress: string;
    pool: any;
    tokenAMint: string;
    tokenBMint: string;
    tokenADecimals: number;
    tokenBDecimals: number;
};

let conn: Connection | null = null;
let cpAmm: CpAmm | null = null;

/** i decimali di un mint non cambiano: una lettura per mint, non una per poll */
const decimalsCache = new Map<string, number>();
let slotAnchor: { slot: number; atMs: number } | null = null;

function client(): CpAmm {
    if (!cpAmm) throw new Error("meteora_damm_v2 adapter non inizializzato: chiamare init(connection)");
    return cpAmm;
}

/**
 * getQuote vuole lo slot corrente per i fee scheduler. Chiederlo a ogni poll
 * raddoppierebbe il carico RPC dell'hold, quindi si tiene un ancoraggio e lo si
 * estrapola: un errore di qualche slot sposta al massimo la fee di un bps.
 */
async function currentSlot(): Promise<number> {
    const now = Date.now();
    if (!slotAnchor || now - slotAnchor.atMs > SLOT_REFRESH_MS) {
        try {
            slotAnchor = { slot: await conn!.getSlot(), atMs: now };
        } catch {
            if (!slotAnchor) return 0;
        }
    }
    return slotAnchor.slot + Math.floor(((now - slotAnchor.atMs) / 1000) * SLOTS_PER_SECOND);
}

async function mintDecimals(mint: string): Promise<number> {
    const cached = decimalsCache.get(mint);
    if (cached !== undefined) return cached;
    const info = await conn!.getParsedAccountInfo(new PublicKey(mint));
    const decimals = (info.value?.data as any)?.parsed?.info?.decimals;
    const value = typeof decimals === "number" ? decimals : 9;
    decimalsCache.set(mint, value);
    return value;
}

/** wrapper sincrono: il quote non puo andare in RPC, lo slot arriva dall'ancoraggio */
function cachedSlot(): number {
    if (!slotAnchor) return 0;
    return slotAnchor.slot + Math.floor(((Date.now() - slotAnchor.atMs) / 1000) * SLOTS_PER_SECOND);
}

function quote(state: DammPoolState, inputMint: string, inAmount: BN): BN | null {
    if (inAmount.lten(0)) return null;
    try {
        const result = client().getQuote({
            inAmount,
            inputTokenMint: new PublicKey(inputMint),
            slippage: CONFIG.SLIPPAGE_PERCENT,
            poolState: state.pool,
            currentTime: Math.floor(Date.now() / 1000),
            currentSlot: cachedSlot(),
            tokenADecimal: state.tokenADecimals,
            tokenBDecimal: state.tokenBDecimals,
        });
        const out = result?.swapOutAmount;
        return out && out.gtn(0) ? out : null;
    } catch {
        return null;
    }
}

export const meteoraDammV2Adapter: DexAdapter = {
    name: "meteora_damm_v2",
    programId: METEORA_DAMM_V2_PROGRAM_ID,
    // program Anchor: l'istruzione compare nei log come `Instruction: InitializePool`
    createPoolLogMarkers: ["instruction: initializepool", "instruction: initializecustomizablepool"],

    init(connection: Connection) {
        conn = connection;
        cpAmm = new CpAmm(connection);
        slotAnchor = null;
    },

    async fetchPoolState(poolAddress: PublicKey): Promise<DammPoolState> {
        const pool = await client().fetchPoolState(poolAddress);
        const tokenAMint = pool.tokenAMint.toBase58();
        const tokenBMint = pool.tokenBMint.toBase58();
        // tiene caldo l'ancoraggio dello slot usato poi dai quote sincroni
        await currentSlot();
        return {
            poolAddress: poolAddress.toBase58(),
            pool,
            tokenAMint,
            tokenBMint,
            tokenADecimals: await mintDecimals(tokenAMint),
            tokenBDecimals: await mintDecimals(tokenBMint),
        };
    },

    /**
     * Come per ray_v4 si risolve per decodifica invece che per offset: fetchPoolState
     * fallisce su tutto cio che non e un pool, quindi il primo account che decodifica
     * ed espone un lato WSOL e quello giusto.
     */
    async resolvePoolFromCreateTx(tx: any): Promise<ResolvedPool | null> {
        const candidates = accountsTouchedByProgram(tx, METEORA_DAMM_V2_PROGRAM_ID);
        if (candidates.length === 0) return null;

        const infos = await getAccountsChunked(conn!, candidates);
        for (let i = 0; i < infos.length; i++) {
            if (infos[i]?.owner?.toBase58() !== METEORA_DAMM_V2_PROGRAM_ID) continue;
            try {
                const pool = await client().fetchPoolState(new PublicKey(candidates[i]));
                const a = pool.tokenAMint.toBase58();
                const b = pool.tokenBMint.toBase58();
                if (a !== WSOL && b !== WSOL) continue;
                return {
                    poolAddress: candidates[i],
                    tokenMint: a === WSOL ? b : a,
                    creatorAddress: pool.creator?.toBase58?.() || null,
                };
            } catch {
                // non e un pool: e una position, una config o un vault
            }
        }
        return null;
    },

    getOrientation(state: DammPoolState, tokenMint: string): PoolOrientation {
        return {
            // "base" qui significa token A, per omogeneita con gli altri adapter
            solIsBase: state.tokenAMint === WSOL,
            tokenIsBase: state.tokenAMint === tokenMint,
            hasWsol: state.tokenAMint === WSOL || state.tokenBMint === WSOL,
        };
    },

    describePoolMints(state: DammPoolState, tokenMint: string): string {
        return `base=${state.tokenAMint || "-"} quote=${state.tokenBMint || "-"} token=${tokenMint}`;
    },

    hasUsableReserves(state: any): boolean {
        // su un CLMM la riserva utile e la liquidita in range, non i saldi dei vault
        const liquidity = (state as DammPoolState)?.pool?.liquidity;
        return !!liquidity && !liquidity.isZero?.();
    },

    getSolLiquidity(state: DammPoolState, tokenMint: string): number | null {
        const { solIsBase, hasWsol } = this.getOrientation(state, tokenMint);
        if (!hasWsol) return null;
        const p = state.pool;
        try {
            // riserva estraibile del lato SOL a partire dalla liquidita in range.
            // Non coincide col saldo del vault, che include anche le fee non riscosse.
            const raw = solIsBase
                ? getAmountAFromLiquidityDelta(p.sqrtPrice, p.sqrtMaxPrice, p.liquidity, Rounding.Down, p.collectFeeMode, p.tokenAAmount, p.liquidity)
                : getAmountBFromLiquidityDelta(p.sqrtMinPrice, p.sqrtPrice, p.liquidity, Rounding.Down, p.collectFeeMode, p.tokenBAmount, p.liquidity);
            return Number(raw.toString()) / 1e9;
        } catch {
            return null;
        }
    },

    getSpotSolPerToken(state: DammPoolState, tokenMint: string, tokenDecimals: number): number | null {
        const { solIsBase, hasWsol } = this.getOrientation(state, tokenMint);
        if (!hasWsol) return null;
        // quota una frazione piccola per approssimare il prezzo spot senza price impact
        const probe = new BN(1_000_000); // 0,001 SOL
        const out = quote(state, WSOL, probe);
        if (!out || out.lten(0)) return 0;
        const sol = Number(probe.toString()) / 1e9;
        const tokens = Number(out.toString()) / 10 ** tokenDecimals;
        if (!Number.isFinite(tokens) || tokens <= 0) return 0;
        void solIsBase;
        return sol / tokens;
    },

    getEntryTokenOut(state: DammPoolState, tokenMint: string, solLamports: BN): BN | null {
        if (!this.getOrientation(state, tokenMint).hasWsol) return null;
        return quote(state, WSOL, solLamports);
    },

    getExitQuoteSol(state: DammPoolState, tokenMint: string, tokenOutAtomic: BN): number | null {
        if (!state || !tokenOutAtomic || tokenOutAtomic.lte(new BN(0))) return null;
        if (!this.getOrientation(state, tokenMint).hasWsol) return null;
        const out = quote(state, tokenMint, tokenOutAtomic);
        if (!out) return null;
        const sol = Number(out.toString()) / 1e9;
        return Number.isFinite(sol) ? sol : null;
    },
};
