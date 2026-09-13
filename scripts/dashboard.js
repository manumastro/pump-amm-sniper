#!/usr/bin/env node
/**
 * Cruscotto: una schermata sola che si ridisegna, invece del log a cascata.
 *
 * Legge le stesse fonti sparse che il bot usa gia' — report, log dei worker, summary
 * dello shadow, riga SERIALE del supervisore — e le mette in un posto solo.
 * Nessuna dipendenza esterna: ANSI a mano.
 *
 * Due colonne: a sinistra cosa sta succedendo adesso (il token in valutazione, tappa
 * per tappa), a destra la storia della sessione (esiti, ritmo, token seguiti in ombra).
 * Sotto i 132 caratteri di terminale le due colonne si impilano da sole.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORT = path.join(ROOT, "logs", "paper-report.json");
const SHADOW = path.join(ROOT, "logs", "cc-shadow");
const REFRESH_MS = Number(process.env.CRUSCOTTO_REFRESH_MS || 2000);

const C = {
    r: "\x1b[0m", b: "\x1b[1m", dim: "\x1b[2m",
    rosso: "\x1b[31m", verde: "\x1b[32m", giallo: "\x1b[33m",
    blu: "\x1b[34m", ciano: "\x1b[36m", grigio: "\x1b[90m",
};

const TOT = () => Math.max(72, process.stdout.columns || 100);
const AFFIANCATE = () => TOT() >= 132;

// La larghezza va calcolata sui caratteri visibili, non sui byte del colore.
const nudo = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
const vis = (s) => {
    // emoji e simboli larghi occupano due colonne nel terminale
    let n = 0;
    for (const ch of nudo(s)) n += /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ch) ? 2 : 1;
    return n;
};
const riempi = (s, w) => s + " ".repeat(Math.max(0, w - vis(s)));
const tronca = (s, w) => {
    if (vis(s) <= w) return s;
    let out = "", n = 0;
    for (const ch of nudo(s)) {
        const c = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ch) ? 2 : 1;
        if (n + c > w - 1) break;
        out += ch; n += c;
    }
    return out + "…";
};

const pct = (x, d = 2) =>
    typeof x === "number" && Number.isFinite(x)
        ? (x >= 0 ? C.verde : C.rosso) + (x >= 0 ? "+" : "") + x.toFixed(d) + "%" + C.r
        : C.grigio + "n/a" + C.r;

/** Restituisce le righe del riquadro, non una stringa: servono per affiancare le colonne. */
function riquadro(titolo, righe, w) {
    const interno = w - 2;
    const out = [];
    out.push(C.grigio + "┌─ " + C.r + C.b + titolo + C.r + " " + C.grigio + "─".repeat(Math.max(0, interno - vis(titolo) - 3)) + "┐" + C.r);
    for (const r of righe) out.push(C.grigio + "│" + C.r + riempi(tronca(r, interno), interno) + C.grigio + "│" + C.r);
    out.push(C.grigio + "└" + "─".repeat(interno) + "┘" + C.r);
    return out;
}

/** Incolla due colonne di righe gia' formattate, pareggiando quella piu' corta. */
function affianca(sx, dx, wsx) {
    const n = Math.max(sx.length, dx.length);
    const out = [];
    for (let i = 0; i < n; i++) out.push(riempi(sx[i] || "", wsx) + "  " + (dx[i] || ""));
    return out;
}

function barra(n, tot, w) {
    if (!tot) return C.grigio + "░".repeat(w) + C.r;
    const p = Math.round((n / tot) * w);
    return C.ciano + "█".repeat(p) + C.r + C.grigio + "░".repeat(w - p) + C.r;
}

const leggiJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

function seriale() {
    return new Promise((res) => {
        execFile("docker", ["compose", "logs", "--tail=120", "sniper"], { cwd: ROOT, maxBuffer: 8e6 }, (e, out) => {
            if (e) return res(null);
            const righe = String(out).split("\n").filter((r) => r.includes("SERIALE"));
            const ultima = righe[righe.length - 1];
            if (!ultima) return res(null);
            const g = (k) => { const m = new RegExp(k + "=([\\d.]+)").exec(ultima); return m ? Number(m[1]) : null; };
            res({ valutate: g("valutate"), ignorate: g("ignorate_occupato"), quota: g("quota_vista"), fallite: g("create_fallite"), worker: /worker=(\d)/.exec(ultima)?.[1] });
        });
    });
}

