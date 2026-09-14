#!/usr/bin/env node
/**
 * Cruscotto del paper trade stonk.fun: una schermata sola che si ridisegna.
 *
 * Fonti, tutte e due scritte da scripts/stonk-paper.js:
 *   logs/stonk-paper.log    il battito del daemon, cioe' i contatori vivi
 *   logs/stonk-paper.jsonl  un record per ogni ingresso e uno per ogni chiusura
 *
 * E' un file separato da scripts/dashboard.js e non un suo ramo perche' quello legge i
 * log Docker del container `sniper` e logs/paper-report.json: per stonk non esiste ne'
 * l'uno ne' l'altro, e il daemon gira come processo nudo.
 *
 * Il jsonl si legge in modo incrementale (si tiene l'offset in byte): cresce per ore, e
 * rileggerlo intero ogni due secondi diventerebbe il lavoro principale del processo.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const LOG = path.join(ROOT, "logs", "stonk-paper.log");
const JSONL = path.join(ROOT, "logs", "stonk-paper.jsonl");
const REFRESH_MS = Number(process.env.CRUSCOTTO_REFRESH_MS || 2000);

const C = {
    r: "\x1b[0m", b: "\x1b[1m",
    rosso: "\x1b[31m", verde: "\x1b[32m", giallo: "\x1b[33m",
    ciano: "\x1b[36m", grigio: "\x1b[90m",
};

const TOT = () => Math.max(72, process.stdout.columns || 100);
const AFFIANCATE = () => TOT() >= 132;

const nudo = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
const vis = (s) => nudo(s).length;
const riempi = (s, w) => s + " ".repeat(Math.max(0, w - vis(s)));
const tronca = (s, w) => {
    if (vis(s) <= w) return s;
    let out = "", n = 0;
    for (const ch of nudo(s)) { if (n + 1 > w - 1) break; out += ch; n += 1; }
    return out + "…";
};

function riquadro(titolo, righe, w) {
    const interno = w - 2;
    const out = [];
    out.push(C.grigio + "┌─ " + C.r + C.b + titolo + C.r + " " + C.grigio
        + "─".repeat(Math.max(0, interno - vis(titolo) - 3)) + "┐" + C.r);
    for (const r of righe) {
        out.push(C.grigio + "│" + C.r + riempi(tronca(r, interno), interno) + C.grigio + "│" + C.r);
    }
    out.push(C.grigio + "└" + "─".repeat(interno) + "┘" + C.r);
    return out;
}

function affianca(sx, dx, wsx) {
    const n = Math.max(sx.length, dx.length);
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(riempi(sx[i] || "", wsx) + "  " + (dx[i] || ""));
    return out;
}

const rend = (x, d = 1) => (x >= 0 ? C.verde : C.rosso) + (x >= 0 ? "+" : "") + (100 * x).toFixed(d) + "%" + C.r;
const pc = (x, d = 2) => (100 * x).toFixed(d) + "%";
const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : null);
const ora = (t) => new Date(t).toISOString().slice(11, 19);
// p = uscita a prezzo, t = uscita a tempo, m = meta' all'obiettivo e il resto corre
const ordinaRegole = (x, y) => (x[0] === y[0]
  ? Number(x.slice(1)) - Number(y.slice(1))
  : 'ptbrm'.indexOf(x[0]) - 'ptbrm'.indexOf(y[0]));


function barra(n, tot, w) {
    if (!tot) return C.grigio + "░".repeat(w) + C.r;
    const p = Math.max(0, Math.min(w, Math.round((n / tot) * w)));
    return C.ciano + "█".repeat(p) + C.r + C.grigio + "░".repeat(w - p) + C.r;
}

/* ---------- il battito del daemon ---------- */

/**
 * Le righe di stato hanno un campo che NON si puo' spezzare sugli spazi: `scartate={...}`
 * e' JSON e le sue chiavi sono frasi ("conto non ancora leggibile"). Va estratto a parte.
 */
