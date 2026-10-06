// Fotografia a richiesta dei token in bonding su fomo (Solana), sia la scheda Bonding dell'app ('filtered-bonding')
// sia la lista completa senza filtri ('bonding', che nell'app non si vede) e i 500 token piu' giovani ('new'). Cerca i token tenuti da un gruppo di utenti
// fomo (non pochissimi, non una folla) e nati da poco: per default almeno 5 holder fomo (nessun massimo) e al massimo 48 ore di vita.
// Per ognuno: holder fomo (quanti, valore, chi e' bravo), curva, mcap, liquidita', holder on-chain; le tesi sono un di piu'.
// "Bravo" = fra i primi 1000 di fomo a 30 giorni con pnl positivo (la coda, non la media). Solo lettura.
// Uso: FOMO_TOKEN_FILE=~/.config/fomo-mcp/token node scripts/fomo/bonding_ora.mjs [min_holder] [max_holder] [max_ore] [min_curva]
// (default 5 Infinity 48 0: qualunque % di curva; dove fomo da' 0% la curva si legge sulla catena con curve.js).
// Per ogni holder fomo: mcap e % di curva al suo prezzo medio d'ingresso (offerta 1 miliardo; la % solo per pump.fun).
//   -> dati/fomo/tesi/snapshot/bonding-<ora>.json e a schermo i candidati, una riga json per token.
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const { FomoClient } = await import(pathToFileURL(path.join(os.homedir(), 'fomo-mcp', 'dist', 'client.js')).href);  // URL file:// anche su Windows
const C = new FomoClient('x'), SOLN = 1399811149;
const [MIN_H, MAX_H, MAX_ORE, MIN_CURVA] = [+(process.argv[2] ?? 5), +(process.argv[3] ?? Infinity), +(process.argv[4] ?? 48), +(process.argv[5] ?? 0)];
import { createRequire } from 'module';
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dati/fomo/tesi');
const CLASS = path.join(DIR, 'oneshot/classifica_autori.json');
fs.mkdirSync(path.join(DIR, 'snapshot'), { recursive: true });
const leggi = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const ora = Date.now() / 1000; let richieste = 0;

