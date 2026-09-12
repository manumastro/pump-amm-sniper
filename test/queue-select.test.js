const test = require("node:test");
const assert = require("node:assert");
const { selectNextSignature } = require("../dist/app/queueSelect");

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const NOW = 1_000_000;

const entry = (signature, programId, ageMs = 0) => ({
    signature,
    programId,
    enqueuedAtMs: NOW - ageMs,
});

const opts = (over = {}) => ({
    priorityProgramIds: new Set(),
    isLifo: true,
    maxAgeMs: 45_000,
    nowMs: NOW,
    isActive: () => false,
    ...over,
});

test("in LIFO serve la firma piu fresca, non la piu vecchia", () => {
    const pending = [entry("vecchia", PUMP, 30_000), entry("fresca", PUMP, 1_000)];
    const r = selectNextSignature(pending, opts());
    assert.strictEqual(r.entry.signature, "fresca");
    assert.strictEqual(pending.length, 1);
});

test("in FIFO serve la piu vecchia, per riprodurre il comportamento storico", () => {
    const pending = [entry("vecchia", PUMP, 30_000), entry("fresca", PUMP, 1_000)];
    const r = selectNextSignature(pending, opts({ isLifo: false }));
    assert.strictEqual(r.entry.signature, "vecchia");
});

test("le firme oltre il TTL sono scartate e riportate al chiamante", () => {
    const pending = [entry("scaduta", PUMP, 60_000), entry("valida", PUMP, 1_000)];
    const r = selectNextSignature(pending, opts({ isLifo: false }));
    assert.strictEqual(r.entry.signature, "valida");
    assert.deepStrictEqual(r.expired.map((e) => e.signature), ["scaduta"]);
});

test("un DEX prioritario passa avanti anche se e in fondo alla coda", () => {
    const pending = [
        entry("pumpswap-vecchia", SWAP, 20_000),
        entry("pump-fresca", PUMP, 100),
    ];
    const r = selectNextSignature(pending, opts({ priorityProgramIds: new Set([SWAP]) }));
    assert.strictEqual(r.entry.signature, "pumpswap-vecchia");
    assert.strictEqual(r.servedByPriority, true);
});

test("fra piu firme prioritarie vince comunque la piu fresca", () => {
    const pending = [
        entry("swap-vecchia", SWAP, 30_000),
        entry("pump", PUMP, 5_000),
        entry("swap-fresca", SWAP, 500),
    ];
    const r = selectNextSignature(pending, opts({ priorityProgramIds: new Set([SWAP]) }));
    assert.strictEqual(r.entry.signature, "swap-fresca");
});

test("la precedenza non resuscita una firma prioritaria scaduta", () => {
    const pending = [entry("swap-scaduta", SWAP, 90_000), entry("pump-valida", PUMP, 100)];
    const r = selectNextSignature(pending, opts({ priorityProgramIds: new Set([SWAP]) }));
    assert.strictEqual(r.entry.signature, "pump-valida");
    assert.strictEqual(r.servedByPriority, false);
    assert.deepStrictEqual(r.expired.map((e) => e.signature), ["swap-scaduta"]);
});

test("senza firme prioritarie in coda si ricade sul LIFO normale", () => {
    const pending = [entry("a", PUMP, 9_000), entry("b", PUMP, 100)];
    const r = selectNextSignature(pending, opts({ priorityProgramIds: new Set([SWAP]) }));
    assert.strictEqual(r.entry.signature, "b");
    assert.strictEqual(r.servedByPriority, false);
});

test("una firma gia in lavorazione viene saltata, non restituita due volte", () => {
    const pending = [entry("gia-attiva", PUMP, 1_000), entry("libera", PUMP, 500)];
    const r = selectNextSignature(pending, opts({ isActive: (s) => s === "libera" }));
    assert.strictEqual(r.entry.signature, "gia-attiva");
});

test("coda vuota restituisce null senza lanciare", () => {
    const r = selectNextSignature([], opts());
    assert.strictEqual(r.entry, null);
    assert.deepStrictEqual(r.expired, []);
});

test("con TTL a zero nulla scade", () => {
    const pending = [entry("antica", PUMP, 10_000_000)];
    const r = selectNextSignature(pending, opts({ maxAgeMs: 0 }));
    assert.strictEqual(r.entry.signature, "antica");
    assert.deepStrictEqual(r.expired, []);
});
