import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { CONFIG } from "../../app/config";
import { pubkeyToBase58 } from "../../utils/pubkeys";
import { accountsTouchedByProgram, getAccountsChunked } from "./txScan";
import { DexAdapter, PoolOrientation, ResolvedPool, WSOL } from "./types";

export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

/**
 * Layout dell'account BondingCurve, verificato il 2026-09-12 contro curve reali
 * (discriminator 17b7f83760d8ac60, 125 byte).
 */
const CURVE_MIN_LEN = 49;
const OFF = {
    virtualTokenReserves: 8,
    virtualSolReserves: 16,
    realTokenReserves: 24,
    realSolReserves: 32,
    tokenTotalSupply: 40,
    complete: 48,
    creator: 49,
};

type CurveState = {
    curveAddress: string;
    tokenMint: string;
    virtualTokenReserves: BN;
    virtualSolReserves: BN;
    realTokenReserves: BN;
    realSolReserves: BN;
    /** true = curva completata e migrata su PumpSwap: non si scambia piu qui */
    complete: boolean;
    creator: string | null;
};

let conn: Connection | null = null;

/** il mint di una curva non cambia: evita di ri-derivarlo a ogni poll */
const mintByCurve = new Map<string, string>();

function u64(data: Buffer, offset: number): BN {
    return new BN(data.subarray(offset, offset + 8), "le");
}

function ceilDiv(a: BN, b: BN): BN {
    const { div, mod } = a.divmod(b);
    return mod.isZero() ? div : div.addn(1);
}

export function deriveBondingCurve(mint: string): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
        new PublicKey(PUMP_PROGRAM_ID),
    );
    return pda;
}

function decodeCurve(address: string, data: Buffer, tokenMint: string): CurveState {
    return {
        curveAddress: address,
        tokenMint,
        virtualTokenReserves: u64(data, OFF.virtualTokenReserves),
        virtualSolReserves: u64(data, OFF.virtualSolReserves),
        realTokenReserves: u64(data, OFF.realTokenReserves),
        realSolReserves: u64(data, OFF.realSolReserves),
        complete: data[OFF.complete] === 1,
        creator: data.length >= OFF.creator + 32
            ? new PublicKey(data.subarray(OFF.creator, OFF.creator + 32)).toBase58()
            : null,
    };
}

const BPS = new BN(10000);

function totalFeeBps(): BN {
    return new BN(Math.max(0, CONFIG.PUMP_CURVE_FEE_BPS));
}

/** true se la curva non e scambiabile: migrata, vuota, o stato illeggibile */
function unusable(state: CurveState | null | undefined): boolean {
    return !state
        || state.complete
        || state.virtualSolReserves.lten(0)
        || state.virtualTokenReserves.lten(0);
}

