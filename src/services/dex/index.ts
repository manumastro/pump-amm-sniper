import { DexAdapter } from "./types";
import { pumpSwapAdapter, PUMPSWAP_PROGRAM_ID } from "./pumpswap";

export { DexAdapter, PoolOrientation, WSOL } from "./types";
export { pumpSwapAdapter, PUMPSWAP_PROGRAM_ID, initPumpSwapSdk } from "./pumpswap";

/**
 * Registro dei DEX che il bot sa leggere.
 *
 * Per aggiungerne uno servono due cose: un adapter che implementi DexAdapter e una
 * riga qui. La subscription in src/app/runtime.ts si estende da sola a tutti i
 * program registrati.
 *
 * Candidati misurati sul feed gmgn (vedi docs/expansion-sources-2026-09-12.md):
 * ray_v4 e meteora_damm_v2 sono le uniche altre fonti che producono pool sopra la
 * soglia di liquidita. Gli altri launchpad no: sarebbero eventi scartati al primo
 * controllo.
 */
const ADAPTERS: DexAdapter[] = [
    pumpSwapAdapter,
];

const BY_PROGRAM = new Map<string, DexAdapter>(ADAPTERS.map((a) => [a.programId, a]));

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
 * Adapter di default. Finche il registro ha una sola voce, tutto il codice che
 * non e ancora stato reso multi-DEX passa di qui senza cambiare comportamento.
 */
export const defaultAdapter: DexAdapter = pumpSwapAdapter;
