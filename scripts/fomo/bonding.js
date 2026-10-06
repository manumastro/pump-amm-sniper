// Tracciatore dei token in bonding e graduati (Solana). Gira in background e tiene un registro
// persistente: dati/fomo/bonding/registro.json, log in dati/fomo/bonding.log.
// Ogni ~2 minuti legge le liste di scoperta di fomo ("Bonding" = filtered-bonding, i piu' vicini alla
// graduation; "Graduated" = filtered-bonded, le graduation piu' recenti). L'app le prende da Mobula
// pulse (POST mobula-api.fomo.family/api/2/pulse, stesso token di fomo): qui passano dal client di
// ~/fomo-mcp (Chrome headless, perche' fetch e curl vengono bloccati al bordo con 430).
// Un token che si gradua non compare subito in "Graduated": per i token tracciati e non piu' in lista
// si legge la curva pump.fun sulla catena (getMultipleAccounts: complete, riserve reali) e si chiede a
// fomo (filterTokens: launchpad.migrated) finche' non risultano graduati o morti (curva ferma da 6 ore).
// Uso: nohup node scripts/fomo/bonding.js >/dev/null 2>&1 &     (BONDING_PASSO=secondi, default 120)
const fs = require('fs'); const path = require('path');
const { PublicKey } = require('@solana/web3.js');
const { DATI, rpc, leggi, scrivi, sleep } = require('./comune');
process.env.FOMO_TOKEN_FILE = process.env.FOMO_TOKEN_FILE || path.join(require('os').homedir(), '.config/fomo-mcp/token');
const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const N = 1399811149, PASSO = +(process.env.BONDING_PASSO || 120) * 1000, MORTO = 6 * 3600;
const REALI = 793_100_000e6;                     // token reali in vendita sulla curva pump.fun (6 decimali)
const F = 'bonding/registro.json', LOG = path.join(DATI, 'bonding.log');
const log = s => fs.appendFileSync(LOG, `${new Date().toISOString().slice(0, 19)} ${s}\n`);
const curvaDi = m => PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(m).toBuffer()], PUMP)[0].toBase58();
const ts = x => (x ? Math.floor(Date.parse(x) / 1000) : null);
let fomo;
const cliente = async () => { if (!fomo) { const { FomoClient } = await import(path.join(require('os').homedir(), 'fomo-mcp/dist/client.js')); fomo = new FomoClient(''); } return fomo; };
// la pagina di Chrome headless ogni tanto si ricarica da sola ("Target page ... closed"): si riprova
const prova = async f => { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i >= 3 || !/closed|Execution context|navigat/i.test(e.message)) throw e; await sleep(3000); } } };
// curva pump.fun: 8 discriminatore, poi u64 virtual_token, virtual_sol, real_token, real_sol, supply, bool complete
function leggiCurva(b64) {
  const b = Buffer.from(b64, 'base64'); if (b.length < 49) return null;
  const u = o => Number(b.readBigUInt64LE(o));
  return { real_tok: u(24), real_sol: u(32) / 1e9, complete: b[48] === 1, bp: Math.min(100, 100 * (1 - u(24) / REALI)) };
}
// solo i campi che servono: descrizione, social, chi lancia, numeri del momento
const scheda = x => ({ sym: x.symbol, nome: x.name, fonte: x.source, tipo: x.type, creato: ts(x.createdAt), deployer: x.deployer,
  dep_token: x.deployerTokensCount, dep_migr: x.deployerMigrationsCount, desc: (x.description || '').slice(0, 500),
  twitter: x.socials?.twitter || null, sito: x.socials?.website || null, telegram: x.socials?.telegram || null, creato_su: x.socials?.others?.createdOn || null });
const istante = (x, lista) => ({ t: Math.floor(Date.now() / 1000), lista, bp: x.bondingPercentage != null ? +(+x.bondingPercentage).toFixed(2) : null,
  mcap: Math.round(x.marketCap || 0), holders: x.holdersCount, vol1h: Math.round(x.volume_1h || 0), trades1h: x.trades_1h,
  top10: x.top10Holdings != null ? +(+x.top10Holdings).toFixed(1) : null, dev: x.devHoldings != null ? +(+x.devHoldings).toFixed(1) : null,
  insiders: x.insidersHoldings != null ? +(+x.insidersHoldings).toFixed(1) : null, bundlers: x.bundlersHoldings != null ? +(+x.bundlersHoldings).toFixed(1) : null });