export const pumpBondingCurveAdapter: DexAdapter = {
    name: "pump",
    programId: PUMP_PROGRAM_ID,
    // l'istruzione si chiama CreateV2. Una sottostringa "create" colpirebbe anche
    // CreateTokenAccount e CreatePool, che compaiono nella stessa transazione.
    createPoolLogMarkers: [/Program log: Instruction: Create(V\d+)?$/],

    init(connection: Connection) {
        conn = connection;
    },

    async fetchPoolState(poolAddress: PublicKey): Promise<CurveState> {
        if (!conn) throw new Error("pump adapter non inizializzato: chiamare init(connection)");
        const address = poolAddress.toBase58();
        const info = await conn.getAccountInfo(poolAddress);
        if (!info?.data || info.data.length < CURVE_MIN_LEN) {
            throw new Error(`pump: ${address} non e una bonding curve`);
        }
        return decodeCurve(address, info.data, mintByCurve.get(address) || "");
    },

    /**
     * La curva e un PDA deterministico del mint (`["bonding-curve", mint]`), quindi non
     * serve nessun offset di istruzione: basta trovare il mint e derivarla. E il motivo
     * per cui questo adapter e piu solido di quelli AMM su questo passaggio.
     */
    async resolvePoolFromCreateTx(tx: any): Promise<ResolvedPool | null> {
        if (!conn) throw new Error("pump adapter non inizializzato: chiamare init(connection)");

        // il mint nuovo compare nei token balance della tx; WSOL e l'eventuale dev buy
        const balanceMints = (tx?.meta?.postTokenBalances || [])
            .map((b: any) => b.mint)
            .filter((m: string) => m && m !== WSOL);

        const candidates: string[] = [...new Set<string>(balanceMints)];
        // ripiego: fra gli account toccati da pump c'e comunque il mint
        for (const addr of accountsTouchedByProgram(tx, PUMP_PROGRAM_ID)) {
            if (!candidates.includes(addr)) candidates.push(addr);
        }
        if (candidates.length === 0) return null;

        const curves = candidates.map((m) => {
            try { return deriveBondingCurve(m).toBase58(); } catch { return null; }
        });
        const infos = await getAccountsChunked(conn, curves.filter((c): c is string => !!c));

        let i = -1;
        for (let k = 0; k < curves.length; k++) {
            if (!curves[k]) continue;
            i++;
            const info = infos[i];
            if (!info?.data || info.data.length < CURVE_MIN_LEN) continue;
            if (info.owner.toBase58() !== PUMP_PROGRAM_ID) continue;

            const mint = candidates[k];
            const curveAddress = curves[k] as string;
            mintByCurve.set(curveAddress, mint);
            const state = decodeCurve(curveAddress, info.data, mint);
            return {
                // per il resto del bot la curva E il pool: e cio che si legge a ogni poll
                poolAddress: curveAddress,
                tokenMint: mint,
                creatorAddress: state.creator || pubkeyToBase58(tx?.transaction?.message?.accountKeys?.[0]),
            };
        }
        return null;
    },

    getOrientation(state: CurveState, tokenMint: string): PoolOrientation {
        // Una bonding curve e sempre denominata in SOL: non c'e un lato WSOL da cercare
        // ne un orientamento da indovinare. hasWsol qui significa "so prezzarlo", ed e
        // vero finche la curva non e migrata.
        return {
            solIsBase: true,
            tokenIsBase: false,
            hasWsol: !unusable(state),
        };
    },

    describePoolMints(state: CurveState, tokenMint: string): string {
        return `curve=${state?.curveAddress || "-"} token=${tokenMint}`
            + `${state?.complete ? " (migrata su PumpSwap)" : ""}`;
    },

    getSolLiquidity(state: CurveState, tokenMint: string): number | null {
        if (unusable(state)) return null;
        // realSolReserves, non virtualSolReserves: le virtuali includono l'offset
        // iniziale della curva, che non e SOL che qualcuno possa portarsi via.
        return Number(state.realSolReserves.toString()) / 1e9;
    },

    getSpotSolPerToken(state: CurveState, tokenMint: string, tokenDecimals: number): number | null {
        if (unusable(state)) return null;
        const sol = Number(state.virtualSolReserves.toString()) / 1e9;
        const tokens = Number(state.virtualTokenReserves.toString()) / 10 ** tokenDecimals;
        if (!Number.isFinite(sol) || !Number.isFinite(tokens) || tokens <= 0) return 0;
        return sol / tokens;
    },

    /**
     * Prodotto costante sulle riserve virtuali, verificato contro TradeEvent reali:
     * la formula riproduce i token effettivamente ricevuti a meno di 1 unita atomica.
     * Le fee sono addebitate in aggiunta al SOL che entra in curva, quindi da un budget
     * B la parte che muove il prezzo e B / (1 + fee).
     */
    getEntryTokenOut(state: CurveState, tokenMint: string, solLamports: BN): BN | null {
        if (unusable(state) || solLamports.lten(0)) return null;
        const fee = totalFeeBps();
        const solIn = solLamports.mul(BPS).div(BPS.add(fee));
        if (solIn.lten(0)) return null;

        const k = state.virtualSolReserves.mul(state.virtualTokenReserves);
        const out = state.virtualTokenReserves.sub(ceilDiv(k, state.virtualSolReserves.add(solIn)));
        if (out.lten(0)) return null;
        // non si possono ricevere piu token di quelli realmente in curva
        return BN.min(out, state.realTokenReserves);
    },

    getExitQuoteSol(state: CurveState, tokenMint: string, tokenOutAtomic: BN): number | null {
        if (unusable(state) || !tokenOutAtomic || tokenOutAtomic.lten(0)) return null;

        const k = state.virtualSolReserves.mul(state.virtualTokenReserves);
        const gross = state.virtualSolReserves.sub(ceilDiv(k, state.virtualTokenReserves.add(tokenOutAtomic)));
        if (gross.lten(0)) return null;

        // in uscita le fee sono trattenute sul SOL incassato
        const fee = totalFeeBps();
        const net = gross.mul(BPS.sub(fee)).div(BPS);
        // non si puo incassare piu del SOL realmente in curva
        const capped = BN.min(net, state.realSolReserves);
        const sol = Number(capped.toString()) / 1e9;
        return Number.isFinite(sol) && sol > 0 ? sol : null;
    },
};
