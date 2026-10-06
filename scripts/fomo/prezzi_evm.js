// Prezzo e liquidita' di un token EVM (Robinhood, Ethereum, Base, BSC) in un istante, solo dalla catena.
// Il pool del token si ricava una volta dalla ricevuta di uno scambio fomo che lo tocca (le tx stanno
// in catena/evm/<id>.json) e resta in cache; poi se ne legge lo STATO con eth_call al blocco
// dell'istante (Alchemy e' archive): v2 getReserves, v3/Pancake v3 slot0+liquidity, v4
// PoolManager.extsload (slot0 e liquidity della pool). Per v3/v4 le riserve sono quelle virtuali
// (x = L/sqrtP, y = L*sqrtP): la profondita' vicino al prezzo, come se il pool fosse a tutto campo.
// Valuta contro -> dollari: stabili = 1; ETH/WETH/WBNB dal pool di riferimento della rete letto allo
// stesso blocco; un'altra valuta (es. SPCX su Robinhood) da un secondo pool della stessa ricevuta.
// Liquidita' = 2 x lato contante. Un pool il cui stato e' uguale a 7 giorni prima non scambia: scartato.
// Robinhood conserva anche il metodo dei log (punto senza rete): prezzo dall'ultimo evento Swap, letto
// con eth_getLogs sull'RPC pubblico (Alchemy gratuito li limita a 10 blocchi).
// Uso da riga di comando: node prezzi_evm.js prezzi/<file>.json   (riempie le voci EVM del file)
const fs = require('fs'); const path = require('path');
const { keccak_256 } = require('@noble/hashes/sha3');
const { DATI, rpc, leggi, scrivi } = require('./comune');
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// Swap di Uniswap v4 (PoolManager), della variante del pool ETH/USDG, di Uniswap v3 e di PancakeSwap v3:
// in tutti i primi due campi dei dati sono gli importi dei due lati
const SWAP = ['0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f', '0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237',
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67', '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83'];
// tipo di pool dall'evento Swap: v2 (Uniswap/Pancake v2, Aerodrome v2: getReserves), v3 (slot0+liquidity), v4
const TIPO = { '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': 'v2', '0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b': 'v2',
  [SWAP[2]]: 'v3', [SWAP[3]]: 'v3', [SWAP[0]]: 'v4' };
const INIT = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';   // Initialize del PoolManager v4
const NATIVO = '0x0000000000000000000000000000000000000000';
// per rete: PoolManager e PositionManager v4, nativo incartato, stabili, pool di riferimento del nativo
// (v3, token0/token1 e decimali verificati on-chain il 2026-10-04; PositionManager.poolManager() verificato)
const RETI = {
  4663: { pm: ['0x8366a39cc670b4001a1121b8f6a443a643e40951'], posm: null, wn: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
    stabili: ['0x5fc5360d0400a0fd4f2af552add042d716f1d168'], rif: null },   // USDG; il nativo dal pool ETH/USDG (log)
  1: { pm: ['0x000000000004444c5dc75cb358380d2e3de08a90'], posm: '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e', wn: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    stabili: ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0xdac17f958d2ee523a2206206994597c13d831ec7', '0x6b175474e89094c44da98b954eedeac495271d0f', '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d',
      '0x6c3ea9036406852006290770bedfcaba0e23a0e8', '0xdc035d45d973e3ec169d2276ddab16f1e407384f', '0x4c9edd5852cd905f086c759e8383e09bff1e68b3'],
    rif: { indirizzo: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', t0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', t1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', lato: 1, d0: 6, d1: 18 } },   // Uniswap v3 USDC/WETH 0,05%
  8453: { pm: ['0x498581ff718922c3f8e6a244956af099b2652b2b'], posm: '0x7c5f5a4bbd8fd63184577525326123b519429bdc', wn: '0x4200000000000000000000000000000000000006',
    stabili: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
      '0x820c137fa70c8691f0e44dc420a5e53c168921dc'],
    rif: { indirizzo: '0xd0b53d9277642d899df5c87a3966a349a798f224', t0: '0x4200000000000000000000000000000000000006', t1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', lato: 0, d0: 18, d1: 6 } },   // Uniswap v3 WETH/USDC 0,05%
  56: { pm: ['0x28e2ea090877bf75740558f6bfb36a5ffee9e9df'], posm: '0x7a4a5c919ae2541aed11041a1aeee68f1287f95b', wn: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    stabili: ['0x55d398326f99059ff775485246999027b3197955', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', '0xe9e7cea3dedca5984780bafc599bd69add087d56', '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d',
      '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409'],
    rif: { indirizzo: '0x36696169c63e42cd08ce11f5deebbcebae652050', t0: '0x55d398326f99059ff775485246999027b3197955', t1: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', lato: 1, d0: 18, d1: 18 } },   // PancakeSwap v3 USDT/WBNB 0,05%
};
// factory per trovare un pool quando le ricevute non ne mostrano (Relay consegna dal suo magazzino):
// getPair v2, getPool v3 per ogni commissione, Aerodrome solo pool volatili. Verificate on-chain il
// 2026-10-04: per WETH(WBNB)/USDC(USDT) restituiscono i pool di riferimento qui sopra o le coppie v2 note.
const FACTORY = {
  1: { v2: ['0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f'], v3: ['0x1f98431c8ad98523631ae4a59f267346ea31f984', '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865'] },   // Uniswap v2/v3, Pancake v3
  8453: { v2: ['0x8909dc15e40173ff4699343b6eb8132c65e18ec6'], v3: ['0x33128a8fc17869897dce68ed026d694621f6fdfd', '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865'], aero: '0x420dd381b31aef6683db6b902084cb0ffece40da' },
  56: { v2: ['0xca143ce32fe78f1f7019d7d551a6402fc5350c73', '0x8909dc15e40173ff4699343b6eb8132c65e18ec6'], v3: ['0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865', '0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7'] },   // Pancake e Uniswap
};
const noto = (rete, a) => a === NATIVO || a === RETI[rete].wn || RETI[rete].stabili.includes(a);
const hex = n => '0x' + Math.floor(n).toString(16);
const parole = d => d.slice(2).match(/.{64}/g).map(w => BigInt.asIntN(256, BigInt('0x' + w)));
const parola = (h, i) => BigInt('0x' + (h.slice(2 + 64 * i, 66 + 64 * i) || '0'));
const ind = w => '0x' + w.slice(-40);
const ab = x => x < 0n ? -x : x;
const vicino = (a, v) => v && ab(ab(a) - v) * 10n < v;   // entro il 10% (alcuni pool v4 trattengono una commissione)
const call = (rete, to, data, b = 'latest') => rpc(rete, 'eth_call', [{ to, data }, typeof b === 'number' ? hex(b) : b]);
const POOL = leggi('cache/pool_evm.json', {});   // metodo dei log, solo Robinhood: tok -> pool
// metodo dello stato, tutte le reti: '<rete>:<tok>' -> [pool...] | {nulla: ora} (si riprova dopo 7 giorni). File a parte: pool_evm.json lo
// riscrive per intero chi usa il metodo dei log (entrate.js) e le voci nuove andrebbero perse.
const PR = leggi('cache/pool_evm_reti.json', {});
const salvaPR = () => scrivi('cache/pool_evm_reti.json', PR);
const DEC = {};
async function decimali(tok, rete = 4663) {
  if (tok === NATIVO) return 18;
  const k = rete + ':' + tok;
  if (DEC[k] === undefined) DEC[k] = parseInt(await call(rete, tok, '0x313ce567').catch(() => '0x'), 16) || 18;
  return DEC[k];
}
const RIF = {};
// numero del blocco all'istante t: stima con la velocita' media, poi correzione sull'orario vero
async function blocco(t, rete = 4663, esatto = true) {
  if (!RIF[rete]) { const n1 = parseInt(await rpc(rete, 'eth_blockNumber', []), 16); const b1 = await rpc(rete, 'eth_getBlockByNumber', [hex(n1), false]);
    const b0 = await rpc(rete, 'eth_getBlockByNumber', [hex(n1 - 2e6), false]); RIF[rete] = { n1, t1: parseInt(b1.timestamp, 16), v: 2e6 / (parseInt(b1.timestamp, 16) - parseInt(b0.timestamp, 16)) }; }
  const r = RIF[rete]; if (t >= r.t1) return r.n1;
  let n = Math.max(1, Math.round(r.n1 - (r.t1 - t) * r.v));
  for (let k = 0; esatto && k < 4; k++) {
    const bt = await orario(n, rete); if (Math.abs(bt - t) <= 5) break;
    n = Math.max(1, n + Math.round((t - bt) * r.v));
  }
  return n;
}
const ORARI = {};
async function orario(n, rete = 4663) { const k = rete + ':' + n; if (ORARI[k] === undefined) ORARI[k] = parseInt((await rpc(rete, 'eth_getBlockByNumber', [hex(n), false])).timestamp, 16); return ORARI[k]; }

// ---- metodo dei log (Robinhood) ----
// pool del token e pool di riferimento ETH/USDG, dalla ricevuta di un acquisto fomo del token
async function pool(tok, txs) {
  tok = tok.toLowerCase();
  if (POOL[tok]) return POOL[tok];
  for (const tx of [].concat(txs).slice(0, 5)) { const p = await poolDa(tok, tx); if (p) return p; }
  POOL[tok] = null; scrivi('cache/pool_evm.json', POOL); return null;
}
async function poolDa(tok, tx) {
  const rc = await rpc(4663, 'eth_getTransactionReceipt', [tx]);
  const fuori = {};   // token in uscita/entrata per indirizzo (il PoolManager e' chi lo manda)
  const verso = {};
  for (const l of rc.logs) if (l.topics[0] === TRANSFER && l.address.toLowerCase() === tok && l.topics.length === 3) {
    const da = '0x' + l.topics[1].slice(26), a = '0x' + l.topics[2].slice(26), v = BigInt(l.data);
    fuori[da] = (fuori[da] || 0n) + v; verso[a] = (verso[a] || 0n) + v; }
  let p = null, eth = null;
  for (const l of rc.logs) {
    if (!SWAP.includes(l.topics[0])) continue;
    const [a0, a1] = parole(l.data);
    const dalPool = fuori[l.address.toLowerCase()] || 0n;
    const entra = verso[l.address.toLowerCase()] || 0n;   // il token puo' anche entrare nel pool (vendita)
    const tok1 = vicino(a1, dalPool) || vicino(a1, entra), tok0 = vicino(a0, dalPool) || vicino(a0, entra);
    if (tok0 || tok1) p = { indirizzo: l.address.toLowerCase(), topic: l.topics[0], id: l.topics[1], lato: tok1 ? 1 : 0 };
    else if (l.topics[0] === SWAP[1]) eth = { indirizzo: l.address.toLowerCase(), topic: l.topics[0], id: l.topics[1] };   // il pool di riferimento ETH/USDG
  }
  if (eth && !POOL._eth) { POOL._eth = eth; scrivi('cache/pool_evm.json', POOL); }
  if (p) { POOL[tok] = p; scrivi('cache/pool_evm.json', POOL); }
  return p;
}
// il prezzo in vigore all'istante t: l'ultimo Swap del pool prima di t (finestra crescente fino a
// 6 ore); se prima non c'e' niente, il primo dopo
async function primoSwap(p, t) {
  const b = await blocco(t);
  for (const span of [600, 6000, 36000, 216000]) {
    const logs = await rpc('rhpub', 'eth_getLogs', [{ address: p.indirizzo, topics: [p.topic, p.id], fromBlock: hex(Math.max(1, b - span)), toBlock: hex(b) }]);
    if (logs.length) return logs[logs.length - 1];
  }
  for (const span of [600, 6000, 36000]) {
    const logs = await rpc('rhpub', 'eth_getLogs', [{ address: p.indirizzo, topics: [p.topic, p.id], fromBlock: hex(b), toBlock: hex(b + span) }]);
    if (logs.length) return logs[0];
  }
  return null;
}
const CACHE_ETH = {};
async function ethUsd(t) {
  const k = Math.floor(t / 600); if (CACHE_ETH[k] !== undefined) return CACHE_ETH[k];
  return (CACHE_ETH[k] = await ethUsd1(t));
}
async function ethUsd1(t) {
  if (!POOL._eth) await poolDa('', '0xd619b1780d88190b46b2989739a9b9f62acb61473df2ae6c568dd83b8e336698');   // un acquisto fomo noto: contiene il pool ETH/USDG
  const e = POOL._eth; if (!e) return null;
  const l = await primoSwap(e, t); if (!l) return null;
  const [a0, a1] = parole(l.data); const ab = x => Number(x < 0n ? -x : x);
  return (ab(a1) / 1e6) / (ab(a0) / 1e18);   // currency0 = ETH, currency1 = USDG
}

// ---- metodo dello stato (tutte le reti) ----
// valute di una pool v4: PositionManager.poolKeys; su Robinhood l'evento Initialize (RPC pubblico,
// 10 milioni di blocchi per chiamata, all'indietro dalla ricevuta)
async function valuteV4(rete, pm, id, b) {
  const R = RETI[rete];
  if (R.posm) {
    const k = await call(rete, R.posm, '0x86b6be7d' + id.slice(2, 52).padEnd(64, '0')).catch(() => '0x');
    if (k.length >= 130 && parola(k, 3) !== 0n) return [ind(k.slice(2, 66)), ind(k.slice(66, 130))];   // tickSpacing 0: chiave assente
  }
  if (rete === 4663) for (let a = b; a > 0; a -= 1e7) {
    const lg = await rpc('rhpub', 'eth_getLogs', [{ address: pm, topics: [INIT, id], fromBlock: hex(Math.max(0, a - 1e7 + 1)), toBlock: hex(a) }]);
    if (lg.length) return [ind(lg[0].topics[2]), ind(lg[0].topics[3])];
  }
  return null;
}
const POOLTOK = {};
async function tokensV23(rete, a) {
  if (!POOLTOK[rete + a]) POOLTOK[rete + a] = [ind(await call(rete, a, '0x0dfe1681')), ind(await call(rete, a, '0xd21220a7'))];
  return POOLTOK[rete + a];
}
// i pool di un token in una ricevuta: v2/v3 se il token entra o esce dal pool; v4 se l'importo di un
// lato dello Swap combacia con quanto entra o esce dal PoolManager. Per ognuno: le due valute, il lato
// del token, la valuta contro.
async function poolsDi(rete, rc, tok) {
  const fuori = {}, verso = {}, mossi = [];   // per indirizzo: i singoli trasferimenti del token e il totale
  const somma = (o, k, v) => { const x = o[k] = o[k] || [0n]; x[0] += v; x.push(v); };
  for (const l of rc.logs) if (l.topics[0] === TRANSFER && l.topics.length === 3) {
    const da = ind(l.topics[1]), a = ind(l.topics[2]), v = BigInt(l.data === '0x' ? 0 : l.data), c = l.address.toLowerCase();
    if (c === tok) { somma(fuori, da, v); somma(verso, a, v); }
    else mossi.push({ c, da, a, v });
  }
  // un lato dello Swap combacia con un trasferimento del token da o verso il pool (o con il loro totale)
  const combacia = (x, a) => [...(fuori[a] || []), ...(verso[a] || [])].some(v => vicino(x, v));
  const out = [];
  for (const l of rc.logs) {
    const tipo = TIPO[l.topics[0]]; if (!tipo) continue;
    const a = l.address.toLowerCase();
    if (tipo !== 'v4') {
      if (!fuori[a] && !verso[a]) continue;
      const [t0, t1] = await tokensV23(rete, a).catch(() => [null, null]);
      if (t0 !== tok && t1 !== tok) continue;
      out.push({ tipo, indirizzo: a, t0, t1, lato: t0 === tok ? 0 : 1 }); continue;
    }
    const [a0, a1] = parole(l.data);
    const tok0 = combacia(a0, a), tok1 = !tok0 && combacia(a1, a);
    if (!tok0 && !tok1) continue;
    const id = l.topics[1];
    let v = await valuteV4(rete, a, id, parseInt(rc.blockNumber, 16)), dedotto;
    if (!v) {   // dedotte dalla ricevuta: l'altro lato e' il token che entra o esce dal PoolManager con lo stesso importo, se no il nativo
      const altro = tok0 ? a1 : a0;
      const m = mossi.find(x => (x.a === a || x.da === a) && vicino(altro, x.v));
      const c = m ? m.c : NATIVO; dedotto = m ? 'ricevuta' : 'nativo?';
      v = tok0 ? [tok, c] : [c, tok];
    }
    if (v[0] !== tok && v[1] !== tok) continue;
    out.push({ tipo, indirizzo: a, id, t0: v[0], t1: v[1], lato: v[0] === tok ? 0 : 1, ...(dedotto ? { dedotto } : {}) });
  }
  for (const p of out) { p.contro = p.lato === 0 ? p.t1 : p.t0; p.d0 = await decimali(p.t0, rete); p.d1 = await decimali(p.t1, rete); }
  return out;
}
// i pool del token col nativo incartato e con la prima stabile, dalle factory note della rete
async function dallaFactory(rete, tok) {
  const F = FACTORY[rete]; if (!F) return [];
  const a = x => x.slice(2).padStart(64, '0'), out = [];
  const trovato = async (tipo, q, data, f) => { const r = await call(rete, f, data).catch(() => '0x'); const p = r.length >= 66 ? ind(r.slice(0, 66)) : NATIVO;
    if (p !== NATIVO) { const [t0, t1] = tok < q ? [tok, q] : [q, tok]; out.push({ tipo, indirizzo: p, t0, t1, lato: t0 === tok ? 0 : 1, contro: q, d0: await decimali(t0, rete), d1: await decimali(t1, rete), fonte: 'factory' }); } };
  for (const q of [RETI[rete].wn, RETI[rete].stabili[0]]) {
    for (const f of F.v2) await trovato('v2', q, '0xe6a43905' + a(tok) + a(q), f);
    if (F.aero) await trovato('v2', q, '0x79bc57d5' + a(tok) + a(q) + a('0x0'), F.aero);
    for (const f of F.v3) for (const fee of [100, 500, 2500, 3000, 10000]) await trovato('v3', q, '0x1698ee82' + a(tok) + a(q) + fee.toString(16).padStart(64, '0'), f);
  }
  return out;
}
// pool del token (al massimo 3 ricevute con pool; se nessuna ne mostra, dalle factory), con la via verso il dollaro per le valute contro non note
async function poolsStato(rete, tok, txs) {
  tok = tok.toLowerCase(); const k = rete + ':' + tok, R = RETI[rete];
  if (tok === R.wn && R.rif) return [{ tipo: 'v3', ...R.rif, contro: R.rif.lato === 0 ? R.rif.t1 : R.rif.t0 }];   // il nativo incartato: il pool di riferimento
  if (Array.isArray(PR[k])) return PR[k];
  if (PR[k] && Date.now() / 1000 - PR[k].nulla < 7 * 86400) return null;   // non trovato da meno di una settimana
  const pools = {}; let viste = 0, errori = 0;
  for (const tx of [].concat(txs || []).slice(0, 10)) {
    const rc = await rpc(rete, 'eth_getTransactionReceipt', [tx]).catch(() => null); if (!rc) { errori++; continue; }
    const ps = await poolsDi(rete, rc, tok);
    for (const p of ps) {
      const pk = p.indirizzo + (p.id || ''); if (pools[pk]) continue;
      if (!noto(rete, p.contro)) {   // secondo pool: la valuta contro scambiata con una nota, nella stessa ricevuta
        const via = (await poolsDi(rete, rc, p.contro)).find(q => noto(rete, q.contro));
        if (!via) continue; p.via = via;
      }
      pools[pk] = p;
    }
    if (ps.length && ++viste >= 3) break;
  }
  if (!Object.keys(pools).length) for (const p of await dallaFactory(rete, tok)) pools[p.indirizzo] = p;
  if (!Object.keys(pools).length && errori) return null;   // ricevute non lette: si riprova la prossima volta
  PR[k] = Object.keys(pools).length ? Object.values(pools) : { nulla: Math.floor(Date.now() / 1000) }; salvaPR();
  return Array.isArray(PR[k]) ? PR[k] : null;
}
// stato di un pool a un blocco: prezzo del token0 in token1 e riserve (vere per v2, virtuali per v3/v4)
async function stato(rete, p, b) {
  let sq, L;
  if (p.tipo === 'v2') {
    const r = await call(rete, p.indirizzo, '0x0902f1ac', b).catch(() => '0x'); if (r.length < 130) return null;
    const r0 = Number(parola(r, 0)) / 10 ** p.d0, r1 = Number(parola(r, 1)) / 10 ** p.d1;
    return r0 && r1 ? { px: r1 / r0, r0, r1, k: r.slice(0, 130) } : null;
  }
  if (p.tipo === 'v3') {
    const s = await call(rete, p.indirizzo, '0x3850c7bd', b).catch(() => '0x'), l = await call(rete, p.indirizzo, '0x1a686502', b).catch(() => '0x');
    if (s.length < 66 || l.length < 66) return null; sq = parola(s, 0); L = parola(l, 0);
  } else {
    // pools[id] nel PoolManager: slot keccak(id, 6); slot0 li', liquidity tre slot dopo
    const slot = Buffer.from(keccak_256(Buffer.from(p.id.slice(2) + '6'.padStart(64, '0'), 'hex'))).toString('hex');
    const r = await call(rete, p.indirizzo, '0x35fd631a' + slot + '4'.padStart(64, '0'), b).catch(() => '0x');
    if (r.length < 2 + 64 * 6) return null;
    sq = parola(r, 2) & ((1n << 160n) - 1n); L = parola(r, 5) & ((1n << 128n) - 1n);
  }
  if (!sq || !L) return null;
  const s = Number(sq) / 2 ** 96, Ln = Number(L);
  return { px: s * s * 10 ** (p.d0 - p.d1), r0: Ln / s / 10 ** p.d0, r1: Ln * s / 10 ** p.d1, k: sq.toString() };
}
const saldo = async (rete, tok, chi, b) => Number(BigInt(await call(rete, tok, '0x70a08231' + chi.slice(2).padStart(64, '0'), b).catch(() => '0x0') || '0x0'));
// dollari per unita' di una valuta nota (o raggiungibile con la via) al blocco b
const CACHE_NAT = {};
async function nativoUsd(rete, b, t) {
  if (rete === 4663) return ethUsd(t);
  const k = rete + ':' + b; if (CACHE_NAT[k] !== undefined) return CACHE_NAT[k];
  const r = RETI[rete].rif, s = await stato(rete, { tipo: 'v3', ...r }, b);
  return (CACHE_NAT[k] = s ? (r.lato === 0 ? s.px : 1 / s.px) : null);
}
async function usd(rete, p, b, t) {
  if (RETI[rete].stabili.includes(p.contro)) return 1;
  if (p.contro === NATIVO || p.contro === RETI[rete].wn) return nativoUsd(rete, b, t);
  if (!p.via) return null;
  const s = await stato(rete, p.via, b); if (!s) return null;
  const u = await usd(rete, p.via, b, t); if (!u) return null;
  return (p.via.lato === 0 ? s.px : 1 / s.px) * u;
}
// {t, px, liq, liq_tot, pool, eth}: prezzo in dollari dal pool piu' profondo, liquidita' = 2 x lato
// contante; null se il pool non si trova o nessuno scambia da 7 giorni (stato uguale a 7 giorni prima)
async function valuta(tok, t, txs, rete) {
  const ps = await poolsStato(rete, tok, txs); if (!ps) return null;
  const b = await blocco(t, rete), b7 = await blocco(t - 7 * 86400, rete, false);
  const vivi = [];
  for (const p of ps) {
    const s = await stato(rete, p, b); if (!s) continue;
    const s7 = await stato(rete, p, b7); if (s7 && s7.k === s.k) continue;
    const u = await usd(rete, p, b, t); if (!u) continue;
    const px = (p.lato === 0 ? s.px : 1 / s.px) * u;
    // v2: riserve vere (2 x contante); v3: saldi veri dei due token nel pool; v4: 2 x contante virtuale
    let liq = 2 * (p.lato === 0 ? s.r1 : s.r0) * u;
    if (p.tipo === 'v3') { const [b0, b1] = [await saldo(rete, p.t0, p.indirizzo, b) / 10 ** p.d0, await saldo(rete, p.t1, p.indirizzo, b) / 10 ** p.d1];
      liq = p.lato === 0 ? b0 * px + b1 * u : b1 * px + b0 * u; }
    vivi.push({ px, liq });
  }
  if (!vivi.length) return null;
  const top = vivi.reduce((m, x) => x.liq > m.liq ? x : m);
  const nat = await nativoUsd(rete, b, t).catch(() => null);
  return { t: await orario(b, rete), px: top.px, liq: top.liq, liq_tot: vivi.reduce((a, x) => a + x.liq, 0), pool: vivi.length, eth: nat };
}
// {t, px, liq, liq_tot, eth}: prezzo del token in dollari all'istante t. Robinhood: prezzo dall'ultimo
// scambio del pool (metodo dei log, come sempre) e liquidita' dallo stato a quel blocco; le altre reti
// dallo stato. Il parametro rete e' facoltativo (default Robinhood).
// La valuta contro del pool viene dal metodo dello stato: prima si dava per scontato l'ETH, e i pool
// contro USDG (6 decimali) o contro un altro token uscivano con prezzi sbagliati di ordini di grandezza.
async function punto(tok, t, txs, rete = 4663) {
  if (rete !== 4663) return valuta(tok, t, txs, rete);
  const p = await pool(tok, txs); if (!p) return null;
  const l = await primoSwap(p, t); if (!l) return null;
  const [a0, a1] = parole(l.data); const ab = x => Number(x < 0n ? -x : x);
  const dt = await decimali(tok), blk = parseInt(l.blockNumber, 16);
  const [qTok, qContro] = p.lato === 1 ? [ab(a1), ab(a0)] : [ab(a0), ab(a1)];
  const e = await ethUsd(t); if (!e) return null;
  let q = null;
  try {
    tok = tok.toLowerCase(); const ps = (await poolsStato(4663, tok, txs)) || [];
    q = ps.find(x => x.indirizzo === p.indirizzo && (x.tipo !== 'v4' || x.id === p.id));
    if (!q && p.topic !== SWAP[1]) {   // pool non visto dal metodo dello stato: le sue valute dalla catena, e in cache
      const v = p.topic === SWAP[0] ? await valuteV4(4663, p.indirizzo, p.id, blk) : await tokensV23(4663, p.indirizzo);
      if (v && (v[0] === tok || v[1] === tok)) {
        q = { tipo: TIPO[p.topic], indirizzo: p.indirizzo, ...(p.topic === SWAP[0] ? { id: p.id } : {}), t0: v[0], t1: v[1], lato: v[0] === tok ? 0 : 1 };
        q.contro = q.lato === 0 ? q.t1 : q.t0; q.d0 = await decimali(q.t0, 4663); q.d1 = await decimali(q.t1, 4663);
        PR['4663:' + tok] = ps.concat(q); salvaPR();
      }
    }
  } catch (err) { /* resta l'ETH */ }
  const dc = q ? (q.lato === 0 ? q.d1 : q.d0) : 18, u = q ? await usd(4663, q, blk, t) : e;
  if (!u) return valuta(tok, t, txs, 4663).catch(() => null);   // contro senza prezzo: lo stato dei pool del token che lo hanno
  const x = { t: await orario(blk), px: (qContro / 10 ** dc) / (qTok / 10 ** dt) * u, eth: e };
  try { const v = await valuta(tok, x.t, txs, 4663); if (v) { x.liq = v.liq; x.liq_tot = v.liq_tot; } } catch (e) { /* liquidita' facoltativa */ }
  return x;
}
// transazioni note dei token '<rete>:<tok>' (insieme), da tutte le storie EVM: prima le consegne e i
// ritiri di Relay (scambi veri), poi le altre; al massimo 8 per tipo
function txDeiToken(voci) {
  const T = {}; const relay = c => /^0x(b92fe925|4cd00e38)/i.test(c || '');
  for (const g of fs.readdirSync(path.join(DATI, 'catena/evm'))) for (const r of (leggi('catena/evm/' + g).righe || [])) {
    const k = (r.rete || 4663) + ':' + (r.tok || '').toLowerCase(); if (!voci.has(k)) continue;
    const x = T[k] = T[k] || [[], []], l = x[relay(r.contro) ? 0 : 1]; if (l.length < 8 && !l.includes(r.tx)) l.push(r.tx);
  }
  return Object.fromEntries(Object.entries(T).map(([k, [a, b]]) => [k, a.concat(b)]));
}
module.exports = { punto, pool, valuta, txDeiToken, RETI };

// Da riga di comando: prezzo e liquidita' dalla catena dei token EVM di un file prezzi (le voci
// '<rete>:<tok>' presenti di cui qualcuno tiene almeno $50 al prezzo di fomo: il resto sono briciole).
// Il pool si cerca nelle transazioni del token in catena/evm (prima le consegne di Relay).
if (require.main === module) {
  (async () => {
    const f = process.argv[2]; if (!f) { console.error('uso: node prezzi_evm.js prezzi/<file>.json'); process.exit(1); }
    const P = leggi(f);
    const valore = {};
    for (const u of fs.readdirSync(path.join(DATI, 'utenti'))) for (const b of (leggi('utenti/' + u).bal || []))
      if (RETI[b.net] && b.tok && b.q) { const k = b.net + ':' + b.tok.toLowerCase(); valore[k] = Math.max(valore[k] || 0, b.q * (b.px || 0)); }
    const voci = new Set(Object.keys(P).map(k => k.toLowerCase()).filter(k => RETI[k.split(':')[0]] && (valore[k] || 0) >= 50));
    // transazioni dei token cercati, da tutte le storie EVM (le consegne di Relay prima)
    const TX = txDeiToken(voci);
    const ora = Math.floor(Date.now() / 1000); const lista = [...voci]; let n = 0; const conta = { ok: 0, morti: 0, senza_pool: 0, senza_tx: 0, errori: 0 };
    const lavora = async () => {
      for (let k; (k = lista.shift());) {
        const [rete, tok] = k.split(':');
        try {
          if (!TX[k]) conta.senza_tx++;   // nessuna ricevuta: restano le factory
          const x = await valuta(tok, ora, TX[k] || [], +rete);
          if (x && x.px) { P[k] = { px: x.px, liq: x.liq || 0, liq_tot: x.liq_tot || x.liq || 0, pool: x.pool, fonte: 'catena', ora: x.t }; conta.ok++; }
          else { P[k] = null; Array.isArray(PR[k]) ? conta.morti++ : conta.senza_pool++; }
        } catch (e) { conta.errori++; console.error('ERR', k, e.message.slice(0, 80)); }
        if (++n % 50 === 0) { console.log(n, '/', voci.size, JSON.stringify(conta)); scrivi(f, P); }
      }
    };
    await Promise.all([lavora(), lavora(), lavora(), lavora()]);
    scrivi(f, P); console.log(`${f}: ${voci.size} token EVM dalla catena`, JSON.stringify(conta));
  })();
}
