/**
 * Verifica gli adapter DEX contro la rete reale.
 *
 * Si mette in ascolto sui program registrati, e per ogni pool creata prova l'intero
 * percorso che il bot userebbe: risoluzione pool/token dalla tx, lettura dello stato,
 * liquidita, quote di entry e quote di uscita immediata (round trip).
 *
 * Lo scarto del round trip deve corrispondere a circa il doppio della fee di swap:
 * un valore diverso significa che la matematica dell'adapter e sbagliata.
 *
 * Uso:  node scripts/dex-adapter-live-check.js [secondi] [nome-adapter]
 *
 * Il secondo argomento limita l'ascolto a un solo adapter: serve per i DEX a bassa
 * frequenza di creazione (ray_v4 ne produce meno di uno al minuto), dove una finestra
 * corta su tutti i program non basta a vederne uno.
 */
const { Connection, PublicKey, Keypair } = require("@solana/web3.js");
const BN = require("bn.js");
require("dotenv").config();

const { listAdapters, initAdapters, matchesCreateMarkers } = require("../dist/services/dex");

const RPC = process.env.SVS_UNSTAKED_RPC || "https://api.mainnet-beta.solana.com";
const WS = process.env.SVS_UNSTAKED_WS || RPC.replace(/^http/, "ws");
const DURATION_S = Number(process.argv[2] || 180);
const ONLY = process.argv[3] || null;
const PROBE_LAMPORTS = new BN(10_000_000); // 0,01 SOL, la size simulata del paper trade

(async () => {
    const connection = new Connection(RPC, { commitment: "confirmed", wsEndpoint: WS });
    initAdapters(connection);
    const user = Keypair.generate().publicKey;

    const adapters = ONLY ? listAdapters().filter((a) => a.name === ONLY) : listAdapters();
    if (adapters.length === 0) {
        console.error(`adapter "${ONLY}" non registrato. Disponibili: ${listAdapters().map((a) => a.name).join(", ")}`);
        process.exit(1);
    }

    const seen = new Set();
    const stats = new Map();
    for (const a of adapters) stats.set(a.name, { events: 0, resolved: 0, quoted: 0 });

    console.log(`RPC ${RPC}`);
    console.log(`WS  ${WS}`);
    console.log(`in ascolto ${DURATION_S}s su: ${adapters.map((a) => a.name).join(", ")}\n`);

    for (const adapter of adapters) {
        connection.onLogs(new PublicKey(adapter.programId), async (logs) => {
            if (logs.err || seen.has(logs.signature)) return;
            if (!matchesCreateMarkers(adapter, logs.logs)) return;
            seen.add(logs.signature);

            const st = stats.get(adapter.name);
            st.events++;
            console.log(`\n[${adapter.name}] create ${logs.signature}`);

            try {
                const tx = await connection.getParsedTransaction(logs.signature, {
                    maxSupportedTransactionVersion: 0, commitment: "confirmed",
                });
                if (!tx) return console.log("  tx non disponibile");

                const resolved = await adapter.resolvePoolFromCreateTx(tx);
                if (!resolved) return console.log("  ❌ pool non risolta");
                st.resolved++;
                console.log(`  pool    ${resolved.poolAddress}`);
                console.log(`  token   ${resolved.tokenMint}`);
                console.log(`  creator ${resolved.creatorAddress || "-"}`);

                const state = await adapter.fetchPoolState(new PublicKey(resolved.poolAddress), user);
                const o = adapter.getOrientation(state, resolved.tokenMint);
                const liq = adapter.getSolLiquidity(state, resolved.tokenMint);
                console.log(`  ${adapter.describePoolMints(state, resolved.tokenMint)}`);
                console.log(`  orientamento hasWsol=${o.hasWsol} solIsBase=${o.solIsBase} tokenIsBase=${o.tokenIsBase}`);
                console.log(`  liquidita ${liq === null ? "n/d" : liq.toFixed(4)} SOL`);

                const tokenOut = adapter.getEntryTokenOut(state, resolved.tokenMint, PROBE_LAMPORTS);
                if (!tokenOut) return console.log("  ❌ entry non quotabile");

                const back = adapter.getExitQuoteSol(state, resolved.tokenMint, tokenOut);
                if (back === null) return console.log("  ❌ exit non quotabile");
                st.quoted++;
                const spent = Number(PROBE_LAMPORTS.toString()) / 1e9;
                console.log(`  round trip 0,01 SOL -> ${tokenOut.toString()} token -> ${back.toFixed(6)} SOL`
                    + `  (slippage ${(((back - spent) / spent) * 100).toFixed(2)}%)`);
            } catch (e) {
                console.log(`  ❌ ${e.message}`);
            }
        }, "confirmed");
    }

    await new Promise((r) => setTimeout(r, DURATION_S * 1000));
    console.log("\n=== riepilogo ===");
    for (const [name, s] of stats) {
        console.log(`${name.padEnd(18)} create=${s.events}  risolte=${s.resolved}  quotate=${s.quoted}`);
    }
    process.exit(0);
})();