function leggiBattito() {
    let testo;
    try { testo = fs.readFileSync(LOG, "utf8"); } catch { return null; }
    const tutte = testo.split("\n");
    const righe = tutte.filter((r) => r.includes(" PAPER "));
    const ultima = righe[righe.length - 1];
    if (!ultima) return { pool: null };
    const g = (k) => { const m = new RegExp(k + "=(\\d+)").exec(ultima); return m ? Number(m[1]) : null; };
    const scar = /scartate=(\{.*?\})\s+nate_gia_sopra/.exec(ultima);
    const lg = /log=(\d+)\/(\d+)/.exec(ultima);
    const t = /^\[([^\]]+)\]/.exec(ultima);
    const prima = /^\[([^\]]+)\]/.exec(righe[0]);
    const cfg = /ingresso ([\d.\-]+%), (.+)$/.exec(tutte.find((r) => r.startsWith("paper stonk.fun")) || "");
    let scartate = {};
    if (scar) { try { scartate = JSON.parse(scar[1]); } catch { scartate = {}; } }
    return {
        t: t ? Date.parse(t[1]) : null,
        avvio: prima ? Date.parse(prima[1]) : null,
        pool: g("pool"), notifiche: g("notifiche"), ingressi: g("ingressi"),
        posizioni: g("posizioni"), chiuse: g("chiuse"), aperte: g("aperte"),
        log: lg ? Number(lg[1]) : null, creazioni: lg ? Number(lg[2]) : null,
        sub: g("sub"), nate: g("nate"), nateSopra: g("nate_gia_sopra"),
        poolSotto: g("pool_sotto"), poolSopra: g("pool_sopra"),
        ingressiSopra: g("ingressi_sopra"), troppoAlte: g("troppo_alte"),
        coda: g("coda"), scartate,
        ingresso: cfg ? cfg[1] : null, uscite: cfg ? cfg[2] : null,
    };
}

function vivo() {
    try {
        const out = execFileSync("pgrep", ["-f", "scripts/stonk-paper.js"], { encoding: "utf8" });
        const pid = out.split("\n").map((x) => x.trim()).filter(Boolean)[0];
        return pid ? Number(pid) : null;
    } catch { return null; }
}

/* ---------- il jsonl, ogni riga letta una volta sola ---------- */

const stato = {
    offset: 0, resto: "",
    ingressi: 0, dallaNascita: 0, fIngresso: [], piattaforme: {}, modi: {},
    visteSotto: 0, visteSopra: [], etaPrimoIncontro: [],
    regole: new Map(),
    ultimeChiuse: [],
    da: null, a: null,
};

function assorbi(rec) {
    if (typeof rec.t === "number") {
        stato.da = stato.da === null ? rec.t : Math.min(stato.da, rec.t);
        stato.a = stato.a === null ? rec.t : Math.max(stato.a, rec.t);
    }
    if (rec.tipo === "vista") {
        if (rec.sopra) stato.visteSopra.push(rec.f); else stato.visteSotto += 1;
        if (typeof rec.secondiDallaNascita === "number") stato.etaPrimoIncontro.push(rec.secondiDallaNascita);
        return;
    }
    if (rec.tipo === "ingresso") {
        stato.ingressi += 1;
        const m = rec.modo || "attraversamento";
        stato.modi[m] = (stato.modi[m] || 0) + 1;
        if (rec.dallaNascita) stato.dallaNascita += 1;
        stato.fIngresso.push(rec.f);
        const k = `${rec.piattaforma} ${(100 * rec.tassa).toFixed(0)}%`;
        stato.piattaforme[k] = (stato.piattaforme[k] || 0) + 1;
        return;
    }
    if (rec.tipo !== "chiusa") return;
    let g = stato.regole.get(rec.regola);
    if (!g) { g = { n: 0, motivi: {}, rend: [], secondi: [], somma: 0 }; stato.regole.set(rec.regola, g); }
    g.n += 1;
    g.motivi[rec.motivo] = (g.motivi[rec.motivo] || 0) + 1;
    g.rend.push(rec.rendimento);
    g.secondi.push(rec.secondi);
    g.somma += rec.rendimento;
    stato.ultimeChiuse.push(rec);
    if (stato.ultimeChiuse.length > 12) stato.ultimeChiuse.shift();
}

function aggiornaJsonl() {
    let st;
    try { st = fs.statSync(JSONL); } catch { return; }
    if (st.size < stato.offset) { stato.offset = 0; stato.resto = ""; }   // file azzerato
    if (st.size === stato.offset) return;
    const fd = fs.openSync(JSONL, "r");
    const buf = Buffer.alloc(st.size - stato.offset);
    fs.readSync(fd, buf, 0, buf.length, stato.offset);
    fs.closeSync(fd);
    stato.offset = st.size;
    const righe = (stato.resto + buf.toString("utf8")).split("\n");
    stato.resto = righe.pop();
    for (const r of righe) {
        if (!r.trim()) continue;
        try { assorbi(JSON.parse(r)); } catch { /* riga scritta a meta', tornera' */ }
    }
}

/* ---------- le viste ---------- */