function logWorker() {
    const dir = path.join(ROOT, "logs");
    const f = fs.readdirSync(dir).filter((x) => /^paper-worker-\d+\.log$/.test(x))
        .map((x) => path.join(dir, x))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    return f || null;
}

/**
 * L'evento in corso, ricostruito dal log del worker.
 *
 * Le righe interessanti sono poche fra molto rumore: durante l'hold il worker ripete
 * CRISK/RREPEAT/CRISKT ogni paio di secondi, e lasciarle passare seppellisce tutto.
 */
function inCorso(tappeMax) {
    try {
        const f = logWorker();
        if (!f) return null;
        const righe = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
        // inizio dell'ultimo evento
        let i = righe.length - 1;
        for (; i >= 0; i--) if (/START\s+\| processing pool/.test(righe[i])) break;
        if (i < 0) return null;
        const blocco = righe.slice(i);
        const campo = (tag) => {
            for (let k = blocco.length - 1; k >= 0; k--) {
                const m = new RegExp(`\\[W\\d\\]\\s+${tag}\\s+\\|\\s+(.*)$`).exec(blocco[k]);
                if (m) return m[1].trim();
            }
            return null;
        };
        const tappe = [];
        const RUMORE = /(CRISK|RREPEAT|CRISKT|FILTERS|HOLDLOG|LIQPATH|GMGN|SIGNATURE|─)/;
        for (const r of blocco) {
            const m = /\[([\d:.]+)\]\s+\[W\d\]\s+(.*)$/.exec(r);
            if (!m || RUMORE.test(m[2])) continue;
            tappe.push({ t: m[1].slice(0, 8), testo: m[2].replace(/\s+\|\s+/, " · ").trim() });
        }
        let slope = null;
        for (let k = blocco.length - 1; k >= 0; k--) {
            const m = /LIQPATH\s+\|\s+(\{.*\})$/.exec(blocco[k]);
            if (m) { try { slope = JSON.parse(m[1]).slopeSolPerSec; } catch {} break; }
        }
        return {
            token: campo("TOKEN"), pool: campo("POOL"), gmgn: campo("GMGN"),
            creator: campo("CREATOR"), dex: campo("TX"), liq: campo("LIQ"),
            hold: campo("HOLD"), fine: campo("END"), slope,
            tappe: tappe.slice(-tappeMax),
        };
    } catch { return null; }
}

function attivita() {
    // ultima riga significativa dal log del worker: dice cosa sta succedendo adesso
    try {
        const f = logWorker();
        if (!f) return null;
        const righe = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
        const eta = (Date.now() - fs.statSync(f).mtimeMs) / 1000;
        return { riga: righe[righe.length - 1] || "", eta };
    } catch { return null; }
}

function shadow() {
    const out = [];
    if (!fs.existsSync(SHADOW)) return out;
    for (const d of fs.readdirSync(SHADOW)) {
        const f = path.join(SHADOW, d, "summary", "by-token.json");
        if (!fs.existsSync(f)) continue;
        const byToken = leggiJson(f);
        if (!byToken) continue;
        for (const v of Object.values(byToken)) out.push(v);
    }
    return out.sort((a, b) => (b.snapshots || 0) - (a.snapshots || 0));
}

