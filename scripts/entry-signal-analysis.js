#!/usr/bin/env node
/**
 * Due domande, una tabella ciascuna.
 *
 * 1) Il momentum batte il livello come segnale d'ingresso?
 *    Legge `liqPath` dal report: la traiettoria della liquidita nei primi secondi di vita
 *    della curva, registrata a costo zero dai campioni che il recheck fa gia'.
 *
 * 2) Quanto ci costano gli skip?
 *    Legge lo shadow tracking: per ogni token scartato, il picco che ha raggiunto dopo.
 *    Senza questo ogni soglia resta una convinzione, perche' vediamo l'esito solo di
 *    cio' che passa.
 *
 * uso: node scripts/entry-signal-analysis.js [report.json]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const reportPath = process.argv[2] || path.join(ROOT, "logs", "paper-report.json");
const shadowRoot = path.join(ROOT, "logs", "cc-shadow");

const n = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
const pad = (s, w) => String(s).padEnd(w);
const lpad = (s, w) => String(s).padStart(w);

function leggiReport() {
    try { return JSON.parse(fs.readFileSync(reportPath, "utf8")); }
    catch { return null; }
}

// ---------------------------------------------------------------- 1. momentum

function esitoDi(op) {
    const s = op.endStatus || "";
    if (/PAPER (WIN|LOSS)|COMPLETED/.test(s)) return "ENTRATO";
    const m = /SKIP: ([a-z0-9 ]+)/i.exec(s);
    return m ? m[1].trim() : "altro";
}

function bucket(valore, soglie) {
    for (const s of soglie) if (valore < s) return `< ${s}`;
    return `>= ${soglie[soglie.length - 1]}`;
}

function analisiMomentum(report) {
    const ops = (report.operations || []).filter((o) => o.liqPath && Array.isArray(o.liqPath.q));
    console.log(`\n=== 1. SEGNALE D'INGRESSO — ${ops.length} curve con traiettoria registrata ===\n`);
    if (!ops.length) {
        console.log("  Nessuna traiettoria. Il recheck di liquidita non ha ancora prodotto campioni");
        console.log("  (serve LOW_LIQUIDITY_RECHECK_ENABLED=true e almeno una valutazione conclusa).");
        return;
    }

    const perBucket = new Map();
    for (const o of ops) {
        const lp = o.liqPath;
        const slope = Number(lp.slopeSolPerSec);
        const b = bucket(slope, [0.001, 0.01, 0.05, 0.2]);
        const riga = perBucket.get(b) || { n: 0, entrati: 0, pnl: 0, pnlN: 0, livelli: [] };
        riga.n += 1;
        riga.livelli.push(Number(lp.finalSol));
        if (esitoDi(o) === "ENTRATO") {
            riga.entrati += 1;
            if (Number.isFinite(o.pnlPct)) { riga.pnl += o.pnlPct; riga.pnlN += 1; }
        }
        perBucket.set(b, riga);
    }

    console.log("  Per pendenza della curva nei primi secondi (SOL al secondo):\n");
    console.log(`  ${pad("pendenza", 14)}${lpad("n", 5)}${lpad("entrati", 9)}${lpad("%", 7)}${lpad("liq mediana", 13)}${lpad("PnL medio", 11)}`);
    const ordine = ["< 0.001", "< 0.01", "< 0.05", "< 0.2", ">= 0.2"];
    for (const b of ordine) {
        const r = perBucket.get(b);
        if (!r) continue;
        const med = r.livelli.sort((a, c) => a - c)[Math.floor(r.livelli.length / 2)];
        console.log(
            `  ${pad(b, 14)}${lpad(r.n, 5)}${lpad(r.entrati, 9)}${lpad(n((r.entrati / r.n) * 100, 1) + "%", 7)}` +
            `${lpad(n(med, 4), 13)}${lpad(r.pnlN ? n(r.pnl / r.pnlN, 1) + "%" : "-", 11)}`
        );
    }

    // La domanda vera: fra i token allo stesso livello di liquidita, la pendenza separa?
    const sottoSoglia = ops.filter((o) => Number(o.liqPath.finalSol) < 0.5);
    if (sottoSoglia.length >= 10) {
        const veloci = sottoSoglia.filter((o) => Number(o.liqPath.slopeSolPerSec) >= 0.01);
        const lenti = sottoSoglia.filter((o) => Number(o.liqPath.slopeSolPerSec) < 0.01);
        console.log(`\n  A parita' di livello (< 0.5 SOL), la pendenza separa?`);
        console.log(`    veloci (>= 0.01 SOL/s): ${veloci.length} curve`);
        console.log(`    lenti  (<  0.01 SOL/s): ${lenti.length} curve`);
        console.log(`    -> incrociare con lo shadow qui sotto per l'esito dei due gruppi.`);
    }
}

// ------------------------------------------------------------ 2. controfattuale

function leggiShadow() {
    const out = [];
    if (!fs.existsSync(shadowRoot)) return out;
    for (const dir of fs.readdirSync(shadowRoot)) {
        if (!/^cc-\d+$/.test(dir)) continue;
        const p = path.join(shadowRoot, dir, "summary", "by-token.json");
        if (!fs.existsSync(p)) continue;
        try {
            const byToken = JSON.parse(fs.readFileSync(p, "utf8"));
            for (const v of Object.values(byToken)) out.push(v);
        } catch { /* file in scrittura, si riprova al prossimo giro */ }
    }
    return out;
}

