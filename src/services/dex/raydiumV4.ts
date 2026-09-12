import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { pubkeyToBase58 } from "../../utils/pubkeys";
import { accountsTouchedByProgram, getAccountsChunked } from "./txScan";
import { DexAdapter, PoolOrientation, ResolvedPool, WSOL } from "./types";

export const RAYDIUM_V4_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

/**
 * Offset di LIQUIDITY_STATE_LAYOUT_V4 (752 byte, tutti u64 LE salvo le pubkey).
 * Verificati contro il pool SOL-USDC 58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2.
 */
const POOL_STATE_LEN = 752;
const OFF = {
    baseDecimal: 32,
    quoteDecimal: 40,
    swapFeeNumerator: 176,
    swapFeeDenominator: 184,
    baseNeedTakePnl: 192,
    quoteNeedTakePnl: 200,
    baseVault: 336,
    quoteVault: 368,
    baseMint: 400,
    quoteMint: 432,
};

/** offset del campo `amount` in un token account SPL */
const TOKEN_ACCOUNT_AMOUNT_OFF = 64;

type RayPoolState = {
    poolAddress: string;
    baseMint: string;
    quoteMint: string;
    baseDecimals: number;
    quoteDecimals: number;
    /** riserve nette, gia al netto dei PnL non ancora prelevati */
    baseReserve: BN;
    quoteReserve: BN;
    feeNumerator: BN;
    feeDenominator: BN;
};

let conn: Connection | null = null;

/**
 * I vault di un pool non cambiano mai. Memorizzandoli, dal secondo fetch in poi
 * lo stato completo costa una sola getMultipleAccountsInfo invece di due round trip:
 * conta, perche l'hold monitor ripete questa lettura ogni 200ms.
 */
const vaultCache = new Map<string, { baseVault: PublicKey; quoteVault: PublicKey }>();

function u64(data: Buffer, offset: number): BN {
    return new BN(data.subarray(offset, offset + 8), "le");
}

function pk(data: Buffer, offset: number): PublicKey {
    return new PublicKey(data.subarray(offset, offset + 32));
}

function readVaultAmount(info: any): BN {
    if (!info?.data || info.data.length < TOKEN_ACCOUNT_AMOUNT_OFF + 8) {
        throw new Error("token account illeggibile");
    }
    return u64(info.data, TOKEN_ACCOUNT_AMOUNT_OFF);
}

/** x*y=k con la fee di swap applicata all'input, come fa il program on-chain */
function constantProductOut(amountIn: BN, reserveIn: BN, reserveOut: BN, feeNum: BN, feeDen: BN): BN | null {
    if (amountIn.lten(0) || reserveIn.lten(0) || reserveOut.lten(0)) return null;
    const amountInAfterFee = amountIn.mul(feeDen.sub(feeNum)).div(feeDen);
    if (amountInAfterFee.lten(0)) return null;
    const out = reserveOut.mul(amountInAfterFee).div(reserveIn.add(amountInAfterFee));
    if (out.lten(0) || out.gte(reserveOut)) return null;
    return out;
}

