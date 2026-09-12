/**
 * Tetto alle richieste RPC simultanee.
 *
 * Il bot faceva `Promise.all` su liste di firme lunghe fino a 40, da otto punti diversi,
 * e i deep check creator-risk girano a loro volta in parallelo fra loro: il picco di
 * richieste non era limitato da niente. Con due worker attivi bastava a mandare in 429
 * qualunque endpoint, ed e cosi che il 2026-03-29 e stata bruciata una chiave Helius.
 *
 * Un piano RPC piu costoso non risolve un picco illimitato: alza solo il muro. Il tetto
 * va messo qui.
 */

/** Semaforo: N permessi, chi non ne trova si mette in coda. */
export function createSemaphore(permits: number) {
    let available = Math.max(1, Math.floor(permits));
    const waiting: Array<() => void> = [];

    return {
        async acquire(): Promise<() => void> {
            if (available > 0) {
                available--;
            } else {
                await new Promise<void>((resolve) => waiting.push(resolve));
            }
            let released = false;
            return () => {
                if (released) return;      // rilasciare due volte gonfierebbe i permessi
                released = true;
                const next = waiting.shift();
                if (next) next();
                else available++;
            };
        },
        get pending() {
            return waiting.length;
        },
    };
}

/**
 * Esegue i task rispettando un semaforo condiviso da tutto il processo, non solo dalla
 * singola chiamata: e la differenza che conta quando piu deep check partono insieme.
 *
 * L'ordine dei risultati e quello dei task in ingresso, non quello di completamento.
 */
export async function mapWithSemaphore<T, R>(
    items: T[],
    semaphore: { acquire: () => Promise<() => void> },
    task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    return Promise.all(items.map(async (item, index) => {
        const release = await semaphore.acquire();
        try {
            return await task(item, index);
        } finally {
            release();
        }
    }));
}
