/**
 * Quante creazioni al minuto produce ogni DEX registrato.
 *
 * Solo WebSocket: nessuna chiamata HTTP, quindi si puo lasciare girare a lungo senza
 * consumare rate limit. Serve a dimensionare i worker, non l'endpoint: con
 * MAX_CONCURRENT_OPERATIONS slot il carico RPC e limitato dai worker, mentre il tasso di
 * creazione decide quanti eventi finiscono in coda e quanti vengono scartati.
 *
 * Uso:  node scripts/creation-rate.js [secondi]
 */
const { Connection, PublicKey } = require("@solana/web3.js");
require("dotenv").config();
const { listAdapters, initAdapters, matchesCreateMarkers } = require("../dist/services/dex");

const RPC = process.env.SVS_UNSTAKED_RPC || "https://api.mainnet-beta.solana.com";
const WS = process.env.SVS_UNSTAKED_WS || RPC.replace(/^http/, "ws");
const DURATION_S = Number(process.argv[2] || 300);

(async () => {
    const connection = new Connection(RPC, { commitment: "confirmed", wsEndpoint: WS });
    initAdapters(connection);

    const seen = new Set();
    const counts = new Map();
    const adapters = listAdapters();
    for (const a of adapters) counts.set(a.name, { creations: 0, logs: 0 });

    for (const adapter of adapters) {
        connection.onLogs(new PublicKey(adapter.programId), (logs) => {
            if (logs.err) return;
            const c = counts.get(adapter.name);
            c.logs++;
            if (!matchesCreateMarkers(adapter, logs.logs)) return;
            if (seen.has(logs.signature)) return;
            seen.add(logs.signature);
            c.creations++;
        }, "confirmed");
    }

    const t0 = Date.now();
    console.log(`misura ${DURATION_S}s su: ${adapters.map((a) => a.name).join(", ")}\n`);
    await new Promise((r) => setTimeout(r, DURATION_S * 1000));

    const minutes = (Date.now() - t0) / 60000;
    let total = 0;
    const rows = [];
    for (const [name, c] of counts) {
        const perHour = c.creations / minutes * 60;
        total += perHour;
        rows.push({ name, creations: c.creations, perHour });
    }
    console.log("DEX                creazioni   al minuto   all'ora   quota");
    for (const r of rows.sort((a, b) => b.perHour - a.perHour)) {
        console.log(`${r.name.padEnd(18)} ${String(r.creations).padStart(8)} ${(r.perHour/60).toFixed(1).padStart(11)} ${r.perHour.toFixed(0).padStart(9)} ${((r.perHour/total)*100).toFixed(1).padStart(7)}%`);
    }
    console.log(`${"TOTALE".padEnd(18)} ${String([...counts.values()].reduce((a,b)=>a+b.creations,0)).padStart(8)} ${(total/60).toFixed(1).padStart(11)} ${total.toFixed(0).padStart(9)}`);
    process.exit(0);
})();
