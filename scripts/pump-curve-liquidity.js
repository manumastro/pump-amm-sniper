/**
 * Distribuzione del SOL realmente in curva alla creazione, sui token pump.
 *
 * Serve a scegliere MIN_POOL_LIQUIDITY_SOL su dati veri. Il feed gmgn riporta
 * `initial_liquidity` 0 per le bonding curve, ma quel campo semplicemente non e popolato:
 * on-chain `realSolReserves` e SOL vero ed estraibile. Questo script misura quanto.
 *
 * Throttling: le letture passano da un semaforo condiviso (lo stesso meccanismo del bot).
 * Senza, il ritmo di creazione di pump — circa 44 al minuto — manda in 429 qualunque
 * endpoint nel giro di un minuto.
 *
 * Uso:  node scripts/pump-curve-liquidity.js [secondi]
 */
const { Connection, PublicKey, Keypair } = require("@solana/web3.js");
const BN = require("bn.js");
require("dotenv").config();
const { listAdapters, initAdapters, matchesCreateMarkers } = require("../dist/services/dex");
const { createSemaphore } = require("../dist/utils/concurrency");

const RPC = process.env.SVS_UNSTAKED_RPC || "https://api.mainnet-beta.solana.com";
const WS = process.env.SVS_UNSTAKED_WS || RPC.replace(/^http/, "ws");
const DURATION_S = Number(process.argv[2] || 240);
const SETTLE_MS = 1200;                 // lascia che il dev buy iniziale sia confermato
const PROBE = new BN(10_000_000);       // 0,01 SOL, la size simulata del paper trade

const sem = createSemaphore(3);
async function gated(fn) {
    const release = await sem.acquire();
    try { return await fn(); } finally { release(); }
}

function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
    return sorted[i];
}

(async () => {
    const connection = new Connection(RPC, { commitment: "confirmed", wsEndpoint: WS });
    initAdapters(connection);
    const pump = listAdapters().find((a) => a.name === "pump");
    if (!pump) { console.error("adapter pump non registrato"); process.exit(1); }

    const user = Keypair.generate().publicKey;
    const seen = new Set();
    const samples = [];
    let creations = 0, failed = 0, rateLimited = 0, nonSol = 0, completed = 0;

    connection.onLogs(new PublicKey(pump.programId), (logs) => {
        if (logs.err || seen.has(logs.signature)) return;
        if (!matchesCreateMarkers(pump, logs.logs)) return;
        seen.add(logs.signature);
        creations++;

        // l'attesa sta fuori dal semaforo: tenere un permesso mentre si dorme
        // ridurrebbe la concorrenza utile senza ridurre le richieste
        (async () => {
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        return gated(async () => {
            const tx = await connection.getParsedTransaction(logs.signature, {
                maxSupportedTransactionVersion: 0, commitment: "confirmed",
            });
            if (!tx) return;
            const resolved = await pump.resolvePoolFromCreateTx(tx);
            if (!resolved) return;
            const state = await pump.fetchPoolState(new PublicKey(resolved.poolAddress), user);
            // le curve quotate in un token diverso da SOL non sono prezzabili dal bot:
            // contarle separatamente invece di lasciarle sparire fra gli scarti
            if (state.quoteMint) { nonSol++; return; }
            if (state.complete) { completed++; return; }
            const liq = pump.getSolLiquidity(state, resolved.tokenMint);
            if (liq === null) return;

            // quanto costerebbe davvero entrare e uscire subito
            const tokenOut = pump.getEntryTokenOut(state, resolved.tokenMint, PROBE);
            const back = tokenOut ? pump.getExitQuoteSol(state, resolved.tokenMint, tokenOut) : null;
            const spent = Number(PROBE.toString()) / 1e9;
            samples.push({ liq, roundTripPct: back === null ? null : ((back - spent) / spent) * 100 });
        });
        })().catch((e) => {
            if (/429|rate/i.test(String(e.message))) rateLimited++; else failed++;
        });
    }, "confirmed");

    await new Promise((r) => setTimeout(r, DURATION_S * 1000));

    const liqs = samples.map((s) => s.liq).sort((a, b) => a - b);
    console.log(`creazioni viste: ${creations}   campionate: ${samples.length}   errori: ${failed}   429: ${rateLimited}`);
    console.log(`scartate: ${nonSol} quotate in un token != SOL, ${completed} gia migrate\n`);

    console.log("SOL realmente in curva alla creazione:");
    for (const q of [0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
        console.log(`  p${String(q * 100).padStart(2)}  ${quantile(liqs, q).toFixed(4)} SOL`);
    }
    console.log(`  max  ${(liqs[liqs.length - 1] || 0).toFixed(4)} SOL`);

    console.log("\nQuante passerebbero una soglia, e cosa costa entrarci:");
    console.log("  soglia SOL    passano    quota    round trip mediano");
    for (const th of [0, 0.01, 0.1, 0.25, 0.5, 1, 2, 5]) {
        const pass = samples.filter((s) => s.liq >= th);
        const rts = pass.map((s) => s.roundTripPct).filter((v) => v !== null).sort((a, b) => a - b);
        const med = rts.length ? quantile(rts, 0.5).toFixed(2) + "%" : "-";
        console.log(`  ${String(th).padStart(10)} ${String(pass.length).padStart(10)} ${((pass.length / (samples.length || 1)) * 100).toFixed(1).padStart(7)}% ${med.padStart(21)}`);
    }
    process.exit(0);
})();
