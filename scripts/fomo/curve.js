// A che punto della curva di bonding e' un token Solana, e a che capitalizzazione corrisponde ogni
// punto della curva, letto dalla catena (Helius: getMultipleAccounts, getProgramAccounts solo la
// prima volta per un pool Meteora DBC). Launchpad riconosciuti dal programma proprietario del conto:
//   pump.fun         6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P  curva ['bonding-curve', mint]
//   Meteora DBC      dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN  VirtualPool + PoolConfig (BAGS, Jupiter Studio, ... sono config DBC)
//   Raydium LaunchLab LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj  PoolState ['pool', mint, quote] (letsbonk, stonk.fun, ... sono piattaforme)
//   Moonit           MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG  CurveAccount ['token', mint]
// I tracciati dei conti vengono dagli IDL Anchor pubblicati sulla catena dai programmi stessi
// (conto 'anchor:idl'), scaricati una volta e tenuti in dati/fomo/curve/idl/.
//
// Due misure di avanzamento per ogni curva: `perc_token` (token venduti / token da vendere fino alla
// graduation) e `perc_quote` (contante raccolto / contante alla graduation). `percentuale_curva` e'
// quella che usa fomo (Mobula) per quel launchpad, verificata il 4/10 su 301 token in bonding:
// token venduti per pump.fun, contante raccolto per DBC e LaunchLab, token venduti su 800M per Moonit
// (dati/fomo/curve/curve.md).
//
// Modulo:  const { curve, tabella } = require('./curve');
//          const righe = await curve(['<mint>', ...]);   // una riga per mint, vedi `riga()` sotto
//          tabella(riga, [0, 25, 50, 75, 90, 100])       // percentuale -> capitalizzazione (quote e $)
// CLI:     node scripts/fomo/curve.js <mint>...          (stampa JSON; TABELLA=1 aggiunge le tabelle)
const fs = require('fs'); const path = require('path'); const zlib = require('zlib'); const crypto = require('crypto');
const { PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
const { DATI, rpc, leggi, scrivi } = require('./comune');

const PROG = {
  pump: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  dbc: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
  launchlab: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
  moonit: 'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG',
};
const NOME = { pump: 'pump.fun', dbc: 'Meteora DBC', launchlab: 'Raydium LaunchLab', moonit: 'Moonit' };
const WSOL = 'So11111111111111111111111111111111111111112';
const QUOTE = {   // contante delle curve: simbolo e decimali; i dollari valgono 1
  [WSOL]: ['SOL', 9], EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: ['USDC', 6],
  USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: ['USD1', 6], Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: ['USDT', 6],
  ondohH8Vssxiqcy5u6Efi4AYN17KZrzQtv2a91dnrgW: ['ONDO', 8],   // quote di stonk.fun: prezzo dalla catena (prezzi_catena.punto)
};
const DOLLARI = new Set(['USDC', 'USD1', 'USDT']);
const LL_QUOTE = [WSOL, 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'];
// prezzo del SOL: Orca Whirlpool SOL/USDC, sqrt_price all'offset 65, mint a/b agli offset 101/181
const WHIRL_SOL = 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE';
const PUMP_GLOBAL = '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf';
const Q64 = 2 ** 64, Q128 = 2 ** 128;
const CACHE = 'curve/cache.json';
const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds, new PublicKey(prog))[0].toBase58();
const pk = a => new PublicKey(a).toBuffer();

// ---- IDL Anchor dalla catena e decodifica borsh / bytemuck (stessa disposizione: i campi di
// padding sono espliciti nell'IDL) ----
const IDL = {};
async function idl(nome) {
  if (IDL[nome]) return IDL[nome];
  const f = path.join(DATI, 'curve/idl', nome + '.json');
  if (!fs.existsSync(f)) {
    const pid = new PublicKey(PROG[nome]); const [base] = PublicKey.findProgramAddressSync([], pid);
    const ind = (await PublicKey.createWithSeed(base, 'anchor:idl', pid)).toBase58();
    const a = await rpc('sol', 'getAccountInfo', [ind, { encoding: 'base64' }]);
    const b = Buffer.from(a.value.data[0], 'base64'); const n = b.readUInt32LE(40);
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, zlib.inflateSync(b.subarray(44, 44 + n)));
  }
  const j = JSON.parse(fs.readFileSync(f));
  const tipi = {}; for (const t of j.types || []) tipi[t.name] = t.type;
  for (const a of j.accounts || []) if (a.type) tipi[a.name] = a.type;   // IDL vecchio formato (Moonit)
  const disc = {}; for (const a of j.accounts || []) disc[a.name] = Buffer.from(a.discriminator || crypto.createHash('sha256').update('account:' + a.name).digest().subarray(0, 8));
  return (IDL[nome] = { tipi, disc });
}
// decodifica fino a dove arrivano i byte (le curve pump.fun vecchie sono piu' corte della struttura attuale)
function decodifica(I, nomeTipo, buf) {
  let o = 8; const fine = Symbol('fine');
  const leggiT = t => {
    if (typeof t === 'string') {
      const n = { bool: 1, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16, pubkey: 32, publicKey: 32 }[t];
      if (t === 'string') { if (o + 4 > buf.length) throw fine; const l = buf.readUInt32LE(o); o += 4; const s = buf.subarray(o, o + l).toString(); o += l; return s; }
      if (!n) throw new Error('tipo ' + t);
      if (o + n > buf.length) throw fine;
      const v = t === 'pubkey' || t === 'publicKey' ? new PublicKey(buf.subarray(o, o + 32)).toBase58()
        : t === 'bool' ? buf[o] === 1 : n === 1 ? buf[o] : n === 2 ? buf.readUInt16LE(o) : n === 4 ? buf.readUInt32LE(o)
        : n === 8 ? buf.readBigUInt64LE(o) : buf.readBigUInt64LE(o) + (buf.readBigUInt64LE(o + 8) << 64n);
      o += n; return v;
    }
    if (t.array) { const [e, n] = t.array; const r = []; for (let i = 0; i < n; i++) r.push(leggiT(e)); return r; }
    if (t.option) { if (o >= buf.length) throw fine; return buf[o++] ? leggiT(t.option) : null; }
    if (t.vec) { const l = buf.readUInt32LE(o); o += 4; const r = []; for (let i = 0; i < l; i++) r.push(leggiT(t.vec)); return r; }
    if (t.defined) return leggiDef(typeof t.defined === 'string' ? t.defined : t.defined.name);
    throw new Error('tipo ' + JSON.stringify(t));
  };
  const leggiDef = nome => {
    const d = I.tipi[nome]; if (!d) throw new Error('manca ' + nome);
    if (d.kind === 'enum') { if (o >= buf.length) throw fine; const v = d.variants[buf[o++]]; if (v.fields) leggiT({ array: [] }); return v.name; }
    const r = {}; for (const f of d.fields) { try { r[f.name] = leggiT(f.type); } catch (e) { if (e === fine) { r._corto = true; return r; } throw e; } }
    return r;
  };
  try { return leggiDef(nomeTipo); } catch (e) { if (e === fine) return { _corto: true }; throw e; }
}
// DBC ha conti piu' nuovi del suo IDL sulla catena (v0.1.10): i pool e le config "con transfer hook"
// (InitializeVirtualPoolWithToken2022TransferHook) hanno un altro discriminatore ma la stessa disposizione
// in testa (VirtualPool 424 byte; config 1128 byte, i primi 1048 come PoolConfig). Visto su
// pool An7HeR3pkynxc14jTX9YMBaKoCy3ewbGi5vJ3EnYPQFg, config 9qn9LwUaMABBuH9PtZXk6dWNMWxRqETFQUtGE4ZaxgMc.
const DISC_NUOVI = { VirtualPool: ['eddbb8172abda923'], PoolConfig: ['28dcc2fb29c77bfd'] };
async function conto(nome, tipo, b64) {
  const I = await idl(nome); const b = Buffer.from(b64, 'base64'); const dh = b.subarray(0, 8).toString('hex');
  if (!b.subarray(0, 8).equals(I.disc[tipo]) && !(nome === 'dbc' && (DISC_NUOVI[tipo] || []).includes(dh))) return null;
  return decodifica(I, tipo, b);
}
const N = x => (x == null ? null : Number(x));
const mintInfo = b64 => { const b = Buffer.from(b64, 'base64'); return { supply: Number(b.readBigUInt64LE(36)), dec: b[44] }; };

