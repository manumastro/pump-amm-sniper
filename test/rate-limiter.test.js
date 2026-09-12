const test = require("node:test");
const assert = require("node:assert");
const { createRateLimiter } = require("../dist/utils/rateLimiter");

test("rate 0 significa nessun limite: non attende mai", async () => {
    const rl = createRateLimiter(0);
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) await rl.acquire();
    assert.ok(Date.now() - t0 < 50, "non deve introdurre attesa");
});

test("il burst iniziale passa subito, il resto viene diluito", async () => {
    const rl = createRateLimiter(10, 5);
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await rl.acquire();
    const burstMs = Date.now() - t0;
    assert.ok(burstMs < 40, `il burst deve passare subito, invece ${burstMs}ms`);

    await rl.acquire();
    const totalMs = Date.now() - t0;
    assert.ok(totalMs >= 80, `la sesta deve attendere ~100ms, invece ${totalMs}ms`);
});

test("il ritmo medio non supera il tetto configurato", async () => {
    const rl = createRateLimiter(20, 1);
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) await rl.acquire();
    const elapsedSec = (Date.now() - t0) / 1000;
    const observed = 10 / Math.max(elapsedSec, 0.001);
    assert.ok(observed <= 20 * 1.35, `ritmo osservato ${observed.toFixed(1)}/s oltre il tetto di 20/s`);
});

test("piu chiamanti concorrenti condividono lo stesso tetto", async () => {
    const rl = createRateLimiter(20, 1);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 12 }, () => rl.acquire()));
    const elapsedSec = (Date.now() - t0) / 1000;
    const observed = 12 / Math.max(elapsedSec, 0.001);
    assert.ok(observed <= 20 * 1.35, `ritmo osservato ${observed.toFixed(1)}/s oltre il tetto`);
});

test("il bucket si ricarica nel tempo, non a scatti", async () => {
    const rl = createRateLimiter(50, 2);
    await rl.acquire();
    await rl.acquire();
    await new Promise((r) => setTimeout(r, 60));
    const t0 = Date.now();
    await rl.acquire();
    assert.ok(Date.now() - t0 < 20, "dopo l'attesa il token deve essere gia disponibile");
});