export const raydiumV4Adapter: DexAdapter = {
    name: "ray_v4",
    programId: RAYDIUM_V4_PROGRAM_ID,
    // il program logga `initialize2: InitializeInstruction2 { ... }` alla creazione
    createPoolLogMarkers: ["initialize2"],

    init(connection: Connection) {
        conn = connection;
    },

    async fetchPoolState(poolAddress: PublicKey): Promise<RayPoolState> {
        if (!conn) throw new Error("ray_v4 adapter non inizializzato: chiamare init(connection)");
        const key = poolAddress.toBase58();

        const cached = vaultCache.get(key);
        const keys = cached ? [poolAddress, cached.baseVault, cached.quoteVault] : [poolAddress];
        let [poolInfo, baseVaultInfo, quoteVaultInfo] = await conn.getMultipleAccountsInfo(keys);

        if (!poolInfo?.data || poolInfo.data.length < POOL_STATE_LEN) {
            throw new Error(`ray_v4: account ${key} non e un pool AMM v4`);
        }
        const data = poolInfo.data;

        if (!cached) {
            const baseVault = pk(data, OFF.baseVault);
            const quoteVault = pk(data, OFF.quoteVault);
            vaultCache.set(key, { baseVault, quoteVault });
            [baseVaultInfo, quoteVaultInfo] = await conn.getMultipleAccountsInfo([baseVault, quoteVault]);
        }

        // le riserve reali sono il saldo dei vault meno i PnL che il pool deve ancora pagare
        const baseReserve = readVaultAmount(baseVaultInfo).sub(u64(data, OFF.baseNeedTakePnl));
        const quoteReserve = readVaultAmount(quoteVaultInfo).sub(u64(data, OFF.quoteNeedTakePnl));

        return {
            poolAddress: key,
            baseMint: pk(data, OFF.baseMint).toBase58(),
            quoteMint: pk(data, OFF.quoteMint).toBase58(),
            baseDecimals: u64(data, OFF.baseDecimal).toNumber(),
            quoteDecimals: u64(data, OFF.quoteDecimal).toNumber(),
            baseReserve: BN.max(baseReserve, new BN(0)),
            quoteReserve: BN.max(quoteReserve, new BN(0)),
            feeNumerator: u64(data, OFF.swapFeeNumerator),
            feeDenominator: u64(data, OFF.swapFeeDenominator),
        };
    },

    /**
     * L'ordine account di `initialize2` non e stabile tra le versioni del program, quindi
     * invece di fidarsi di un offset si prova a decodificare come pool ogni account
     * dell'istruzione: solo uno ha 752 byte ed e di proprieta del program.
     * Costa qualche getAccountInfo, ma solo qui e non nel loop di hold.
     */
    async resolvePoolFromCreateTx(tx: any): Promise<ResolvedPool | null> {
        if (!conn) throw new Error("ray_v4 adapter non inizializzato: chiamare init(connection)");

        const accountKeys = tx?.transaction?.message?.accountKeys || [];
        const candidates = accountsTouchedByProgram(tx, RAYDIUM_V4_PROGRAM_ID);
        if (candidates.length === 0) return null;

        const infos = await getAccountsChunked(conn, candidates);
        for (let i = 0; i < infos.length; i++) {
            const info = infos[i];
            if (!info?.data) continue;
            if (info.data.length < POOL_STATE_LEN) continue;
            if (info.owner.toBase58() !== RAYDIUM_V4_PROGRAM_ID) continue;

            const baseMint = pk(info.data, OFF.baseMint).toBase58();
            const quoteMint = pk(info.data, OFF.quoteMint).toBase58();
            if (baseMint !== WSOL && quoteMint !== WSOL) continue;

            return {
                poolAddress: candidates[i],
                tokenMint: baseMint === WSOL ? quoteMint : baseMint,
                // il pool v4 non memorizza il creator: il payer della tx di init e il
                // riferimento migliore disponibile
                creatorAddress: pubkeyToBase58(accountKeys[0]),
            };
        }
        return null;
    },

    getOrientation(state: RayPoolState, tokenMint: string): PoolOrientation {
        return {
            solIsBase: state.baseMint === WSOL,
            tokenIsBase: state.baseMint === tokenMint,
            hasWsol: state.baseMint === WSOL || state.quoteMint === WSOL,
        };
    },

    describePoolMints(state: RayPoolState, tokenMint: string): string {
        return `base=${state.baseMint || "-"} quote=${state.quoteMint || "-"} token=${tokenMint}`;
    },

    hasUsableReserves(state: any): boolean {
        const st = state as RayPoolState;
        return !!st?.baseReserve?.gt?.(new BN(0)) && !!st?.quoteReserve?.gt?.(new BN(0));
    },

    getSolLiquidity(state: RayPoolState, tokenMint: string): number | null {
        const { solIsBase, hasWsol } = this.getOrientation(state, tokenMint);
        if (!hasWsol) return null;
        const raw = solIsBase ? state.baseReserve : state.quoteReserve;
        return Number(raw.toString()) / 1e9;
    },

    getSpotSolPerToken(state: RayPoolState, tokenMint: string, tokenDecimals: number): number | null {
        const { solIsBase, hasWsol } = this.getOrientation(state, tokenMint);
        if (!hasWsol) return null;
        const solRaw = solIsBase ? state.baseReserve : state.quoteReserve;
        const tokenRaw = solIsBase ? state.quoteReserve : state.baseReserve;
        const sol = Number(solRaw.toString()) / 1e9;
        const tokens = Number(tokenRaw.toString()) / 10 ** tokenDecimals;
        if (!Number.isFinite(sol) || !Number.isFinite(tokens) || tokens <= 0) return 0;
        return sol / tokens;
    },

    getEntryTokenOut(state: RayPoolState, tokenMint: string, solLamports: BN): BN | null {
        const { solIsBase, hasWsol } = this.getOrientation(state, tokenMint);
        if (!hasWsol) return null;
        const reserveIn = solIsBase ? state.baseReserve : state.quoteReserve;
        const reserveOut = solIsBase ? state.quoteReserve : state.baseReserve;
        return constantProductOut(solLamports, reserveIn, reserveOut, state.feeNumerator, state.feeDenominator);
    },

    getExitQuoteSol(state: RayPoolState, tokenMint: string, tokenOutAtomic: BN): number | null {
        if (!state || !tokenOutAtomic || tokenOutAtomic.lte(new BN(0))) return null;
        const { solIsBase, hasWsol } = this.getOrientation(state, tokenMint);
        if (!hasWsol) return null;
        // orientamento invertito rispetto all'entry: qui si vende il token
        const reserveIn = solIsBase ? state.quoteReserve : state.baseReserve;
        const reserveOut = solIsBase ? state.baseReserve : state.quoteReserve;
        const out = constantProductOut(tokenOutAtomic, reserveIn, reserveOut, state.feeNumerator, state.feeDenominator);
        if (!out) return null;
        const sol = Number(out.toString()) / 1e9;
        return Number.isFinite(sol) ? sol : null;
    },
};