// ---- modelli di curva: dal contante raccolto Q (unita' grezze) al prezzo grezzo e ai token venduti ----
// pump.fun e Moonit: prodotto costante con riserve virtuali (vt0, vq0), fino a `realTok` token venduti
function modelloCP(vt0, vq0, realTok) {
  const k = vt0 * vq0;
  return { qFine: k / (vt0 - realTok) - vq0, baseFine: realTok,
    aQ: Q => ({ prezzo: (vq0 + Q) ** 2 / k, base: vt0 - k / (vq0 + Q) }) };
}
// Meteora DBC: liquidita' concentrata a tratti, sqrt_price Q64.64 da sqrt_start_price ai 20 punti della config
function tratti(cfg) {
  const t = []; let giu = N(cfg.sqrt_start_price), q = 0, b = 0;
  for (const p of cfg.curve) {
    const su = N(p.sqrt_price), L = N(p.liquidity); if (!su || !L || su <= giu) break;
    const dq = L * (su - giu) / Q128, db = L * (su - giu) / (giu * su);
    t.push({ giu, su, L, q0: q, b0: b }); q += dq; b += db; giu = su;
  }
  return t;
}
function modelloDBC(cfg) {
  const T = tratti(cfg); const sMig = N(cfg.migration_sqrt_price);
  const aSqrt = s => { let q = 0, b = 0; for (const x of T) { if (s <= x.giu) break; const su = Math.min(s, x.su); q = x.q0 + x.L * (su - x.giu) / Q128; b = x.b0 + x.L * (su - x.giu) / (x.giu * su); } return { q, b }; };
  const fine = aSqrt(sMig);
  return { qFine: N(cfg.migration_quote_threshold), qFineCurva: fine.q, baseFine: fine.b, aSqrt,
    aQ: Q => { let x = T[0]; for (const y of T) if (Q >= y.q0) x = y; const s = x.giu + (Q - x.q0) * Q128 / x.L; return { prezzo: (s / Q64) ** 2, base: aSqrt(s).b, sqrt: s }; } };
}
// Raydium LaunchLab, curva a prodotto costante (curve_type 0): (vb - venduti)(vq + Q) = vb*vq
function modelloLL(p) {
  const vb = N(p.virtual_base), vq = N(p.virtual_quote), k = vb * vq;
  return { qFine: N(p.total_quote_fund_raising), baseFine: N(p.total_base_sell), aQ: Q => ({ prezzo: (vq + Q) ** 2 / k, base: vb - k / (vq + Q) }) };
}

