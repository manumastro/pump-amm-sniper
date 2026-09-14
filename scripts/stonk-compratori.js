#!/usr/bin/env node
/**
 * Chi compra, quanto mette e su quale curva: ogni singolo scambio di stonk.fun, dal vivo.
 *
 * Non deduce niente dallo stato della pool. LaunchLab emette un evento su ogni scambio
 * (`Program data:` dopo BuyExactIn/SellExactIn) che contiene la pool, le riserve prima e dopo,
 * l'importo e le commissioni. Quell'evento arriva gia' dentro `logsSubscribe`, quindi la
 * dimensione di ogni acquisto si legge a costo zero: nessuna chiamata, nessun polling.
 *
 * L'unica cosa che l'evento NON contiene e' il portafoglio, che sta nella transazione. Per
 * questo il nome del compratore si chiede solo sopra `STONK_COMPRA_MINIMA`: sotto quella
 * soglia contiamo e basta.
 *
 * Struttura dell'evento (147 byte), ricavata confrontandola coi saldi di transazioni vere:
 *
 *     0   discriminante bddb7fd34ee661ee
 *     8   pool_state (32 byte)
 *    40   total_base_sell        48   virtual_base        56   virtual_quote
 *    64   real_base prima        72   real_quote prima
 *    80   real_base dopo         88   real_quote dopo
 *    96   amount_in             104   amount_out
 *   112   commissione protocollo   120  commissione piattaforma
 *
 * La direzione si legge dalle riserve (se il quote entra e' una compra), non dai byte di coda:
 * e' l'unico modo che non dipende da come Raydium ordina i suoi enum.
 *
 * Gli importi sono in unita' del quote, che cambia da token a token (21 asset diversi, da 4 a
 * 12 decimali): l'unica misura confrontabile e' la **quota del bersaglio**, e il bersaglio si
 * ricava dall'evento stesso perche' vale sempre 2,8333 volte virtual_quote (docs/stonk-fun.md).
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const WebSocket = require('ws');
const bs58 = require('bs58');

const curva = require('../dist/services/stonk/curva.js');
const encodeBase58 = bs58.default ? bs58.default.encode : bs58.encode;

const DISCRIMINANTE = 'bddb7fd34ee661ee';
const LOG_DIR = path.join(process.cwd(), 'logs');
const OUT = path.join(LOG_DIR, 'stonk-compratori.jsonl');

// sopra questa quota del bersaglio si va a vedere CHI ha comprato (una chiamata a testa)
const COMPRA_MINIMA = Number(process.env.STONK_COMPRA_MINIMA || '0.005');
const HEARTBEAT_MS = Number(process.env.STONK_HEARTBEAT_MS || '60000');
const NOMI_AL_SEC = Number(process.env.STONK_NOMI_AL_SEC || '5');

const stream = fs.createWriteStream(OUT, { flags: 'a' });
const coda = [];
const contatori = { scambi: 0, compre: 0, vendite: 0, grosse: 0, nomi: 0, falliti: 0 };
const perPortafoglio = new Map();

function endpointWs() {
  const http = process.env.SVS_INDEX_RPC || process.env.SVS_UNSTAKED_RPC;
  if (!http) throw new Error('manca SVS_INDEX_RPC o SVS_UNSTAKED_RPC nel .env');
  return http.replace(/^http/, 'ws');
}

async function rpc(metodo, params) {
  const url = process.env.SVS_INDEX_RPC || process.env.SVS_UNSTAKED_RPC;
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metodo, params }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

/** l'evento di scambio dentro i log, o null se questa transazione non ne ha */
function leggiEvento(righe) {
  for (const r of righe) {
    if (!r.startsWith('Program data: ')) continue;
    let b;
    try { b = Buffer.from(r.slice(14), 'base64'); } catch { continue; }
    if (b.length < 128 || b.subarray(0, 8).toString('hex') !== DISCRIMINANTE) continue;
    const virtualQuote = Number(b.readBigUInt64LE(56));
    const quotePrima = Number(b.readBigUInt64LE(72));
    const quoteDopo = Number(b.readBigUInt64LE(88));
    const bersaglio = virtualQuote * curva.RAPPORTO_BERSAGLIO;
    return {
      pool: encodeBase58(b.subarray(8, 40)),
      compra: quoteDopo > quotePrima,
      importo: Number(b.readBigUInt64LE(96)),
      ricevuto: Number(b.readBigUInt64LE(104)),
      bersaglio,
      // tutto in quota del bersaglio: e' l'unica unita' confrontabile fra 21 quote diversi
      quota: bersaglio > 0 ? Number(b.readBigUInt64LE(96)) / bersaglio : 0,
      fPrima: bersaglio > 0 ? quotePrima / bersaglio : 0,
      fDopo: bersaglio > 0 ? quoteDopo / bersaglio : 0,
    };
  }
  return null;
}