function analisiControfattuale() {
    const tok = leggiShadow();
    console.log(`\n=== 2. COSTO DEGLI SKIP — ${tok.length} token scartati e seguiti ===\n`);
    if (!tok.length) {
        console.log("  Nessun token seguito. Serve CC_SHADOW_ENABLED=true (e CC_SHADOW_LOW_LIQ_ENABLED");
        console.log("  per gli skip di liquidita), piu' il tempo perche' i primi job completino.");
        return;
    }

    const gruppi = new Map();
    for (const t of tok) {
        const g = /low liquidity/i.test(t.skipReason || "") ? "low liquidity" : "creator risk";
        (gruppi.get(g) || gruppi.set(g, []).get(g)).push(t);
    }

    console.log(`  ${pad("motivo dello skip", 20)}${lpad("n", 5)}${lpad("picco>=10%", 12)}${lpad(">=25%", 8)}${lpad(">=50%", 8)}${lpad(">=100%", 8)}${lpad("rug", 6)}${lpad("picco mediano", 15)}`);
    for (const [g, lista] of gruppi) {
        const picchi = lista.map((t) => t.peakPnlPct).filter(Number.isFinite).sort((a, b) => a - b);
        const conta = (s) => picchi.filter((p) => p >= s).length;
        const rug = lista.filter((t) => t.removeLiquidityDetected || (Number.isFinite(t.maxAdversePnlPct) && t.maxAdversePnlPct <= -90)).length;
        const med = picchi.length ? picchi[Math.floor(picchi.length / 2)] : NaN;
        console.log(
            `  ${pad(g, 20)}${lpad(lista.length, 5)}${lpad(conta(10), 12)}${lpad(conta(25), 8)}${lpad(conta(50), 8)}` +
            `${lpad(conta(100), 8)}${lpad(rug, 6)}${lpad(n(med, 1) + "%", 15)}`
        );
    }

    console.log(`\n  Lettura: ogni token in "picco >= X%" e' un ingresso che avremmo potuto prendere.`);
    console.log(`  Se la colonna rug e' alta quanto i picchi, il filtro sta facendo il suo lavoro.`);
    console.log(`  Se i picchi dominano, la soglia e' troppo severa e stiamo lasciando soldi sul tavolo.`);

    const completi = tok.filter((t) => t.completed).length;
    console.log(`\n  ${completi}/${tok.length} job completi (gli altri sono ancora in corso, i numeri saliranno).`);
}

// ---------------------------------------------------------------------- main

const report = leggiReport();
if (!report) {
    console.error(`Report non leggibile: ${reportPath}`);
    process.exit(1);
}
console.log(`report: ${path.relative(ROOT, reportPath)}  (generato ${report.generatedAt})`);
console.log(`eventi=${report.eventsSeen} conclusi=${report.finishedEvents} entrati=${report.checksPassed} PnL=${report.totalPnlSol} SOL`);
analisiMomentum(report);
analisiControfattuale();
console.log();