// ---- cache: pool per mint (non cambia), config/piattaforme (non cambiano) ----
let C = null;
const cache = () => (C = C || leggi(CACHE, { pool: {}, cfg: {}, nomi: {} }));
const salva = () => scrivi(CACHE, C);
const mgma = async ind => { const r = []; for (let i = 0; i < ind.length; i += 100) r.push(...(await rpc('sol', 'getMultipleAccounts', [ind.slice(i, i + 100), { encoding: 'base64' }])).value); return r; };
let chiamate = 0;
const conta = async (f, ...a) => { const r = await f(...a); chiamate += Math.ceil((a[0].length || 1) / 100); return r; };

// trova il pool di ogni mint: un getMultipleAccounts con i PDA di pump, LaunchLab e Moonit; per chi
// non c'e', un getProgramAccounts su DBC filtrato per base_mint (offset 136 del VirtualPool) e poi su LaunchLab
async function trova(mints) {
  const c = cache(); const da = mints.filter(m => !c.pool[m]); if (!da.length) return;
  const cand = da.map(m => [
    ['pump', pda([Buffer.from('bonding-curve'), pk(m)], PROG.pump)],
    ...LL_QUOTE.map(q => ['launchlab', pda([Buffer.from('pool'), pk(m), pk(q)], PROG.launchlab)]),
    ['moonit', pda([Buffer.from('token'), pk(m)], PROG.moonit)]]);
  const v = await conta(mgma, cand.flat().map(x => x[1]));
  let i = 0;
  for (let k = 0; k < da.length; k++) for (const [lp, ind] of cand[k]) { const a = v[i++]; if (a && a.owner === PROG[lp] && !c.pool[da[k]]) c.pool[da[k]] = { lp, pool: ind }; }
  for (const m of da.filter(m => !c.pool[m])) {
    // per dimensione (424 byte) e non per discriminatore: i pool nuovi ne hanno un altro (DISC_NUOVI)
    const r = await rpc('sol', 'getProgramAccounts', [PROG.dbc, { encoding: 'base64', dataSlice: { offset: 0, length: 0 },
      filters: [{ dataSize: 424 }, { memcmp: { offset: 136, bytes: m } }] }]); chiamate++;
    if (r.length) { c.pool[m] = { lp: 'dbc', pool: r[0].pubkey }; continue; }
    // LaunchLab con una quote diversa da SOL/USD1/USDC (es. stonk.fun): base_mint all'offset 205 del PoolState
    const l = await rpc('sol', 'getProgramAccounts', [PROG.launchlab, { encoding: 'base64', dataSlice: { offset: 0, length: 0 },
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode((await idl('launchlab')).disc.PoolState) } }, { memcmp: { offset: 205, bytes: m } }] }]); chiamate++;
    if (l.length) c.pool[m] = { lp: 'launchlab', pool: l[0].pubkey };
    else c.pool[m] = { lp: null, pool: null, visto: Math.floor(Date.now() / 1000) };   // nessuna curva nota (si riprova dopo un giorno)
  }
  salva();
}