// si tiene un passaggio solo se qualcosa e' cambiato davvero, o ogni 10 minuti
function aggiungi(r, p) {
  const u = r.passaggi.at(-1);
  if (u && p.t - u.t < 600 && Math.abs((p.bp ?? 0) - (u.bp ?? 0)) < 0.5 && Math.abs(p.mcap - u.mcap) < 0.03 * (u.mcap || 1) && p.lista === u.lista) return;
  r.passaggi.push(p);
}
async function giro(R) {
  const c = await cliente(); const ora = Math.floor(Date.now() / 1000);
  const pre = await prova(() => c.discoverTokens('pre-graduated', ['solana:solana'], 100)), grad = await prova(() => c.discoverTokens('graduated', ['solana:solana'], 100));
  let nuovi = 0, graduati = 0;
  for (const [lista, righe] of [['bonding', pre], ['graduated', grad]]) for (const x of righe) {
    const m = x.address; if (!m) continue;
    let r = R[m];
    if (!r) { r = R[m] = { mint: m, ...scheda(x), primo_visto: ora, prima_lista: lista, stato: 'bonding', passaggi: [], bp_max: 0 }; nuovi++;
      if (x.source === 'pumpfun') r.curva = curvaDi(m); }
    r.ultimo_visto = ora; r.ultima_lista = lista;
    const p = istante(x, lista); aggiungi(r, p); if (lista === 'bonding' && p.bp > r.bp_max) r.bp_max = p.bp;
    if (lista === 'graduated' || x.bonded) {
      if (r.stato !== 'graduato') { r.stato = 'graduato'; graduati++; if (r.prima_lista === 'bonding') log(`graduato ${r.sym} ${m} (in lista; seguito in bonding da ${Math.round((ora - r.primo_visto) / 60)} min)`); }
      r.graduato_at = r.graduato_at || ts(x.bonded_at); r.in_graduated = r.in_graduated || ora; r.pool = x.poolAddress;
      if (!r.grad_fonte) r.grad_fonte = 'lista';
    }
  }
  // i token seguiti in bonding che non sono piu' nelle liste: curva sulla catena e fomo
  const fuori = Object.values(R).filter(r => r.stato === 'bonding' && r.ultimo_visto < ora - 60);
  const pf = fuori.filter(r => r.curva);
  for (let i = 0; i < pf.length; i += 100) {
    const parte = pf.slice(i, i + 100);
    const a = await rpc('sol', 'getMultipleAccounts', [parte.map(r => r.curva), { encoding: 'base64' }]);
    a.value.forEach((v, k) => {
      const r = parte[k]; const cv = v && leggiCurva(v.data[0]); if (!cv) return;
      if (r.real_sol == null || Math.abs(cv.real_sol - r.real_sol) > 1e-6) r.mosso = ora;
      r.real_sol = cv.real_sol; r.bp_catena = +cv.bp.toFixed(2); if (cv.bp > r.bp_max) r.bp_max = +cv.bp.toFixed(2);
      if (cv.complete && r.stato !== 'graduato') { r.stato = 'graduato'; r.grad_fonte = 'catena'; r.grad_visto = ora; graduati++; log(`graduato ${r.sym} ${r.mint} (curva completa sulla catena, non ancora in lista)`); }
    });
  }
  const altri = fuori.filter(r => !r.curva && r.stato === 'bonding');
  for (let i = 0; i < altri.length; i += 50) {
    const parte = altri.slice(i, i + 50);
    const f = await prova(() => c.filterTokens(parte.map(r => `${r.mint}:${N}`)));
    for (const x of f || []) {
      const r = R[x.token?.address]; if (!r) continue; const lp = x.token?.launchpad || x.launchpad;
      const gp = lp?.graduationPercent; if (gp != null && gp !== r.gp) { r.gp = gp; r.mosso = ora; }
      if (lp?.migrated && r.stato !== 'graduato') { r.stato = 'graduato'; r.grad_fonte = 'fomo'; r.grad_visto = ora; graduati++; log(`graduato ${r.sym} ${r.mint} (fomo: migrated)`); }
    }
  }
  for (const r of fuori) if (r.stato === 'bonding' && ora - (r.mosso || r.ultimo_visto) > MORTO) { r.stato = 'morto'; r.morto_at = ora; log(`morto ${r.sym} ${r.mint} (fermo da 6 ore, massimo ${r.bp_max}%)`); }
  return { pre: pre.length, grad: grad.length, nuovi, graduati, fuori: fuori.length };
}
(async () => {
  fs.mkdirSync(path.join(DATI, 'bonding'), { recursive: true });
  const R = leggi(F, {});
  log(`avvio pid ${process.pid}, ${Object.keys(R).length} token nel registro`);
  for (;;) {
    const t0 = Date.now();
    try {
      const s = await giro(R); scrivi(F, R);
      const st = Object.values(R).reduce((a, r) => (a[r.stato] = (a[r.stato] || 0) + 1, a), {});
      log(`liste ${s.pre}+${s.grad}, nuovi ${s.nuovi}, graduati ${s.graduati}, fuori lista ${s.fuori} | registro ${JSON.stringify(st)}`);
    } catch (e) { log('errore ' + String(e.message || e).slice(0, 200)); }
    await sleep(Math.max(5000, PASSO - (Date.now() - t0)));
  }
})();
