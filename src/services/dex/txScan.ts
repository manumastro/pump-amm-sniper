import { instructionAccountToBase58, instructionProgramIdToBase58 } from "../../utils/pubkeys";

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
): Promise<Array<any | null>> {
    const { PublicKey } = await import("@solana/web3.js");
    const out: Array<any | null> = [];
    for (let i = 0; i < addresses.length; i += chunkSize) {
        const chunk = addresses.slice(i, i + chunkSize).map((a) => new PublicKey(a));
        try {
            out.push(...(await connection.getMultipleAccountsInfo(chunk)));
        } catch {
            out.push(...chunk.map(() => null));
        }
    }
    return out;
}