// legge config DBC, global config / piattaforma LaunchLab, metadati del partner DBC (una volta sola)
async function configurazioni(stati) {
  const c = cache(); const serve = new Set();
  for (const s of stati) {
    if (s.lp === 'dbc' && !c.cfg[s.d.config]) serve.add(s.d.config);
    if (s.lp === 'launchlab') { if (!c.cfg[s.d.global_config]) serve.add(s.d.global_config); if (!c.cfg[s.d.platform_config]) serve.add(s.d.platform_config); }
    if (s.lp === 'pump' && !c.cfg[PUMP_GLOBAL]) serve.add(PUMP_GLOBAL);
  }
  if (!serve.size) return;
  const ind = [...serve]; const v = await conta(mgma, ind); const meta = [];
  for (let i = 0; i < ind.length; i++) {
    const a = v[i]; if (!a) continue; let d;
    if (a.owner === PROG.dbc && (d = await conto('dbc', 'PoolConfig', a.data[0]))) {
      const cfg = { tipo: 'dbc', quote_mint: d.quote_mint, fee_claimer: d.fee_claimer, token_decimal: d.token_decimal, migration_quote_threshold: N(d.migration_quote_threshold),
        migration_base_threshold: N(d.migration_base_threshold), swap_base_amount: N(d.swap_base_amount), migration_sqrt_price: String(d.migration_sqrt_price), sqrt_start_price: String(d.sqrt_start_price),
        migration_option: d.migration_option, fixed_token_supply_flag: d.fixed_token_supply_flag, pre_migration_token_supply: N(d.pre_migration_token_supply), post_migration_token_supply: N(d.post_migration_token_supply),
        curve: d.curve.filter(p => p.liquidity > 0n).map(p => ({ sqrt_price: String(p.sqrt_price), liquidity: String(p.liquidity) })) };
      c.cfg[ind[i]] = cfg; meta.push([ind[i], d.fee_claimer]);
    } else if (a.owner === PROG.launchlab && (d = await conto('launchlab', 'GlobalConfig', a.data[0]))) {
      c.cfg[ind[i]] = { tipo: 'll-global', curve_type: d.curve_type, quote_mint: d.quote_mint, index: d.index };
    } else if (a.owner === PROG.launchlab && (d = await conto('launchlab', 'PlatformConfig', a.data[0]))) {
      const s = x => Buffer.from(x).toString().replace(/\0+$/, '');
      c.cfg[ind[i]] = { tipo: 'll-piattaforma', nome: s(d.name), web: s(d.web), fee_wallet: d.platform_fee_wallet };
    } else if (a.owner === PROG.pump && (d = await conto('pump', 'Global', a.data[0]))) {
      c.cfg[ind[i]] = { tipo: 'pump-global', vt0: N(d.initial_virtual_token_reserves), vq0: N(d.initial_virtual_sol_reserves), real0: N(d.initial_real_token_reserves), supply: N(d.token_total_supply) };
    }
  }
  // nome del partner DBC dal suo PartnerMetadata ['partner_metadata', fee_claimer], se l'ha creato
  if (meta.length) {
    const mi = meta.map(([, f]) => pda([Buffer.from('partner_metadata'), pk(f)], PROG.dbc)); const mv = await conta(mgma, mi);
    for (let i = 0; i < meta.length; i++) {
      const d = mv[i] && await conto('dbc', 'PartnerMetadata', mv[i].data[0]);
      c.cfg[meta[i][0]].partner = d ? { nome: d.name, sito: d.website } : null;
    }
  }
  salva();
}

