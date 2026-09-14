/**
 * La curva stonk.fun su Raydium LaunchLab.
 *
 * E un prodotto costante con riserve virtuali: il pool parte con `virtual_base` token e
 * `virtual_quote` di quote che non esistono davvero, e i due si muovono in senso opposto
 * man mano che la raccolta (`real_quote`) avanza verso il bersaglio. Da qui due conseguenze
 * che valgono per tutto il resto del codice:
 *
 *  1. il prezzo NON e il rapporto fra i saldi dei vault. Chi lo legge cosi sbaglia di un
 *     fattore che dipende da quanto la curva e avanzata. Vedi docs/stonk-fun.md.
 *  2. la forma della curva e identica su ogni token: `bersaglio / virtual_quote` vale 2,8333
 *     su 71 pool su 71, quindi la salita dal fondo alla migrazione e sempre 14,69x. Cambia
 *     solo la scala, cioe in che valuta e denominata.
 *
 * I decimali del quote cambiano da token a token (visti 6, 8, 9 e 12): vanno letti dal
 * pool_state, non dati per scontati, o il prezzo esce sbagliato di ordini di grandezza.
 */

export const LAUNCHLAB_PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
export const POOL_STATE_BYTES = 429;

/** i due modi di lanciare di stonk.fun; il `platform_config` sta nel pool_state a 173 */
export const PIATTAFORME: Record<string, "reward" | "standard"> = {
    "6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt": "reward",
    "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7": "standard",
};

/** bersaglio / virtual_quote, costante misurata su 71 pool */
export const RAPPORTO_BERSAGLIO = 2.83333;

/** quanto sale la curva dal primo token alla migrazione */
export const SALITA_TOTALE = (1 + RAPPORTO_BERSAGLIO) ** 2;

export type StatoCurva = 0 | 1 | 2;

export type CurvaStonk = {
    stato: StatoCurva;
    piattaforma: "reward" | "standard";
    baseDecimali: number;
    quoteDecimali: number;
    /** in unita intere, gia scalate per i decimali */
    virtualBase: number;
    virtualQuote: number;
    realBase: number;
    realQuote: number;
    bersaglio: number;
    totaleDaVendere: number;
    baseMint: string;
    quoteMint: string;
};

/**
 * Decodifica un account pool_state. Gli offset sono verificati confrontando i Pubkey noti
 * su una pool reale, non presi da una IDL: vedi la tabella in docs/stonk-fun.md.
 * Ritorna null se non e un pool_state o se non e di stonk.fun.
 */
export function leggiPoolState(buf: Buffer, base58: (b: Buffer) => string): CurvaStonk | null {
    if (buf.length !== POOL_STATE_BYTES) return null;
    const piattaforma = PIATTAFORME[base58(buf.subarray(173, 205))];
    if (!piattaforma) return null;

    const baseDecimali = buf[18];
    const quoteDecimali = buf[19];
    const sb = 10 ** baseDecimali;
    const sq = 10 ** quoteDecimali;

    return {
        stato: buf[17] as StatoCurva,
        piattaforma,
        baseDecimali,
        quoteDecimali,
        totaleDaVendere: Number(buf.readBigUInt64LE(29)) / sb,
        virtualBase: Number(buf.readBigUInt64LE(37)) / sb,
        virtualQuote: Number(buf.readBigUInt64LE(45)) / sq,
        realBase: Number(buf.readBigUInt64LE(53)) / sb,
        realQuote: Number(buf.readBigUInt64LE(61)) / sq,
        bersaglio: Number(buf.readBigUInt64LE(69)) / sq,
        baseMint: base58(buf.subarray(205, 237)),
        quoteMint: base58(buf.subarray(237, 269)),
    };
}

/** la pool ha gia migrato: non si scambia piu qui */
export function migrata(c: CurvaStonk): boolean {
    return c.stato === 2;
}

/** quanto e avanzata la raccolta, da 0 a 1. E l unica coordinata che conta sulla curva. */
export function raccolta(c: CurvaStonk): number {
    return c.bersaglio > 0 ? c.realQuote / c.bersaglio : 0;
}

/** le riserve che l AMM usa davvero: le virtuali corrette da quanto e gia passato */
function riserve(c: CurvaStonk): { base: number; quote: number; k: number } {
    const base = c.virtualBase - c.realBase;
    const quote = c.virtualQuote + c.realQuote;
    return { base, quote, k: c.virtualBase * c.virtualQuote };
}

/** prezzo spot in unita di quote per token */
export function prezzo(c: CurvaStonk): number {
    const r = riserve(c);
    return r.base > 0 ? r.quote / r.base : Infinity;
}

/**
 * Prezzo a una data raccolta, in multipli del prezzo di partenza.
 * Serve a ragionare senza conoscere il quote: vale per qualunque token stonk.
 */
export function prezzoAllaRaccolta(f: number): number {
    return (1 + RAPPORTO_BERSAGLIO * f) ** 2;
}

/** quanto rende passare dalla raccolta f0 alla raccolta f1, al lordo dei costi */
export function moltiplicatore(f0: number, f1: number): number {
    return prezzoAllaRaccolta(f1) / prezzoAllaRaccolta(f0);
}

/** token ottenuti spendendo `quoteIn` unita di quote, prima di commissioni */
export function tokenPerQuote(c: CurvaStonk, quoteIn: number): number {
    if (quoteIn <= 0) return 0;
    const r = riserve(c);
    return r.base - r.k / (r.quote + quoteIn);
}

/** quote ricavati vendendo `tokenIn` token, prima di commissioni */
export function quotePerToken(c: CurvaStonk, tokenIn: number): number {
    if (tokenIn <= 0) return 0;
    const r = riserve(c);
    return r.quote - r.k / (r.base + tokenIn);
}

/** di quanto sposta il prezzo un acquisto di `quoteIn` */
export function impatto(c: CurvaStonk, quoteIn: number): number {
    const r = riserve(c);
    return ((r.quote + quoteIn) / r.quote) ** 2 - 1;
}