// 1) le tre liste
const T = new Map();
// 'new' = i 500 token piu' giovani: i token appena nati e saliti in fretta spesso non sono ancora nelle due liste bonding
// (4/10: Agent Capital, 5 wallet fomo al minuto 6 e graduato al 19, non e' mai comparso nelle liste bonding)
for (const v of ['filtered-bonding', 'bonding', 'new']) for (let off = 0; off < 500; off += 100) {
  // la lista a volte torna corta a meta' (157 token invece di ~500): una pagina corta si richiede fino a 3 volte e si tiene la piu' lunga
  let L = [];
  for (let prova = 0; prova < 3 && L.length < 100; prova++) { try { const P = await C.discoverTokens(v, ['solana:solana'], 100, off); richieste++; if (P.length > L.length) L = P; } catch (e) { console.error(v, off, e.message.slice(0, 80)); } }
  for (const k of L) { const nato = Date.parse(k.created_at || k.createdAt || '') / 1000 || null;
    if (!T.has(k.address)) T.set(k.address, { tok: k.address, sym: k.symbol, nome: k.name, curva: +k.bondingPercentage, mcap: +(k.marketCap ?? k.market_cap), liq: +(k.liquidity ?? 0), holder_catena: +(k.holdersCount ?? 0), nato, ore: nato ? +((ora - nato) / 3600).toFixed(1) : null, social: k.socials, nell_app: false });
    // 'filtered-bonding' e' la scheda Bonding dell'app; 'bonding' e' la lista completa senza filtri
    if (v === 'filtered-bonding') T.get(k.address).nell_app = true; }
  if (L.length < 100) break;
}
// 2) holder fomo, a gruppi di 20 token per chiamata (totalHolders = utenti fomo che lo tengono)
const R = leggi(CLASS, {});
const tutti = [...T.values()].filter(t => t.ore == null || t.ore <= MAX_ORE);
for (let i = 0; i < tutti.length; i += 20) {
  let H = []; try { H = await C.topHolders(tutti.slice(i, i + 20).map(t => ({ address: t.tok, networkId: SOLN }))); richieste++; } catch (e) { continue; }
  for (const h of H) { const t = T.get(h.tokenAddress); if (!t) continue;
    t.holder_fomo = h.totalHolders ?? h.topHolders?.length ?? 0;
    t.valore_fomo = Math.round((h.topHolders || []).reduce((s, x) => s + (x.value || 0), 0));
    t.chi = (h.topHolders || []).map(x => ({ u: x.user?.userHandle, uid: x.user?.id, val: Math.round(x.value || 0), costo: Math.round(x.costBasis || 0), mc_ingresso: x.averageEntryPrice ? Math.round(x.averageEntryPrice * 1e9) : null, dev: !!x.isDev, tesi: x.comment?.comment ? String(x.comment.comment).slice(0, 200) : null })); }
}
let cand = tutti.filter(t => (t.holder_fomo ?? 0) >= MIN_H && t.holder_fomo <= MAX_H);
// fomo a volte da' 0% di curva a token che ne hanno molta di piu': per quelli si legge la curva sulla catena
const zero = cand.filter(t => !t.curva);
if (zero.length) try {
  const { curve } = createRequire(import.meta.url)('./curve.js');
  for (const r of await curve(zero.map(t => t.tok))) { const t = T.get(r.mint); if (t && r.percentuale_curva != null) { t.curva = +r.percentuale_curva; t.curva_da = 'catena'; } if (t && (r.graduato || r.migrato)) t.migrato = true; }
} catch (e) { console.error('curve.js', e.message.slice(0, 100)); }
cand = cand.filter(t => t.curva >= MIN_CURVA && t.curva < 100 && !t.migrato);  // 'new' contiene anche i graduati (100%)
// 3) classifica degli holder nuovi (in cache) e tesi dei candidati
const nuovi = [...new Set(cand.flatMap(t => t.chi.map(x => x.uid)))].filter(u => u && !R[u]);
for (const u of nuovi) { try { const r = await C.getUserRank(u); richieste++; R[u] = { h: null, sempre: r?.rank?.pnl, m30: r?.rank30d?.pnl, g1: r?.rank24h?.pnl, pos30: r?.rank30d?.rank, letto: new Date().toISOString() }; } catch (e) {} }
fs.writeFileSync(CLASS, JSON.stringify(R));
const bravo = u => (R[u]?.pos30 ?? 1e9) <= 1000 && (R[u]?.m30 ?? 0) > 0;
// % di curva pump.fun da una mcap in dollari: mcap_SOL = 32.190.000 / T^2, T = 1073 - 793,1*p (milioni di token)
let solUsd = 120; try { const [s] = await C.filterTokens(['So11111111111111111111111111111111111111112:' + SOLN]); richieste++; if (+s?.priceUSD > 0) solUsd = +s.priceUSD; } catch (e) {}
const curvaPump = mc => { if (!mc) return null; const T = Math.sqrt(32190000 / (mc / solUsd)); return Math.max(0, Math.min(100, Math.round((1073 - T) / 793.1 * 100))); };
for (const t of cand) {
  let r; try { r = await C.tokenThesis(t.tok, SOLN, 50, 0); richieste++; } catch (e) {}
  t.tesi = (r?.items || []).map(x => ({ u: x.userHandle, uid: x.userId, mc: x.comment?.marketCapAtCreation, pos: x.authorTrade?.usdValue, txt: String(x.comment?.comment || '').slice(0, 200) }));
  const pf = t.tok.endsWith('pump') || t.lp === 'Pump.fun';
  // primo acquisto di ogni utente fomo dal feed degli swap del token (il prezzo medio nasconde quando e' entrato davvero)
  const acquisti = {}; let lastId;
  for (let i = 0; i < 6; i++) { let r; try { r = await C.tokenFeed({ tokenAddress: t.tok, networkId: SOLN, limit: 100, threshold: 0, lastId }); richieste++; } catch (e) { break; }
    const it = r?.items || []; for (const x of it) if (x.type === 'swap_buy' && x.userHandle) (acquisti[x.userHandle] ||= []).push({ q: x.createdAt, mc: x.marketCap, usd: x.usdAmount });
    if (it.length < 100) break; lastId = it.at(-1).id; }
  for (const x of t.chi) { const a = (acquisti[x.u] || []).sort((p, q) => p.q.localeCompare(q.q))[0];
    if (a) { x.primo_mc = Math.round(a.mc); x.primo_usd = Math.round(a.usd || 0); x.primo_q = a.q; } }
  for (const x of t.chi) x.curva_ingresso = pf ? curvaPump(x.mc_ingresso) : null;
  const k = v => v >= 1000 ? Math.round(v / 1000) + 'k' : String(v);
  for (const x of t.chi) x.primo_curva = pf ? curvaPump(x.primo_mc) : null;
  // per holder: primo acquisto (mcap e % di curva) e prezzo medio; in ordine di primo ingresso
  t.ingressi = t.chi.filter(x => x.primo_mc || x.mc_ingresso).sort((a, b) => (a.primo_mc || a.mc_ingresso) - (b.primo_mc || b.mc_ingresso))
    .map(x => `${x.u}${bravo(x.uid) ? '*' : ''} costo $${x.costo}: primo ${x.primo_mc ? '$' + k(x.primo_mc) + (x.primo_curva != null ? ' (' + x.primo_curva + '%)' : '') : '?'}, medio $${k(x.mc_ingresso || 0)}${x.curva_ingresso != null ? ' (' + x.curva_ingresso + '%)' : ''}`);
  t.primi_presto = t.chi.filter(x => x.primo_curva != null && x.primo_curva <= 30).length;
  t.bravi_holder = t.chi.filter(x => bravo(x.uid)).map(x => `${x.u} ($${x.val})`);
  t.bravi_tesi = [...new Set(t.tesi.filter(x => bravo(x.uid)).map(x => x.u))];
}
const stamp = new Date().toISOString().slice(0, 16).replace(':', '');
// BONDING_OUT: file d'uscita al posto di snapshot/bonding-<ora>.json (lo usa bonding_live.mjs)
const OUT = process.env.BONDING_OUT || path.join(DIR, 'snapshot', `bonding-${stamp}.json`);
fs.writeFileSync(OUT, JSON.stringify({ stamp, criteri: { MIN_H, MAX_H, MAX_ORE, MIN_CURVA }, liste: T.size, recenti: tutti.length, candidati: cand.length, richieste, dati: cand }));
console.error(`token in bonding ${T.size} (nell'app ${[...T.values()].filter(t => t.nell_app).length}), nati da <= ${MAX_ORE}h ${tutti.length}, con ${MAX_H === Infinity ? 'almeno ' + MIN_H : MIN_H + '-' + MAX_H} holder fomo e curva >= ${MIN_CURVA}% ${cand.length}, richieste ${richieste} -> ${path.relative(process.cwd(), OUT)}`);
// ordine: % di curva decrescente (i piu' vicini alla graduation in cima), a parita' il valore tenuto dagli utenti fomo
for (const t of cand.sort((a, b) => b.curva - a.curva || b.valore_fomo - a.valore_fomo))
  console.log(JSON.stringify({ sym: t.sym, tok: t.tok, nell_app: t.nell_app, ore: t.ore, curva: Math.round(t.curva), mcap: Math.round(t.mcap), liq: Math.round(t.liq), holder_catena: t.holder_catena,
    holder_fomo: t.holder_fomo, valore_fomo: t.valore_fomo, ingressi: t.ingressi.slice(0, 8), entrati_entro_30pct: t.primi_presto, bravi_holder: t.bravi_holder, bravi_tesi: t.bravi_tesi, tesi: t.tesi.length,
    testi: [...new Set(t.tesi.filter(x => x.txt.length > 25).map(x => `${x.u}${bravo(x.uid) ? '*' : ''}: ${x.txt.slice(0, 140)}`))].slice(0, 3) }));
process.exit(0);