function vistaAdesso(b, pid) {
    const righe = [];
    const eta = b && b.t ? Math.round((Date.now() - b.t) / 1000) : null;
    righe.push(" daemon      " + (pid
        ? C.verde + "vivo" + C.r + C.grigio + `  pid ${pid}` + C.r
        : C.rosso + "fermo" + C.r + C.grigio + "  ./scripts/bot stonk su" + C.r)
        + (eta !== null ? C.grigio + `   battito ${eta}s fa` + C.r : ""));
    if (!b || b.pool === null) {
        righe.push(C.grigio + " (nessun battito in logs/stonk-paper.log)" + C.r);
        return righe;
    }
    const oreVive = b.avvio ? (Date.now() - b.avvio) / 3600000 : 0;
    righe.push(" acceso da   " + (oreVive ? oreVive.toFixed(2) + " ore" : "?")
        + C.grigio + `   soglia ${b.ingresso || "?"}  uscite ${b.uscite || "?"}` + C.r);
    righe.push("");
    righe.push(" pool viste  " + String(b.pool).padStart(6)
        + C.grigio + `   notifiche ${b.notifiche}`
        + (oreVive ? ` (${(b.notifiche / oreVive / 3600).toFixed(1)}/s)` : "") + C.r);
    righe.push(" sottoscriz. " + String(b.sub).padStart(6)
        + C.grigio + `   log ${b.log}, creazioni ${b.creazioni}` + C.r);
    righe.push(" coda nascite" + String(b.coda).padStart(6)
        + (b.coda > 20 ? C.giallo + "   in ritardo sulle creazioni" + C.r : ""));
    const scartate = Object.entries(b.scartate || {});
    righe.push(" scartate    " + (scartate.length
        ? C.giallo + scartate.map(([k, v]) => `${v} ${k}`).join(", ") + C.r
        : C.verde + "nessuna" + C.r));
    righe.push("");
    righe.push(" posizioni   " + C.b + String(b.aperte).padStart(6) + C.r + " aperte adesso"
        + C.grigio + `   ${b.posizioni} in tutto, ${b.chiuse} chiuse` + C.r);
    return righe;
}

/**
 * L'imbuto e' la misura che conta davvero: quante curve riusciamo a vedere da SOTTO la
 * soglia, cioe' quante possiamo davvero prendere all'attraversamento. Tutto il resto ci
 * arriva quando il punto d'ingresso e' gia' passato, e non sarebbe comprabile.
 */
function vistaImbuto(b, w) {
    if (!b || b.nate === null) return [C.grigio + " (ancora niente)" + C.r];
    const sotto = b.poolSotto || 0;
    const sopra = b.poolSopra || 0;
    const viste = sotto + sopra;
    const largo = Math.max(8, w - 36);
    const riga = (et, n2, max) => ` ${riempi(et, 23)}${String(n2).padStart(6)}  ${barra(n2, max, largo)}`;
    const righe = [
        riga("pool incontrate", viste, viste || 1),
        riga("  sotto soglia", sotto, viste || 1),
        riga("  gia' oltre", sopra, viste || 1),
        "",
        riga("nascite dai log", b.nate, Math.max(b.nate, 1)),
        riga("  gia' oltre a 1a lettura", b.nateSopra, Math.max(b.nate, 1)),
    ];
    const f = stato.visteSopra.slice().sort((x, y) => x - y);
    if (f.length) {
        righe.push("");
        righe.push(C.grigio + " quando le troviamo gia' oltre, sono a:" + C.r);
        righe.push(`   mediana ${pc(q(f, 0.5))}   25esimo ${pc(q(f, 0.25))}   75esimo ${pc(q(f, 0.75))}`);
    }
    righe.push("");
    righe.push(" " + riempi("ingressi", 23) + C.b + String(b.ingressi).padStart(6) + C.r
        + C.grigio + `   di cui ${b.ingressiSopra || 0} comprate gia' sopra`
        + (b.troppoAlte ? `, ${b.troppoAlte} scartate troppo alte` : "") + C.r);
    return righe;
}

