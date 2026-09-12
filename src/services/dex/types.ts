import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";

export const WSOL = "So11111111111111111111111111111111111111112";

/** esito dell'estrazione dalla transazione di creazione */
export type ResolvedPool = {
    poolAddress: string;
    tokenMint: string;
    creatorAddress: string | null;
};

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
    /**
     * Come si riconosce la creazione nei log del program.
     *
     * Le stringhe sono cercate come sottostringa nella riga in minuscolo. Le RegExp sono
     * applicate alla riga originale e servono quando il nome dell'istruzione e un prefisso
     * di altre: su pump l'istruzione e `CreateV2`, ma cercare "create" colpirebbe anche
     * `CreateTokenAccount` e `CreatePool`, che compaiono nelle stesse transazioni.
     */
    readonly createPoolLogMarkers: Array<string | RegExp>;

    /** lega l'adapter alla connection condivisa; va chiamata una volta all'avvio */
    init(connection: Connection): void;
    fetchPoolState(poolAddress: PublicKey, user: PublicKey): Promise<any>;

    /**
     * Estrae pool, token e creator dalla transazione che ha creato il pool.
     *
     * Ogni DEX ordina diversamente gli account della sua istruzione di init, quindi
     * questo passaggio non puo stare nell'orchestratore. Gli adapter che non hanno un
     * ordine stabile documentato risolvono per tentativi: prendono gli account
     * dell'istruzione e provano a decodificarli come pool, il che e piu robusto degli
     * offset a memoria e costa solo sul path di creazione, non nel loop di hold.
     */
    resolvePoolFromCreateTx(tx: any): Promise<ResolvedPool | null>;

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