/** chi ha firmato: sta nella transazione, non nell'evento, quindi costa una chiamata */
async function chiChiama(voce) {
  const tx = await rpc('getTransaction', [voce.firma, {
    maxSupportedTransactionVersion: 0, encoding: 'jsonParsed', commitment: 'confirmed',
  }]);
  if (!tx || !tx.meta) {
    voce.tentativi = (voce.tentativi || 0) + 1;
    if (voce.tentativi <= 10) coda.push(voce);
    else contatori.falliti += 1;
    return;
  }
  const chiave = tx.transaction.message.accountKeys.find((k) => k.signer);
  if (!chiave) return;
  const portafoglio = chiave.pubkey;
  contatori.nomi += 1;
  const conta = perPortafoglio.get(portafoglio) || { compre: 0, quota: 0, pool: new Set() };
  conta.compre += 1;
  conta.quota += voce.e.quota;
  conta.pool.add(voce.e.pool);
  perPortafoglio.set(portafoglio, conta);
  const riga = {
    t: voce.t, firma: voce.firma, portafoglio, pool: voce.e.pool,
    quota: Number(voce.e.quota.toFixed(6)),
    raccolta: Number(voce.e.fPrima.toFixed(6)),
    dopo: Number(voce.e.fDopo.toFixed(6)),
    salto: Number((voce.e.fDopo - voce.e.fPrima).toFixed(6)),
  };
  stream.write(JSON.stringify(riga) + '\n');
  console.log(
    new Date(voce.t).toISOString().slice(11, 19),
    portafoglio.slice(0, 12).padEnd(13),
    ('' + (100 * riga.quota).toFixed(2) + '% del bersaglio').padStart(22),
    ('  curva ' + (100 * riga.raccolta).toFixed(2) + '% -> ' + (100 * riga.dopo).toFixed(2) + '%').padEnd(30),
    conta.compre > 1 ? `(${conta.compre}a volta, ${conta.pool.size} curve)` : '',
  );
}

async function giroNomi() {
  for (let i = 0; i < NOMI_AL_SEC && coda.length; i += 1) {
    const voce = coda.shift();
    try {
      await chiChiama(voce);
    } catch (e) {
      voce.errori = (voce.errori || 0) + 1;
      if (voce.errori <= 2) coda.push(voce); else contatori.falliti += 1;
      if (voce.errori === 1) console.error('nome:', String(e).slice(0, 120));
      break;
    }
  }
}

function battito() {
  const attivi = [...perPortafoglio.entries()].sort((a, b) => b[1].quota - a[1].quota).slice(0, 3);
  console.log(`[${new Date().toISOString()}] COMPRATORI scambi=${contatori.scambi}`
    + ` compre=${contatori.compre} vendite=${contatori.vendite}`
    + ` grosse=${contatori.grosse} nomi=${contatori.nomi} coda=${coda.length} persi=${contatori.falliti}`
    + (attivi.length ? '  |  piu attivi: ' + attivi.map(([w, c]) =>
      `${w.slice(0, 8)} ${c.compre}x ${(100 * c.quota).toFixed(0)}%`).join('  ') : ''));
}

function collega() {
  const url = endpointWs();
  console.log(`compratori stonk.fun -> si chiede il nome sopra il ${(100 * COMPRA_MINIMA).toFixed(2)}% del bersaglio`);
  const ws = new WebSocket(url);
  let vivo = null;
  ws.on('open', () => {
    Object.keys(curva.PIATTAFORME).forEach((plat, i) => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: i + 1, method: 'logsSubscribe',
        params: [{ mentions: [plat] }, { commitment: 'processed' }],
      }));
    });
    vivo = setInterval(() => { try { ws.ping(); } catch { /* chiuso */ } }, 20000);
  });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.error) { console.error('errore sottoscrizione:', JSON.stringify(msg).slice(0, 200)); return; }
    if (msg.id !== undefined && msg.result !== undefined) { console.log(`sottoscrizione ${msg.id} attiva`); return; }
    if (msg.method !== 'logsNotification') return;
    const v = msg.params.result.value;
    if (v.err) return;
    const e = leggiEvento(v.logs || []);
    if (!e) return;
    contatori.scambi += 1;
    if (e.compra) contatori.compre += 1; else contatori.vendite += 1;
    if (!e.compra || e.quota < COMPRA_MINIMA) return;
    contatori.grosse += 1;
    coda.push({ firma: v.signature, t: Date.now(), e, tentativi: 0 });
  });
  const riparti = (perche) => {
    if (vivo) clearInterval(vivo);
    console.error(`connessione chiusa (${perche}), riprovo fra 5s`);
    setTimeout(collega, 5000);
  };
  ws.on('close', () => riparti('close'));
  ws.on('error', (e) => { console.error('errore socket:', String(e).slice(0, 160)); try { ws.close(); } catch { /* gia chiuso */ } });
}

fs.mkdirSync(LOG_DIR, { recursive: true });
setInterval(battito, HEARTBEAT_MS);
setInterval(giroNomi, 1000);
collega();
for (const seg of ['SIGINT', 'SIGTERM']) {
  process.on(seg, () => { battito(); stream.end(); process.exit(0); });
}