const PX_QUOTE = {};
const quoteDi = s => !s.d ? null : s.lp === 'pump' ? (s.d.quote_mint && s.d.quote_mint !== '11111111111111111111111111111111' ? s.d.quote_mint : WSOL)
  : s.lp === 'dbc' ? (cache().cfg[s.d.config] || {}).quote_mint : s.lp === 'launchlab' ? s.d.quote_mint : WSOL;
async function solUsd() {
  const [a] = await conta(mgma, [WHIRL_SOL]); const b = Buffer.from(a.data[0], 'base64');
  const s = Number(b.readBigUInt64LE(65) + (b.readBigUInt64LE(73) << 64n)) / Q64;
  const ma = new PublicKey(b.subarray(101, 133)).toBase58();
  if (ma !== WSOL) throw new Error('whirlpool SOL/USDC inatteso');
  return s * s * 1e3;
}

// una riga per mint:
// { mint, launchpad, programma, pool, config, piattaforma, quote, quote_dec, perc_token, perc_quote,
//   percentuale_curva, quote_raccolta, soglia_graduation_quote, prezzo_quote, mcap_quote, mcap_usd,
//   mcap_graduation_quote, mcap_graduation_usd, multiplo_graduation, graduato, supply, sol_usd, modello }
// `modello` serve a `tabella()`; quote e mcap in unita' della quote (SOL o dollari), non grezze.
async function curve(mints, { solUsd: sol } = {}) {
  mints = [...new Set(mints)]; const c = cache();
  // i mint senza curva trovata si riprovano dopo un giorno
  const ora = Math.floor(Date.now() / 1000);
  for (const m of mints) if (c.pool[m] && !c.pool[m].lp && ora - (c.pool[m].visto || 0) > 86400) delete c.pool[m];
  await trova(mints);
  const ind = []; for (const m of mints) { if (c.pool[m].pool) ind.push(c.pool[m].pool); ind.push(m); }
  ind.push(WHIRL_SOL);
  const v = await conta(mgma, ind); const per = {}; ind.forEach((x, i) => { per[x] = v[i]; });
  const b = Buffer.from(per[WHIRL_SOL].data[0], 'base64');
  const sq = Number(b.readBigUInt64LE(65) + (b.readBigUInt64LE(73) << 64n)) / Q64; sol = sol || sq * sq * 1e3;
  const stati = [];
  for (const m of mints) {
    const { lp, pool } = c.pool[m]; const a = pool && per[pool]; let d = null;
    if (a) d = await conto(lp, { pump: 'BondingCurve', dbc: 'VirtualPool', launchlab: 'PoolState', moonit: 'CurveAccount' }[lp], a.data[0]);
    stati.push({ m, lp, pool, a, d, mi: per[m] && mintInfo(per[m].data[0]) });
  }
  await configurazioni(stati.filter(s => s.d));
  // quote che non sono SOL ne' dollari (ONDO su stonk.fun, ...): decimali dal mint, prezzo dalle ultime
  // transazioni del mint (prezzi_catena.punto, 1-2 chiamate Helius per quote e per esecuzione)
  const altre = [...new Set(stati.map(quoteDi).filter(q => q && (!QUOTE[q] || !DOLLARI.has(QUOTE[q][0]) && QUOTE[q][0] !== 'SOL')))];
  const ignote = altre.filter(q => !QUOTE[q]);
  if (ignote.length) (await conta(mgma, ignote)).forEach((a, i) => { if (a) QUOTE[ignote[i]] = [ignote[i].slice(0, 6), mintInfo(a.data[0]).dec]; });
  for (const q of altre) if (PX_QUOTE[q] == null) {
    try { const p = await require('./prezzi_catena').punto(q, ora, 20, 'desc'); chiamate += 2; PX_QUOTE[q] = p && p.px; } catch (e) { PX_QUOTE[q] = null; }
  }
  return stati.map(s => riga(s, sol));
}

