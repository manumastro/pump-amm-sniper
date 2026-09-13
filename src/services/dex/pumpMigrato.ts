import { PublicKey } from "@solana/web3.js";
import { canonicalPumpPoolPda } from "@pump-fun/pump-swap-sdk";
import { CONFIG } from "../../app/config";
import { promuoviAdapterAttivo } from "./index";
import { DexAdapter } from "./types";

/**
 * La curva pump che ha gia' graduato.
 *
 * Fino al 2026-09-13 il worker le scartava con `SKIP: no WSOL side`: la curva e' completa,
 * quindi non scambiabile, e li' finiva il ciclo. Lo studio su 255 token nati sotto i nostri
 * occhi (docs/studio-curva-2026-09-13.md) ha mostrato che quel secchio conteneva **tutti** i
 * vincitori: 13 graduazioni istantanee, 13 vive, mc fino a $13,5M, contro zero vincitori
 * sui 194 token restanti — compresi i 28 che abbiamo davvero comprato, il cui massimo e'
 * stato $15.131.
 *
 * Il token non e' perduto: e' semplicemente passato su un altro DEX un secondo dopo la
 * nascita. Questo modulo fa il passaggio.
 *
 * Attenzione a non confondere i due `no WSOL side`: la curva **completa** e' questa, la
 * curva **quotata in un mint diverso da SOL** e' un'altra cosa (48 casi su 61, morti tutti
 * e 48) e va scartata come prima. Chi chiama deve distinguerli con `curvaGiaGraduata`.
 */

/** true solo per la curva completata: non per quella quotata in un token diverso da SOL. */
export function curvaGiaGraduata(state: any): boolean {
    return !!state?.complete && !state?.quoteMint;
}

/**
 * La pool PumpSwap di un mint pump, derivata invece che cercata.
 *
 * E' un PDA canonico: nessuna chiamata RPC, nessuna attesa di indicizzazione. Verificato
 * il 2026-09-13 contro le 13 pool reali dello studio, 13 su 13 esatte.
 */
export function poolPumpSwapDaMint(tokenMint: string): string {
    return canonicalPumpPoolPda(new PublicKey(tokenMint)).toBase58();
}

export type Passaggio = {
    poolAddress: string;
    adapter: DexAdapter;
};

/**
 * Sposta questo worker sulla pool PumpSwap del token. Ritorna null se il passaggio e'
 * disattivato o se l'adapter pumpswap non e' disponibile: in quel caso chi chiama deve
 * comportarsi come prima e scartare il token.
 */
export function passaAllaPoolGraduata(tokenMint: string): Passaggio | null {
    if (!CONFIG.PUMP_MIGRATO_ENABLED) return null;
    const adapter = promuoviAdapterAttivo("pumpswap");
    if (!adapter) return null;
    return { poolAddress: poolPumpSwapDaMint(tokenMint), adapter };
}

/**
 * La SOL presente nella pool appena graduata: l'unica variabile osservabile all'ingresso
 * che, sul campione del 2026-09-13, separa i vincitori.
 *
 * ```
 *   >= 1.500 SOL    4 su 4 oltre $6M di mc
 *   <    700 SOL    7 morti su 9
 * ```
 *
 * n=4 pero', e due dei quattro condividono il payer: potrebbe essere un operatore solo,
 * cioe' n=1. E' esattamente la forma dell'errore gia' commesso con il "seed 85 SOL"
 * (docs/mercato-2026-09-13.md). Per questo la soglia parte a 0: si **registra** e basta,
 * finche' non c'e' un campione nato in ore diverse. Alzare
 * `PUMP_MIGRATO_MIN_SEED_SOL` la trasforma in filtro.
 *
 * Il numero non costa nulla: e' la liquidita' che il worker legge comunque all'ingresso,
 * e a un secondo dalla creazione quella liquidita' **e'** il seed.
 */
export function valutaSeedGraduata(seedSol: number): { ok: boolean; soglia: number; motivo: string } {
    const soglia = Math.max(0, CONFIG.PUMP_MIGRATO_MIN_SEED_SOL);
    if (soglia <= 0) return { ok: true, soglia, motivo: "solo misura" };
    if (seedSol >= soglia) return { ok: true, soglia, motivo: "sopra soglia" };
    return { ok: false, soglia, motivo: `seed ${seedSol.toFixed(2)} SOL < ${soglia} SOL` };
}
