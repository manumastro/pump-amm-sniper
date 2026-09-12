import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";

export const WSOL = "So11111111111111111111111111111111111111112";

export type PoolOrientation = {
    /** true se il lato SOL/WSOL del pool e il base */
    solIsBase: boolean;
    tokenIsBase: boolean;
    /** false = pool senza lato WSOL: il bot non sa prezzarlo e lo scarta */
    hasWsol: boolean;
};

/**
 * Tutto cio che il bot ha bisogno di sapere su un pool, indipendentemente dal DEX.
 *
 * Il resto del codice (controlli pre-entry, hold monitor, report) ragiona solo in
 * termini di "quanto SOL ci sono dentro", "quanti token ottengo con N lamport" e
 * "quanti SOL ricavo vendendo la posizione". Nient'altro deve conoscere la forma
 * dello stato interno del DEX.
 */
export interface DexAdapter {
    /** chiave nei log e nei report */
    readonly name: string;
    /** program id da ascoltare con onLogs */
    readonly programId: string;
    /** sottostringhe che identificano la creazione di un pool nei log del program */
    readonly createPoolLogMarkers: string[];

    fetchPoolState(connection: Connection, poolAddress: PublicKey, user: PublicKey): Promise<any>;

    getOrientation(state: any, tokenMint: string): PoolOrientation;
    describePoolMints(state: any, tokenMint: string): string;

    /** SOL nel pool. null se il pool non ha lato WSOL. */
    getSolLiquidity(state: any, tokenMint: string): number | null;
    getSpotSolPerToken(state: any, tokenMint: string, tokenDecimals: number): number | null;

    /** token ricevuti spendendo solLamports. null se non quotabile. */
    getEntryTokenOut(state: any, tokenMint: string, solLamports: BN): BN | null;
    /** SOL ricavati vendendo tokenOutAtomic. null se non quotabile. */
    getExitQuoteSol(state: any, tokenMint: string, tokenOutAtomic: BN): number | null;
}
