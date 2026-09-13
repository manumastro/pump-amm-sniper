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
 * La SOL nella pool quando il worker la legge, cioe' a circa un secondo dalla creazione.
 *
 * **Non e' il seed di graduazione.** Quello e' un parametro fisso di pump — 67,4 SOL su
 * 22 pool lette su 22 — e non distingue un vincitore da un morto. Questo numero e' invece
 * quanta SOL e' *arrivata* nel primo secondo di vita: domanda vera, non un parametro del
 * template. Misurato su 28 pool graduate in quattro ore diverse (controls.md 48):
 *
 * ```
 *   >= 300 SOL nel primo secondo   8 vivi su 17   (47%)
 *   <  150 SOL (nessun acquisto)   1 vivo  su  9  (11%)
 * ```
 *
 * Il gradino piu' alto (>= 1.500 SOL: 4 vivi su 5) **non e' affidabile**: i quattro vivi
 * nascono in quattro minuti e almeno due condividono il payer, quindi valgono come un
 * campione solo; e l'unico caso indipendente in quella fascia, 3.027 SOL, e' morto a $456.
 * Piu' SOL non e' automaticamente meglio.
 *
 * Per questo la soglia parte a 0: si **registra** e basta. Il numero non costa chiamate,
 * e' la liquidita' che il worker legge comunque all'ingresso.
 */
export function valutaSol1s(sol1s: number): { ok: boolean; soglia: number; motivo: string } {
    const soglia = Math.max(0, CONFIG.PUMP_MIGRATO_MIN_SOL_1S);
    if (soglia <= 0) return { ok: true, soglia, motivo: "solo misura" };
    if (sol1s >= soglia) return { ok: true, soglia, motivo: "sopra soglia" };
    return { ok: false, soglia, motivo: `${sol1s.toFixed(2)} SOL nel primo secondo < ${soglia} SOL` };
}

/**
 * Questo token va comprato, o e' della popolazione che abbiamo gia' misurato a zero?
 *
 * Con `SOLO_POOL_GRADUATE` il bot valuta tutto ma compra solo le pool graduate. Non e'
 * un filtro di qualita': e' il riconoscimento che la curva non graduata e' un'altra
 * partita, gia' misurata due volte con lo stesso esito (0 vincitori su 194 nello studio,
 * 24 vincenti su 122 per -0,208 SOL in sessione) e che costa il 60% del tempo dell'unico
 * worker. Vedi docs/controls.md 50.
 */
export function daComprare(passaggioGraduata: boolean): boolean {
    return !CONFIG.SOLO_POOL_GRADUATE || passaggioGraduata;
}
