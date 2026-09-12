/**
 * Token bucket: limita le richieste al secondo, non il parallelismo.
 *
 * Sono due cose diverse e il bot aveva solo la seconda. `RPC_MAX_CONCURRENT_TX_FETCH`
 * limita quante `getParsedTransaction` viaggiano insieme, ma i deep check creator-risk
 * emettono ~60 richieste in 2,4 secondi — 25 al secondo da un worker solo — e nessun tetto
 * di concorrenza lo impedisce: bastano richieste brevi e sequenziali. Il 2026-09-12 due terzi
 * di quelle richieste tornavano 429. Vedi controls.md 31.
 *
 * Il bucket si ricarica in modo continuo, non a scatti a inizio secondo: una raffica non puo
 * "aspettare il prossimo secondo" e ripartire tutta insieme.
 */
export type RateLimiter = {
    acquire(): Promise<void>;
    readonly ratePerSec: number;
};

export function createRateLimiter(ratePerSec: number, burst?: number): RateLimiter {
    const rate = Math.max(0, ratePerSec);
    // rate <= 0 significa "nessun limite": utile per i test e per gli endpoint a pagamento
    if (rate === 0) {
        return { acquire: async () => {}, ratePerSec: 0 };
    }

    const capacity = Math.max(1, burst ?? Math.ceil(rate));
    let tokens = capacity;
    let lastRefillMs = Date.now();

    function refill() {
        const nowMs = Date.now();
        const elapsedSec = (nowMs - lastRefillMs) / 1000;
        if (elapsedSec <= 0) return;
        tokens = Math.min(capacity, tokens + elapsedSec * rate);
        lastRefillMs = nowMs;
    }

    return {
        ratePerSec: rate,
        async acquire() {
            // il ciclo serve perche fra la sveglia e il prelievo un altro chiamante puo aver
            // consumato il token: senza, due attese concorrenti supererebbero il tetto
            for (;;) {
                refill();
                if (tokens >= 1) {
                    tokens -= 1;
                    return;
                }
                const waitMs = Math.max(5, Math.ceil(((1 - tokens) / rate) * 1000));
                await new Promise((r) => setTimeout(r, waitMs));
            }
        },
    };
}
