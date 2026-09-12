/**
 * Primo test del repo. Non e un inizio di suite per principio: il semaforo e il tipo di
 * codice che si rompe in silenzio — se il tetto smette di funzionare non si vede un
 * errore, si vedono dei 429 sotto carico, cioe ore dopo e altrove.
 *
 * Uso:  node --test test/
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { createSemaphore, mapWithSemaphore } = require("../dist/utils/concurrency");

async function runTracked(items, semaphore, delayMs = 5) {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithSemaphore(items, semaphore, async (item) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, delayMs));
        inFlight--;
        return item * 2;
    });
    return { results, peak };
}

test("non supera mai il tetto di permessi", async () => {
    const items = Array.from({ length: 80 }, (_, i) => i);
    const { peak } = await runTracked(items, createSemaphore(6));
    assert.strictEqual(peak, 6);
});

test("i risultati restano nell'ordine di ingresso, non di completamento", async () => {
    const sem = createSemaphore(4);
    const items = Array.from({ length: 20 }, (_, i) => i);
    // durate decrescenti: senza cura dell'ordine i primi finirebbero per ultimi
    const results = await mapWithSemaphore(items, sem, async (item) => {
        await new Promise((r) => setTimeout(r, (20 - item) * 2));
        return item * 2;
    });
    assert.deepStrictEqual(results, items.map((i) => i * 2));
});

test("piu chiamate concorrenti condividono lo stesso tetto", async () => {
    const sem = createSemaphore(6);
    const items = Array.from({ length: 40 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    await Promise.all([0, 1, 2, 3].map(() =>
        mapWithSemaphore(items, sem, async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 3));
            inFlight--;
        })));
    assert.strictEqual(peak, 6);
});

test("un permesso rilasciato due volte non gonfia il tetto", async () => {
    const sem = createSemaphore(2);
    const release = await sem.acquire();
    release();
    release();
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { peak } = await runTracked(items, sem);
    assert.strictEqual(peak, 2);
});

test("un task che lancia non trattiene il permesso", async () => {
    const sem = createSemaphore(1);
    await assert.rejects(mapWithSemaphore([1], sem, async () => { throw new Error("boom"); }));
    const { peak, results } = await runTracked([1, 2, 3], sem);
    assert.strictEqual(peak, 1);
    assert.deepStrictEqual(results, [2, 4, 6]);
});
