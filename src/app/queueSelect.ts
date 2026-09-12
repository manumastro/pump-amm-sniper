/**
 * Scelta della prossima firma da valutare.
 *
 * Tre regole che interagiscono, ed e il motivo per cui vive qui invece che inline nel
 * supervisore: e l'unico punto in cui una firma esce dalla coda, e un errore qui non
 * produce un log sbagliato ma semplicemente un DEX che sparisce.
 *
 *  1. TTL     — a coda satura una firma vecchia non e piu valutabile (controls.md 25)
 *  2. LIFO    — serve la piu fresca, non la piu stantia (controls.md 25)
 *  3. quota   — un DEX prioritario passa avanti, ovunque si trovi (controls.md 30)
 *
 * La funzione MUTA `pending` rimuovendo la voce scelta e tutte quelle scadute che incontra,
 * e restituisce anche quante ne ha scartate, perche il chiamante tiene i contatori.
 */
export type PendingSignature = { signature: string; programId: string; enqueuedAtMs: number };

export type SelectResult = {
    entry: PendingSignature | null;
    expired: PendingSignature[];
    servedByPriority: boolean;
};

export function selectNextSignature(
    pending: PendingSignature[],
    opts: {
        priorityProgramIds: ReadonlySet<string>;
        isLifo: boolean;
        maxAgeMs: number;
        nowMs: number;
        isActive: (signature: string) => boolean;
    },
): SelectResult {
    const expired: PendingSignature[] = [];
    const isExpired = (e: PendingSignature) => opts.maxAgeMs > 0 && opts.nowMs - e.enqueuedAtMs > opts.maxAgeMs;

    // 1. passata di precedenza: la voce piu fresca di un DEX prioritario, ovunque sia in coda
    if (opts.priorityProgramIds.size > 0) {
        for (let i = pending.length - 1; i >= 0; i--) {
            const entry = pending[i];
            if (!opts.priorityProgramIds.has(entry.programId)) continue;

            pending.splice(i, 1);
            if (isExpired(entry)) {
                expired.push(entry);
                continue;
            }
            if (opts.isActive(entry.signature)) continue;
            return { entry, expired, servedByPriority: true };
        }
    }

    // 2. passata normale, nell'ordine configurato
    while (pending.length > 0) {
        const entry = opts.isLifo ? pending.pop()! : pending.shift()!;
        if (isExpired(entry)) {
            expired.push(entry);
            continue;
        }
        if (opts.isActive(entry.signature)) continue;
        return { entry, expired, servedByPriority: false };
    }

    return { entry: null, expired, servedByPriority: false };
}
