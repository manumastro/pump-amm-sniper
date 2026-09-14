#!/usr/bin/env node
// Verifica la matematica di src/services/stonk/curva.ts contro pool vere.
// Tre invarianti: il prodotto costante regge, il rapporto bersaglio/virtual_quote e 2,8333,
// e comprando esattamente il bersaglio si consumano esattamente i token da vendere.

require('dotenv').config();
const bs58 = require('bs58');
const c = require('../dist/services/stonk/curva.js');

const encode = bs58.default ? bs58.default.encode : bs58.encode;
const b58 = (b) => encode(b);

async function rpc(metodo, params) {
  const url = process.env.SVS_INDEX_RPC || process.env.SVS_UNSTAKED_RPC;
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metodo, params }),
    signal: AbortSignal.timeout(120000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

(async () => {
  const pool = [];
  for (const plat of Object.keys(c.PIATTAFORME)) {
    const res = await rpc('getProgramAccounts', [c.LAUNCHLAB_PROGRAM, {
      encoding: 'base64',
      filters: [{ dataSize: c.POOL_STATE_BYTES }, { memcmp: { offset: 173, bytes: plat } }],
    }]);
    for (const a of res) pool.push(Buffer.from(a.account.data[0], 'base64'));
  }
  console.log('pool lette on-chain:', pool.length);

  let letti = 0, kOk = 0, rapportoOk = 0, venditaOk = 0;
  let kPeggio = 0, rapPeggio = 0, vendPeggio = 0;
  const decimali = {};
  for (const buf of pool) {
    const s = c.leggiPoolState(buf, b58);
    if (!s) continue;
    letti += 1;
    decimali[s.quoteDecimali] = (decimali[s.quoteDecimali] || 0) + 1;

    // 1. prodotto costante: (vBase - rBase) * (vQuote + rQuote) == vBase * vQuote
    const k = s.virtualBase * s.virtualQuote;
    const kOra = (s.virtualBase - s.realBase) * (s.virtualQuote + s.realQuote);
    // tolleranza 1e-4: la curva on-chain lavora in interi, e sui quote a 6 e 8 decimali
    // l'arrotondamento lascia uno scarto di qualche milionesimo. Non e' un invariante rotto.
    const errK = Math.abs(kOra / k - 1);
    if (errK < 1e-4) kOk += 1; else kPeggio = Math.max(kPeggio, errK);

    // 2. rapporto costante
    const errR = Math.abs(s.bersaglio / s.virtualQuote / c.RAPPORTO_BERSAGLIO - 1);
    if (errR < 1e-4) rapportoOk += 1; else rapPeggio = Math.max(rapPeggio, errR);

    // 3. comprando tutto il bersaglio dal fondo si consuma esattamente totaleDaVendere
    const vuota = { ...s, realBase: 0, realQuote: 0 };
    const errV = Math.abs(c.tokenPerQuote(vuota, s.bersaglio) / s.totaleDaVendere - 1);
    if (errV < 1e-4) venditaOk += 1; else vendPeggio = Math.max(vendPeggio, errV);
  }

  const riga = (nome, ok) => console.log(
    '  ' + nome.padEnd(42) + String(ok).padStart(6) + ' / ' + letti +
    (ok === letti ? '   ok' : `   ${letti - ok} fuori`));
  console.log('pool riconosciute come stonk:', letti);
  console.log('decimali del quote:', JSON.stringify(decimali));
  console.log('\ninvarianti:');
  riga('prodotto costante sulle riserve virtuali', kOk);
  riga('bersaglio / virtual_quote = 2,8333', rapportoOk);
  riga('bersaglio comprato = totale da vendere', venditaOk);
  if (kPeggio) console.log('  errore peggiore sul prodotto:', kPeggio.toExponential(2));
  if (rapPeggio) console.log('  errore peggiore sul rapporto:', rapPeggio.toExponential(2));
  if (vendPeggio) console.log('  errore peggiore sulla vendita:', vendPeggio.toExponential(2));

  console.log('\nsalita totale della curva:', c.SALITA_TOTALE.toFixed(3) + 'x');
  console.log('moltiplicatore 1,5% -> 7,8% (lo schema di FiFawHqx):',
    c.moltiplicatore(0.015, 0.078).toFixed(3) + 'x');
})();