function esiti(report) {
    const m = new Map();
    let rpc = 0, n = 0;
    const ts = [];
    const recenti = [];
    const sec = (s) => { const [h, mi, r] = String(s).split(":"); return +h * 3600 + +mi * 60 + parseFloat(r); };
    for (const o of report.operations || []) {
        const st = o.endStatus || "";
        const mm = /\((\d+)ms, rpc=(\d+) 429=(\d+)\)$/.exec(st);
        const k = st.replace(/\s*\(\d+ms, rpc=.*$/, "").replace(/\(.*/, "").trim() || "in corso";
        m.set(k, (m.get(k) || 0) + 1);
        if (mm) { rpc += +mm[2]; n += 1; if (o.startedAt) { ts.push(sec(o.startedAt)); recenti.push(+mm[2]); } }
    }
    // La finestra va presa sulle ULTIME valutazioni, non su tutta la sessione: se il Mac
    // ha dormito in mezzo, lo span include ore di inattivita e il ritmo risulta falso
    // (misurato: 358 minuti di finestra per 19 valutazioni/ora, con il bot che ne faceva 460).
    const RECENTI = 40;
    const coda = ts.slice(-RECENTI);
    const span = coda.length > 1 ? (Math.max(...coda) - Math.min(...coda)) / 60 : 0;
    const rpcRecenti = recenti.slice(-RECENTI).reduce((a, b) => a + b, 0);
    return { m, rpc, n, span, nRecenti: coda.length, rpcRecenti };
}

// ─────────────────────────── colonna di sinistra: adesso ───────────────────────────

function colonnaOra(s, att, ic, w) {
    const out = [];

    const righeOra = [];
    if (s) {
        const occupato = s.worker === "1";
        righeOra.push(`  ${occupato ? C.giallo + "● in valutazione" : C.verde + "○ libero"}${C.r}   ${C.grigio}worker ${s.worker}/1${C.r}`);
        righeOra.push(`  ${C.grigio}valutate${C.r} ${C.b}${s.valutate}${C.r}   ${C.grigio}ignorate${C.r} ${s.ignorate}   ${C.grigio}quota vista${C.r} ${C.b}${s.quota}%${C.r}`);
    } else {
        righeOra.push(`  ${C.grigio}supervisore non raggiungibile (il container gira?)${C.r}`);
    }
    if (att) {
        const r = att.riga.replace(/^\[[\d:.]+\]\s*\[W\d\]\s*/, "");
        righeOra.push(`  ${C.grigio}${att.eta.toFixed(0)}s fa:${C.r} ${r}`);
    }
    out.push(...riquadro("STATO DEL BOT", righeOra, w));

    if (ic && ic.token) {
        const righeIc = [];
        const concluso = !!ic.fine;
        righeIc.push(
            `  ${C.b}${ic.token}${C.r}` +
            (concluso ? `   ${C.grigio}concluso${C.r}` : `   ${C.giallo}in corso${C.r}`)
        );
        if (ic.dex) righeIc.push(`  ${C.grigio}${ic.dex}${C.r}`);
        if (ic.gmgn) righeIc.push(`  ${C.blu}${ic.gmgn}${C.r}`);
        if (ic.creator) righeIc.push(`  ${C.grigio}creator${C.r} ${ic.creator}`);
        if (ic.slope !== null && ic.slope !== undefined) {
            const v = Number(ic.slope);
            righeIc.push(`  ${C.grigio}pendenza${C.r} ${(v >= 0 ? C.verde : C.rosso)}${v >= 0 ? "+" : ""}${v.toFixed(6)} SOL/s${C.r} ${C.grigio}(momentum)${C.r}`);
        }
        righeIc.push("");
        for (const t of ic.tappe) {
            const esito = /SKIP|🛑/.test(t.testo) ? C.rosso : /CHECKS|BUY|PAPER WIN|✅/.test(t.testo) ? C.verde : "";
            righeIc.push(`  ${C.grigio}${t.t}${C.r}  ${esito}${t.testo}${C.r}`);
        }
        if (ic.hold && !concluso) {
            righeIc.push("");
            righeIc.push(`  ${C.b}${C.giallo}POSIZIONE APERTA${C.r}`);
            righeIc.push(`  ${ic.hold}`);
        }
        out.push(...riquadro(concluso ? "ULTIMO TOKEN VALUTATO" : "TOKEN IN VALUTAZIONE ADESSO", righeIc, w));
    } else {
        out.push(...riquadro("TOKEN IN VALUTAZIONE", [`  ${C.grigio}nessun evento nel log del worker${C.r}`], w));
    }
    return out;
}

// ─────────────────────────── colonna di destra: passato ────────────────────────────

function colonnaStoria(report, sh, w) {
    const out = [];
    const interno = w - 2;

    if (report) {
        const e = esiti(report);
        const righe = [];
        const tot = [...e.m.values()].reduce((a, b) => a + b, 0);
        // larghezza della barra ricavata da quello che avanza: etichetta 26 + conteggio 6 + percentuale 7
        const wBar = Math.max(6, Math.min(22, interno - 43));
        for (const [k, v] of [...e.m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7)) {
            const entrata = /PAPER|COMPLETED/.test(k);
            righe.push(`  ${riempi((entrata ? C.verde : "") + tronca(k, 26) + C.r, 27)}${String(v).padStart(4)}  ${barra(v, tot, wBar)} ${((v / tot) * 100).toFixed(1).padStart(4)}%`);
        }
        righe.push("");
        righe.push(
            `  ${C.b}PnL ${C.r}${pct(Number(report.avgPnlPct), 2)}   ${report.totalPnlSol} SOL   ` +
            `${C.verde}${report.wins}W${C.r}/${C.rosso}${report.losses}L${C.r}   ${C.grigio}rug${C.r} ${report.rugLossCount}`
        );
        righe.push(`  ${C.grigio}entrati${C.r} ${C.b}${report.checksPassed}${C.r}/${report.finishedEvents}`);
        out.push(...riquadro("ESITI DELLA SESSIONE", righe, w));

        // Le operazioni davvero eseguite. Sono poche (~1 su 25 valutazioni) e restavano
        // schiacciate in una riga di conteggio: qui ognuna ha il suo esito, il motivo
        // dell'uscita e quanto e' durata.
        const fatte = (report.operations || []).filter((o) => o.checksPassed && o.pnlPct !== null && o.pnlPct !== undefined);
        const righeOp = [];
        if (!fatte.length) {
            righeOp.push(`  ${C.grigio}nessuna entrata in questa sessione${C.r}`);
        } else {
            for (const o of fatte.slice(-8).reverse()) {
                const hl = o.holdLog || {};
                const durata = hl.actualDurationMs ? `${(hl.actualDurationMs / 1000).toFixed(0)}s` : "-";
                const motivo = String(hl.exitReason || "").replace("winner ", "").replace("hard ", "");
                const picco = typeof hl.peakPnlPct === "number" ? hl.peakPnlPct : null;
                righeOp.push(
                    `  ${C.grigio}${String(o.buyAt || o.startedAt).slice(0, 8)}${C.r} ` +
                    `${riempi(String(o.tokenMint || "-").slice(0, 10), 11)}` +
                    `${riempi("", Math.max(0, 9 - vis(pct(o.pnlPct, 1))))}${pct(o.pnlPct, 1)} ` +
                    `${riempi((o.pnlSol >= 0 ? C.verde : C.rosso) + (o.pnlSol >= 0 ? "+" : "") + Number(o.pnlSol).toFixed(4) + C.r, 9)}` +
                    `${riempi(durata, 5)}${C.grigio}${tronca(motivo, 16)}${C.r}` +
                    (picco !== null ? ` ${C.grigio}picco${C.r} ${pct(picco, 0)}` : "") +
                    (o.rugLoss ? ` ${C.rosso}RUG${C.r}` : "")
                );
            }
            const somma = fatte.reduce((a, o) => a + Number(o.pnlSol || 0), 0);
            const vinte = fatte.filter((o) => Number(o.pnlPct) > 0).length;
            righeOp.push("");
            righeOp.push(
                `  ${C.b}${fatte.length}${C.r} operazioni   ${C.verde}${vinte}W${C.r}/${C.rosso}${fatte.length - vinte}L${C.r}   ` +
                `${C.b}${(somma >= 0 ? C.verde : C.rosso)}${somma >= 0 ? "+" : ""}${somma.toFixed(4)} SOL${C.r}   ` +
                `${C.grigio}su ${report.finishedEvents} valutazioni${C.r}`
            );
        }
        out.push(...riquadro("OPERAZIONI ESEGUITE", righeOp, w));

        const ultime = (report.operations || []).slice(-6).reverse();
        out.push(...riquadro("ULTIME VALUTAZIONI", ultime.map((o) => {
            const st = String(o.endStatus || "in corso").replace(/\s*\(\d+ms.*$/, "");
            const entrata = /PAPER|COMPLETED/.test(st);
            const motivo = String(o.skipReason || "").replace(/\s*\(curve=.*/, "");
            return `  ${C.grigio}${String(o.startedAt).slice(0, 8)}${C.r}  ${riempi(String(o.tokenMint || "-").slice(0, 10), 12)}` +
                `${(entrata ? C.verde : C.rosso)}${riempi(tronca(st, 22), 23)}${C.r}${C.grigio}${motivo}${C.r}`;
        }), w));

        const perOra = e.span > 0 ? (e.nRecenti / e.span) * 60 : 0;
        const rpcOra = e.span > 0 ? (e.rpcRecenti / e.span) * 60 : 0;
        out.push(...riquadro("CHIAMATE RPC", [
            `  ${C.grigio}sessione${C.r} ${e.n} valutazioni, ${e.rpc} richieste, ${(e.rpc / Math.max(1, e.n)).toFixed(1)}/valutazione`,
            `  ${C.grigio}ultime ${e.nRecenti} (${e.span.toFixed(1)} min)${C.r}  ${C.b}${perOra.toFixed(0)}${C.r}/ora   ` +
            `${C.b}${rpcOra.toFixed(0)}${C.r} req/ora   ${C.b}${((rpcOra * 730) / 1e6).toFixed(1)}M${C.r}/mese`,
        ], w));
    }

    const righeSh = [];
    if (!sh.length) {
        righeSh.push(`  ${C.grigio}nessun token seguito (i job nascono dagli skip, al 20%)${C.r}`);
    } else {
        const stretta = interno < 74;
        righeSh.push(`  ${C.grigio}${riempi("token", 12)}${stretta ? "" : riempi("motivo dello skip", 24)}${"snap".padStart(5)}${"ora".padStart(10)}${"picco".padStart(10)}${C.r}`);
        for (const v of sh.slice(0, 8)) {
            const ls = v.lastSnapshot || {};
            righeSh.push(
                `  ${riempi(String(v.tokenMint).slice(0, 10), 12)}` +
                (stretta ? "" : riempi(tronca(String(v.skipReason || "-").replace(/\s*\(.*/, ""), 22), 24)) +
                `${String(v.snapshots).padStart(5)}` +
                `${riempi("", Math.max(0, 10 - vis(pct(ls.currentPnlPct))))}${pct(ls.currentPnlPct)}` +
                `${riempi("", Math.max(0, 10 - vis(pct(v.peakPnlPct))))}${pct(v.peakPnlPct)}`
            );
        }
        const saliti = sh.filter((v) => typeof v.peakPnlPct === "number" && v.peakPnlPct >= 10).length;
        righeSh.push("");
        righeSh.push(`  ${sh.length} seguiti   ${C.verde}${saliti}${C.r} hanno toccato +10% dopo lo skip`);
    }
    out.push(...riquadro("TOKEN SCARTATI, SEGUITI IN OMBRA", righeSh, w));
    return out;
}

async function disegna() {
    const report = leggiJson(REPORT);
    const [s, att, sh] = [await seriale(), attivita(), shadow()];

    const affiancate = AFFIANCATE();
    const wsx = affiancate ? Math.floor((TOT() - 3) / 2) : Math.min(TOT() - 1, 110);
    const wdx = affiancate ? TOT() - 3 - wsx : wsx;
    // affiancate la colonna di sinistra e' meta' schermo e le tappe devono stare
    // accanto ai riquadri di destra senza sfondare in altezza
    const ic = inCorso(affiancate ? 10 : 7);

    const ora = new Date().toLocaleTimeString("it-IT");
    const testa = C.b + C.ciano + "  PUMP SNIPER" + C.r + C.grigio + `   ${ora}   ricarica ogni ${REFRESH_MS / 1000}s   ctrl-C per uscire` + C.r;

    // La storia sta a sinistra, dove l'occhio parte; l'evento in corso a destra.
    const sx = colonnaStoria(report, sh, wsx);
    const dx = colonnaOra(s, att, ic, wdx);

    const corpo = affiancate
        ? [riempi(C.b + "  ▌ LA SESSIONE FINORA" + C.r, wsx) + "  " + C.b + "  ▌ ADESSO" + C.r, ...affianca(sx, dx, wsx)]
        : [...dx, ...sx];

    process.stdout.write("\x1b[H\x1b[2J" + testa + "\n" + corpo.join("\n") + "\n");
}

process.stdout.write("\x1b[?25l");
const chiudi = () => { process.stdout.write("\x1b[?25h\n"); process.exit(0); };
process.on("SIGINT", chiudi);
process.on("SIGTERM", chiudi);

(async function ciclo() {
    for (;;) {
        try { await disegna(); } catch (e) { process.stdout.write(`errore: ${e.message}\n`); }
        await new Promise((r) => setTimeout(r, REFRESH_MS));
    }
})();
