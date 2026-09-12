import { Connection } from "@solana/web3.js";
import { DexAdapter } from "./types";
import { pumpSwapAdapter, PUMPSWAP_PROGRAM_ID } from "./pumpswap";
import { raydiumV4Adapter, RAYDIUM_V4_PROGRAM_ID } from "./raydiumV4";
import { meteoraDammV2Adapter, METEORA_DAMM_V2_PROGRAM_ID } from "./meteoraDammV2";
import { pumpBondingCurveAdapter, PUMP_PROGRAM_ID } from "./pumpBondingCurve";

export { DexAdapter, PoolOrientation, ResolvedPool, WSOL } from "./types";
export { matchesCreateMarkers, allInstructions, instructionsForProgram, accountsTouchedByProgram, getAccountsChunked, mintCreatedInTx } from "./txScan";
export { pumpSwapAdapter, PUMPSWAP_PROGRAM_ID, initPumpSwapSdk } from "./pumpswap";
export { raydiumV4Adapter, RAYDIUM_V4_PROGRAM_ID } from "./raydiumV4";
export { meteoraDammV2Adapter, METEORA_DAMM_V2_PROGRAM_ID } from "./meteoraDammV2";
export { pumpBondingCurveAdapter, PUMP_PROGRAM_ID, deriveBondingCurve } from "./pumpBondingCurve";

/**
 * Registro dei DEX che il bot sa leggere.
 *
 * Per aggiungerne uno servono due cose: un adapter che implementi DexAdapter e una
 * riga qui. La subscription in src/app/runtime.ts si estende da sola a tutti i
 * program registrati.
 *
 * Registrati: `pumpswap` e `pump`. Scelta del 2026-09-12: concentrarsi sui due lati dello
 * stesso ecosistema — la bonding curve e l'AMM in cui i token si diplomano.
 *
 * `meteoraDammV2Adapter` e implementato e verificato (12 pool risolte su 13 in un campione
 * live, round trip coerente con le fee) ma **non registrato**, per tenere la prima sessione
 * multi-DEX su una popolazione sola. Riattivarlo e una riga.
 *
 * `raydiumV4Adapter` e implementato ma **non registrato**: in 25 minuti di ascolto
 * continuo non ha prodotto una sola creazione di pool, mentre meteora_damm_v2 ne faceva
 * 4 in 45 secondi. Raydium AMM v4 e ormai legacy — il traffico che si vede sul suo
 * program sono swap su pool vecchie, non lanci nuovi. Tenerlo registrato costerebbe una
 * subscription permanente per zero eventi. Il codice resta perche la matematica e
 * verificata contro pool esistenti: se servisse riattivarlo basta rimetterlo qui.
 *
 * Gli altri launchpad del feed gmgn (pump bonding curve, meteora_virtual_curve,
 * ray_launchpad) non sono AMM: non hanno pool ne liquidita alla creazione, e i controlli
 * di questo bot non si applicano. Vedi docs/expansion-sources-2026-09-12.md.
 */
const ADAPTERS: DexAdapter[] = [
    pumpSwapAdapter,
    pumpBondingCurveAdapter,
];

const BY_PROGRAM = new Map<string, DexAdapter>(ADAPTERS.map((a) => [a.programId, a]));

/** lega tutti gli adapter registrati alla connection condivisa */
export function initAdapters(connection: Connection) {
    for (const a of ADAPTERS) a.init(connection);
}

export function getAdapterForProgram(programId: string): DexAdapter | undefined {
    return BY_PROGRAM.get(programId);
}

export function getAdapterByName(name: string): DexAdapter | undefined {
    return ADAPTERS.find((a) => a.name === name);
}

export function listAdapters(): DexAdapter[] {
    return [...ADAPTERS];
}

export function listMonitoredProgramIds(): string[] {
    return ADAPTERS.map((a) => a.programId);
}

/**
 * Adapter di default: usato dal supervisore, che non e legato a nessun DEX, e come
 * ripiego quando un processo non ha un program assegnato.
 */
export const defaultAdapter: DexAdapter = pumpSwapAdapter;

let active: DexAdapter | null = null;

/**
 * L'adapter del DEX su cui gira QUESTO processo.
 *
 * Il supervisore etichetta ogni worker con WORKER_TASK_PROGRAM_ID; un worker analizza
 * una pool sola, quindi un solo DEX, e la scelta vale per tutta la sua vita.
 *
 * E l'unico punto in cui questa risoluzione avviene: usare `defaultAdapter` al posto
 * di questa funzione in un percorso che gira nei worker significa quotare un pool
 * Raydium o Meteora con la matematica di PumpSwap, e in paper trade un errore del
 * genere non da errore — da un PnL sbagliato.
 */
export function getActiveAdapter(): DexAdapter {
    if (!active) {
        active = getAdapterForProgram(process.env.WORKER_TASK_PROGRAM_ID || "") || defaultAdapter;
    }
    return active;
}