function riga({ m, lp, pool, a, d, mi }, sol) {
  const c = cache();
  const r = { mint: m, launchpad: lp ? NOME[lp] : null, programma: lp ? PROG[lp] : null, pool, config: null, piattaforma: null, sol_usd: +sol.toFixed(3) };
  if (!lp) return { ...r, nota: 'nessuna curva pump.fun / DBC / LaunchLab / Moonit per questo mint' };
  if (!d) return { ...r, graduato: lp === 'moonit' ? true : null, nota: lp === 'moonit' ? 'curva chiusa (migrata)' : 'conto del pool illeggibile' };
  let migrato = false, mod, Q, vend, quoteMint, bdec = mi ? mi.dec : 6, supply = mi ? mi.supply : null, grad, prezzo;
  if (lp === 'pump') {
    const g = c.cfg[PUMP_GLOBAL];
    quoteMint = d.quote_mint && d.quote_mint !== '11111111111111111111111111111111' ? d.quote_mint : WSOL;
    // le riserve virtuali iniziali si ricavano dalla curva stessa (k = vt*vq, vt0 = vt + venduti): vale anche
    // per le curve con quote diversa da SOL (PUMP, SPCX, ...), che il global non descrive
    // token reali iniziali: offerta della curva meno la riserva che va al pool (206,9M sul global)
    const real0 = d.token_total_supply ? N(d.token_total_supply) - (g.supply - g.real0) : g.real0;
    const vt = N(d.virtual_token_reserves), vq = N(d.virtual_quote_reserves); vend = real0 - N(d.real_token_reserves);
    const vt0 = vt + vend; mod = modelloCP(vt0, vt * vq / vt0, real0); r.config = PUMP_GLOBAL;
    Q = N(d.real_quote_reserves); prezzo = vq / vt; grad = d.complete; migrato = d.complete;
    // "mayhem mode" (is_mayhem_mode): un miliardo di token in piu' per l'agente di pump.fun. 56 curve mayhem su
    // 62 viste il 4/10 sono fuori dal modello: token reali fino a 1.793,1M e SOL virtuali quasi a zero (es.
    // 2Vhb2dxM8NsAFeJhTMgf5LokcWcH2uh8D1qX4CwFpump: 0,04 SOL). Il prezzo resta quello della curva, le
    // percentuali non hanno senso: fomo le mostra comunque (98,6% per quel token)
    r.mayhem = !!d.is_mayhem_mode;
    if (vend < 0 || (quoteMint === WSOL && Math.abs(vt * vq / (g.vt0 * g.vq0) - 1) > 0.2)) r.nota = 'curva anomala' + (r.mayhem ? ' (mayhem mode)' : '') + ': riserve fuori dal modello pump.fun';
    supply = N(d.token_total_supply) || supply;
  } else if (lp === 'dbc') {
    const g = c.cfg[d.config]; r.config = d.config; quoteMint = g.quote_mint; bdec = g.token_decimal;
    r.piattaforma = g.partner ? g.partner.nome : null; r.partner = g.fee_claimer;
    mod = modelloDBC({ ...g, curve: g.curve });
    Q = N(d.quote_reserve); const s = N(d.sqrt_price); prezzo = (s / Q64) ** 2; vend = mod.aSqrt(s).b;
    grad = d.is_migrated === 1 || Q >= g.migration_quote_threshold;
    migrato = d.is_migrated === 1;
  } else if (lp === 'launchlab') {
    const g = c.cfg[d.global_config], p = c.cfg[d.platform_config]; r.config = d.platform_config; r.global_config = d.global_config;
    r.piattaforma = p ? p.nome : null; r.sito = p ? p.web : null; quoteMint = d.quote_mint; bdec = d.base_decimals;
    if (g && g.curve_type !== 0) r.nota = 'curva LaunchLab di tipo ' + g.curve_type + ' (solo il tipo 0, prodotto costante, e\' modellato)';
    mod = modelloLL(d); Q = N(d.real_quote); vend = N(d.real_base); prezzo = mod.aQ(Q).prezzo; grad = d.status >= 1; migrato = d.status === 2; supply = N(d.supply) || supply;
  } else if (lp === 'moonit') {
    // prodotto costante con le stesse riserve virtuali di pump.fun (1.073M token, 30 SOL), verificato su
    // 6r3pKypcRBUvcUdCDNYya4bBmZbsUob1waSe8NN7moon; graduation quando la capitalizzazione arriva a marketcapThreshold
    quoteMint = WSOL; bdec = d.decimals; supply = N(d.totalSupply);
    const u = 10 ** bdec, vt0 = 1073e6 * u, vq0 = 30e9, k = vt0 * vq0, thr = N(d.marketcapThreshold);
    const vtFine = Math.sqrt(k * supply / thr); // mcap = (vq/vt)*supply = k*supply/vt^2
    mod = modelloCP(vt0, vq0, vt0 - vtFine);
    vend = supply - N(d.curveAmount); Q = mod.aQ(0) && (k / (vt0 - vend) - vq0); prezzo = mod.aQ(Q).prezzo; grad = false;
    r.config = 'marketcapThreshold ' + thr / 1e9 + ' SOL, curveType ' + d.curveType;
    // fomo (Mobula) conta i token venduti su 800M (l'80% dell'offerta): 93,55% contro 93,57% su questo token
    r.perc_token_su_800M = Math.min(100, +(100 * vend / (0.8 * supply)).toFixed(2));
  }
  const [qs, qd] = lp === 'launchlab' ? [(QUOTE[quoteMint] || [quoteMint])[0], d.quote_decimals] : QUOTE[quoteMint] || [quoteMint, 9];
  const qu = 10 ** qd, scala = 10 ** (bdec - qd), usd = qs === 'SOL' ? sol : DOLLARI.has(qs) ? 1 : PX_QUOTE[quoteMint];
  if (usd == null) r.nota = (r.nota ? r.nota + '; ' : '') + 'prezzo della quote ' + qs + ' non trovato: mcap_usd nullo';
  else if (qs !== 'SOL' && !DOLLARI.has(qs)) r.quote_usd = +usd.toFixed(6);
  const supplyUi = supply / 10 ** bdec;
  const mcapQ = prezzo * scala * supplyUi, fine = mod.aQ(mod.qFine), mcapFine = fine.prezzo * scala * supplyUi;
  const pt = Math.max(0, Math.min(100, 100 * vend / mod.baseFine)), pq = Math.max(0, Math.min(100, 100 * Q / mod.qFine));
  // dopo la migrazione il conto della curva non da' piu' il prezzo (il token scambia sul pool di destinazione)
  if (migrato) return { ...r, quote: qs, quote_dec: qd, base_dec: bdec, supply: supplyUi, perc_token: 100, perc_quote: 100, percentuale_curva: 100,
    soglia_graduation_quote: +(mod.qFine / qu).toFixed(4), prezzo_quote: null, mcap_quote: null, mcap_usd: null,
    mcap_graduation_quote: +mcapFine.toFixed(4), mcap_graduation_usd: usd == null ? null : +(mcapFine * usd).toFixed(2), multiplo_graduation: null,
    graduato: true, migrato: true, nota: [r.nota, 'migrato: il prezzo e\' sul pool di destinazione'].filter(Boolean).join('; '),
    modello: { lp, qFine: mod.qFine, baseFine: mod.baseFine, scala, supplyUi, qu, usd, base: lp === 'pump' || lp === 'moonit' ? 'token' : 'quote', _m: mod } };
  return { ...r, quote: qs, quote_dec: qd, base_dec: bdec, supply: supplyUi,
    perc_token: +pt.toFixed(2), perc_quote: +pq.toFixed(2),
    percentuale_curva: lp === 'moonit' ? r.perc_token_su_800M : +(lp === 'pump' ? pt : pq).toFixed(2),
    quote_raccolta: +(Q / qu).toFixed(4), soglia_graduation_quote: +(mod.qFine / qu).toFixed(4),
    prezzo_quote: prezzo * scala, mcap_quote: +mcapQ.toFixed(4), mcap_usd: usd == null ? null : +(mcapQ * usd).toFixed(2),
    mcap_graduation_quote: +mcapFine.toFixed(4), mcap_graduation_usd: usd == null ? null : +(mcapFine * usd).toFixed(2),
    multiplo_graduation: +(mcapFine / mcapQ).toFixed(3), graduato: !!grad, migrato: false,
    modello: { lp, qFine: mod.qFine, baseFine: mod.baseFine, scala, supplyUi, qu, usd, base: lp === 'pump' || lp === 'moonit' ? 'token' : 'quote', _m: mod } };
}

