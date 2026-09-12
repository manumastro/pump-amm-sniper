import { instructionAccountToBase58, instructionProgramIdToBase58 } from "../../utils/pubkeys";
import { DexAdapter } from "./types";

/**
 * Le righe di log di questa transazione annunciano la creazione di un pool su questo DEX?
 *
 * Vive qui e non nel supervisore perche la usano sia il runtime sia
 * scripts/dex-adapter-live-check.js: quando la logica era duplicata, aggiungere un marker
 * RegExp ha fatto esplodere lo script e non il bot.
 */
export function matchesCreateMarkers(adapter: DexAdapter, logLines: string[]): boolean {
    return logLines.some((line) => {
        const lower = line.toLowerCase();
        return adapter.createPoolLogMarkers.some((marker) =>
            typeof marker === "string" ? lower.includes(marker) : marker.test(line));
    });
}

/**
 * Tutte le istruzioni di una transazione parsata, esterne e interne.
 *
 * Serve perche la creazione di un pool arriva spesso come inner instruction: su
 * pumpswap, per esempio, la migrazione dalla bonding curve invoca create_pool tramite
 * CPI, quindi guardando solo le istruzioni esterne non si trova niente.
 */
export function allInstructions(tx: any): any[] {
    const outer = tx?.transaction?.message?.instructions || [];
    const inner = (tx?.meta?.innerInstructions || []).flatMap((group: any) => group?.instructions || []);
    return [...outer, ...inner];
}

/** istruzioni della tx destinate a un program specifico, esterne e interne */
export function instructionsForProgram(tx: any, programId: string): any[] {
    const accountKeys = tx?.transaction?.message?.accountKeys || [];
    return allInstructions(tx).filter((ix) => instructionProgramIdToBase58(ix, accountKeys) === programId);
}

/** account distinti toccati dalle istruzioni di quel program, nell'ordine in cui compaiono */
export function accountsTouchedByProgram(tx: any, programId: string): string[] {
    const accountKeys = tx?.transaction?.message?.accountKeys || [];
    const out: string[] = [];
    for (const ix of instructionsForProgram(tx, programId)) {
        for (const ref of Array.isArray(ix.accounts) ? ix.accounts : []) {
            const addr = instructionAccountToBase58(ref, accountKeys);
            if (addr && !out.includes(addr)) out.push(addr);
        }
    }
    return out;
}

/**
 * getMultipleAccountsInfo a blocchi.
 *
 * Alcuni endpoint gratuiti rifiutano le richieste con molti account in una volta
 * (publicnode risponde 403 "Request blocked"), e la tx di creazione di un pool ne
 * tocca facilmente venti. Il limite non e documentato, quindi si va di blocchi piccoli.
 */
export async function getAccountsChunked(
    connection: import("@solana/web3.js").Connection,
    addresses: string[],
    chunkSize = 10,
    maxAttempts = 3,
    retryBaseMs = 250,
): Promise<Array<any | null>> {
    const { PublicKey } = await import("@solana/web3.js");
    const out: Array<any | null> = [];
    for (let i = 0; i < addresses.length; i += chunkSize) {
        const chunk = addresses.slice(i, i + chunkSize).map((a) => new PublicKey(a));
        let lastError: any = null;
        let got: Array<any | null> | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                got = await connection.getMultipleAccountsInfo(chunk);
                break;
            } catch (e: any) {
                lastError = e;
                if (attempt < maxAttempts) {
                    await new Promise((r) => setTimeout(r, retryBaseMs * attempt));
                }
            }
        }

        // Prima questo catch faceva `push(null)` per ogni account del chunk, cioe traduceva
        // "la chiamata e fallita" in "l'account non esiste". Un 429 diventava indistinguibile
        // da una curva inesistente, e il bot riportava "Could not extract pool/token from TX"
        // — un problema di parsing — per quello che era un rate limit. Il 2026-09-12 questo ha
        // nascosto 15 creazioni pump perfettamente valide. Vedi controls.md 27.
        if (!got) {
            throw new Error(
                `getMultipleAccountsInfo fallita dopo ${maxAttempts} tentativi su ${chunk.length} account: ` +
                `${lastError?.message || String(lastError)}`,
            );
        }
        out.push(...got);
    }
    return out;
}

/**
 * Il mint creato DA questa transazione, non uno qualunque fra quelli che tocca.
 *
 * La distinzione conta: una tx di creazione puo contenere anche acquisti in bundle su
 * token gia esistenti, che compaiono nei token balance esattamente come il nuovo. Senza
 * questo controllo si finisce per analizzare una curva vecchia — anche gia diplomata — al
 * posto di quella appena nata.
 *
 * Il segnale e l'istruzione `initializeMint` del token program: identifica il mint creato
 * qui e non e un'euristica.
 */
export function mintCreatedInTx(tx: any): string | null {
    for (const ix of allInstructions(tx)) {
        const parsed = (ix as any)?.parsed;
        const type = parsed?.type;
        if (type !== "initializeMint" && type !== "initializeMint2") continue;
        const mint = parsed?.info?.mint;
        if (typeof mint === "string" && mint) return mint;
    }
    return null;
}