function vistaIngressi() {
    const righe = [];
    const f = stato.fIngresso.slice().sort((x, y) => x - y);
    righe.push(" ingressi  " + String(stato.ingressi).padStart(5)
        + C.grigio + `   di cui ${stato.dallaNascita} seguiti dalla nascita` + C.r);
    if (f.length) {
        righe.push(" raccolta  " + C.grigio
            + `  mediana ${pc(q(f, 0.5))}   min ${pc(q(f, 0))}   max ${pc(q(f, 1))}` + C.r);
    }
    const m = Object.entries(stato.modi).sort((a, b2) => b2[1] - a[1]);
    if (m.length) righe.push(" modo      " + C.grigio + "  " + m.map(([k, v]) => `${k} x${v}`).join("   ") + C.r);
    const e = stato.etaPrimoIncontro.slice().sort((x, y) => x - y);
    if (e.length) righe.push(" eta'      " + C.grigio + `  primo incontro a ${q(e, 0.5).toFixed(1)}s dalla nascita (n=${e.length})` + C.r);
    const p = Object.entries(stato.piattaforme).sort((a, b2) => b2[1] - a[1]);
    if (p.length) righe.push(" tipo      " + C.grigio + "  " + p.map(([k, v]) => `${k} x${v}`).join("   ") + C.r);
    return righe;
}

function vistaRegole() {
    if (!stato.regole.size) return [C.grigio + " (nessuna posizione chiusa)" + C.r];
    const righe = [C.grigio + " regola    n  bene  ricad  scad    mediano    medio   sec" + C.r];
    const nomi = [...stato.regole.keys()].sort(ordinaRegole);
    for (const nome of nomi) {
        const g = stato.regole.get(nome);
        const r = g.rend.slice().sort((x, y) => x - y);
        const s = g.secondi.slice().sort((x, y) => x - y);
        const m = (k) => String(g.motivi[k] || 0).padStart(6);
        const bene = (g.motivi.obiettivo || 0) + (g.motivi.completamento || 0) + (g.motivi.migrata || 0);
        righe.push(" " + riempi(nome, 7) + String(g.n).padStart(3)
            + String(bene).padStart(5) + m("ricaduta") + String((g.motivi.scadenza || 0) + (g.motivi.stagnante || 0)).padStart(6)
            + "   " + riempi(rend(q(r, 0.5)), 9) + riempi(rend(g.somma / g.n), 9)
            + String(Math.round(q(s, 0.5))).padStart(5));
    }
    return righe;
}

function vistaUltime() {
    if (!stato.ultimeChiuse.length) return [C.grigio + " (nessuna chiusura ancora)" + C.r];
    return stato.ultimeChiuse.slice().reverse().map((c) =>
        ` ${C.grigio}${ora(c.t)}${C.r}  ${riempi(c.regola, 6)}${riempi(String(c.mint).slice(0, 8), 10)}`
        + riempi(`${pc(c.fIngresso)} → ${pc(c.fUscita)}`, 20)
        + riempi(rend(c.rendimento), 10) + riempi(c.motivo, 12)
        + C.grigio + `${c.secondi}s` + C.r);
}

/* ---------- il disegno ---------- */

function disegna() {
    aggiornaJsonl();
    const b = leggiBattito();
    const pid = vivo();
    const tot = TOT();
    const out = [];

    out.push("", C.b + "  stonk.fun · paper trade" + C.r
        + C.grigio + "   " + new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC"
        + (stato.da ? `   finestra ${((stato.a - stato.da) / 3600000).toFixed(2)} ore` : "") + C.r, "");

    if (AFFIANCATE()) {
        const wsx = Math.floor((tot - 2) * 0.52);
        const wdx = tot - 2 - wsx;
        const sx = [
            ...riquadro("ADESSO", vistaAdesso(b, pid), wsx),
            ...riquadro("IMBUTO D'INGRESSO", vistaImbuto(b, wsx), wsx),
        ];
        const dx = [
            ...riquadro("INGRESSI", vistaIngressi(), wdx),
            ...riquadro("USCITE IN PROVA", vistaRegole(), wdx),
        ];
        out.push(...affianca(sx, dx, wsx));
    } else {
        out.push(...riquadro("ADESSO", vistaAdesso(b, pid), tot));
        out.push(...riquadro("IMBUTO D'INGRESSO", vistaImbuto(b, tot), tot));
        out.push(...riquadro("INGRESSI", vistaIngressi(), tot));
        out.push(...riquadro("USCITE IN PROVA", vistaRegole(), tot));
    }
    out.push(...riquadro("ULTIME CHIUSURE", vistaUltime(), tot));
    out.push(C.grigio + "  q per uscire · ./scripts/bot stonk report per la misura completa" + C.r);

    process.stdout.write("\x1b[H\x1b[2J" + out.join("\n") + "\n");
}

process.stdout.write("\x1b[?25l");
const chiudi = () => { process.stdout.write("\x1b[?25h\n"); process.exit(0); };
process.on("SIGINT", chiudi);
process.on("SIGTERM", chiudi);
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (d) => { if (/[q]/.test(String(d))) chiudi(); });
}
disegna();
setInterval(disegna, REFRESH_MS);