// percentuale della curva -> capitalizzazione, sulla misura che usa fomo per quel launchpad
// (token venduti per pump.fun e Moonit, contante raccolto per DBC e LaunchLab)
function tabella(r, punti = [0, 25, 50, 75, 90, 100]) {
  const M = r.modello; if (!M) return null; const mod = M._m;
  // per i token venduti si cerca Q per bisezione (la curva e' monotona)
  const qDaBase = b => { let lo = 0, hi = mod.qFine; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (mod.aQ(mid).base < b) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const m0 = mod.aQ(0).prezzo * M.scala * M.supplyUi;
  return punti.map(p => {
    const Q = M.base === 'token' ? qDaBase(p / 100 * M.baseFine) : p / 100 * M.qFine;
    const mc = mod.aQ(Q).prezzo * M.scala * M.supplyUi;
    return { perc: p, quote_raccolta: +(Q / M.qu).toFixed(3), mcap_quote: +mc.toFixed(3), mcap_usd: M.usd == null ? null : Math.round(mc * M.usd), multiplo_da_0: m0 > 0 ? +(mc / m0).toFixed(2) : null };
  });
}
const pulisci = r => { const { modello, ...x } = r; return x; };

module.exports = { curve, tabella, pulisci, solUsd, PROG, chiamate: () => chiamate };

if (require.main === module) {
  (async () => {
    const mints = process.argv.slice(2); if (!mints.length) { console.error('uso: node scripts/fomo/curve.js <mint>...'); process.exit(1); }
    const righe = await curve(mints);
    for (const r of righe) console.log(JSON.stringify({ ...pulisci(r), ...(process.env.TABELLA ? { tabella: tabella(r) } : {}) }));
    console.error(`chiamate RPC: ${chiamate}`);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
