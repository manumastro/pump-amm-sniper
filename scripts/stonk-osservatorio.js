#!/usr/bin/env node
// Osservatorio live delle curve stonk.fun su Raydium LaunchLab.
// Si iscrive ai pool_state via programSubscribe e registra il percorso di ogni curva:
// f = real_quote / total_quote_fund_raising, cioe' quanto e' avanzata la raccolta.
// Non compra niente e non tocca il bot: scrive solo due file in logs/.
// Vedi docs/stonk-fun.md per il modello.

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const WebSocket = require('ws');
const bs58 = require('bs58');

const encodeBase58 = bs58.default ? bs58.default.encode : bs58.encode;

const LAUNCHLAB = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
const PIATTAFORME = {
  '6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt': 'reward',
  '4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7': 'standard',
};
const POOL_STATE_BYTES = 429;

const ROOT = process.cwd();
const LOG_DIR = path.join(ROOT, 'logs');
const OUT_POOLS = path.join(LOG_DIR, 'stonk-pools.jsonl');
const OUT_CURVA = path.join(LOG_DIR, 'stonk-curva.jsonl');

// scrive un campione solo se la raccolta si e' mossa di almeno questo, o se cambia stato
const PASSO_MINIMO = Number(process.env.STONK_PASSO_MINIMO || '0.0002');
const HEARTBEAT_MS = Number(process.env.STONK_HEARTBEAT_MS || '60000');
// quante nascite al secondo andiamo a risolvere via RPC (una chiamata per pool nuova)
const NASCITE_AL_SEC = Number(process.env.STONK_NASCITE_AL_SEC || '4');
// il pool_state e' l'indice 5 dei conti dell'istruzione di creazione di LaunchLab
const INDICE_POOL_STATE = 5;

function endpointWs() {
  const http = process.env.SVS_INDEX_RPC || process.env.SVS_UNSTAKED_RPC;
  if (!http) throw new Error('manca SVS_INDEX_RPC o SVS_UNSTAKED_RPC nel .env');
  return http.replace(/^http/, 'ws');
}

function mascheraEndpoint(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '(endpoint)';
  }
}

// layout verificato in docs/stonk-fun.md
function leggiPoolState(buf) {
  if (buf.length !== POOL_STATE_BYTES) return null;
  const baseDec = buf[18];
  const quoteDec = buf[19];
  const scalaB = 10 ** baseDec;
  const scalaQ = 10 ** quoteDec;
  const piattaforma = PIATTAFORME[encodeBase58(buf.subarray(173, 205))];
  if (!piattaforma) return null;
  const target = Number(buf.readBigUInt64LE(69)) / scalaQ;
  return {
    stato: buf[17],
    piattaforma,
    baseDec,
    quoteDec,
    vBase: Number(buf.readBigUInt64LE(37)) / scalaB,
    vQuote: Number(buf.readBigUInt64LE(45)) / scalaQ,
    rBase: Number(buf.readBigUInt64LE(53)) / scalaB,
    rQuote: Number(buf.readBigUInt64LE(61)) / scalaQ,
    target,
    mint: encodeBase58(buf.subarray(205, 237)),
    quote: encodeBase58(buf.subarray(237, 269)),
  };
}

const viste = new Map(); // pool -> { primoTs, primaF, maxF, maxTs, ultimaF, campioni }
let scritteCurva = 0;
let notifiche = 0;
let nasciteRisolte = 0;
let logRicevuti = 0;
let logConCreazione = 0;

// Una pool vista per la prima volta puo' essere appena nata o gia' vecchia: lo dice la sua
// storia. Una pagina sola di firme (<1000) significa che la piu' vecchia e' la creazione.
const codaNascite = [];
const nateQui = new Map(); // pool -> { nascita, firma }  dalle creazioni viste in diretta
async function rpc(metodo, params) {
  const url = process.env.SVS_INDEX_RPC || process.env.SVS_UNSTAKED_RPC;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metodo, params }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

/**
 * L'istante di nascita preso dai log, con la firma a prova.
 *
 * Dedurlo da getSignaturesForAddress non basta: una pool calda supera le 1000 firme in
 * pochi minuti e allora la piu' vecchia che vediamo non e' piu' la creazione. I log invece
 * la danno esatta, costano 47 KB/s e il ritmo torna con la crescita on-chain (~150 all'ora).
 */
async function registraCreazione(voce) {
  // i log arrivano a commitment 'processed': la transazione non e' ancora leggibile per
  // qualche secondo, e chiedendola subito torna null. Si rimette in coda e si riprova.
  const tx = await rpc('getTransaction', [voce.firma, {
    maxSupportedTransactionVersion: 0, encoding: 'jsonParsed', commitment: 'confirmed',
  }]);
  if (!tx || !tx.meta) {
    voce.tentativi = (voce.tentativi || 0) + 1;
    if (voce.tentativi <= 15) codaCreazioni.push(voce);
    return;
  }
  const dentro = [...tx.transaction.message.instructions];
  for (const g of tx.meta.innerInstructions || []) dentro.push(...g.instructions);
  const istr = dentro.find((i) => i.programId === LAUNCHLAB && Array.isArray(i.accounts) && i.accounts.length > INDICE_POOL_STATE);
  if (!istr) return;
  const pool = istr.accounts[INDICE_POOL_STATE];
  if (nateQui.has(pool)) return;
  const nascita = (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000;
  nateQui.set(pool, { nascita, firma: voce.firma });
  streamPools.write(JSON.stringify({
    t: Date.now(), pool, tipo: 'nascita', fonte: 'log', nascita, firma: voce.firma, completo: true,
  }) + '\n');
  nasciteRisolte += 1;
}

async function risolviNascita(pool) {
  if (nateQui.has(pool)) return;
  const firme = await rpc('getSignaturesForAddress', [pool, { limit: 1000 }]);
  if (!firme || !firme.length) return;
  const completo = firme.length < 1000;
  const piuVecchia = firme[firme.length - 1];
  streamPools.write(JSON.stringify({
    t: Date.now(), pool, tipo: 'nascita', fonte: 'firme',
    nascita: completo ? piuVecchia.blockTime * 1000 : null,
    firmeViste: firme.length, completo,
  }) + '\n');
  nasciteRisolte += 1;
}

const codaCreazioni = [];

async function giroNascite() {
  const quante = Math.max(1, NASCITE_AL_SEC);
  // le creazioni viste nei log hanno la precedenza: sono l'istante vero
  for (let i = 0; i < quante && codaCreazioni.length; i += 1) {
    const voce = codaCreazioni.shift();
    try {
      await registraCreazione(voce);
    } catch (e) {
      // un catch muto qui ha nascosto per mezz'ora un ReferenceError: l'errore si stampa
      voce.errori = (voce.errori || 0) + 1;
      if (voce.errori <= 3) console.error('creazione, tentativo fallito:', String(e).slice(0, 140));
      if (voce.errori <= 5) codaCreazioni.push(voce);
      break;
    }
  }
  for (let i = 0; i < quante && codaNascite.length; i += 1) {
    const pool = codaNascite.shift();
    try {
      await risolviNascita(pool);
    } catch (e) {
      console.error('nascita dedotta, tentativo fallito:', String(e).slice(0, 140));
      codaNascite.push(pool);
      break;
    }
  }
}

const streamPools = fs.createWriteStream(OUT_POOLS, { flags: 'a' });
const streamCurva = fs.createWriteStream(OUT_CURVA, { flags: 'a' });

function registra(pool, s) {
  const ts = Date.now();
  const f = s.target > 0 ? s.rQuote / s.target : 0;
  let stato = viste.get(pool);

  if (!stato) {
    stato = { primoTs: ts, primaF: f, maxF: f, maxTs: ts, ultimaF: -1, ultimoStato: -1, campioni: 0 };
    viste.set(pool, stato);
    codaNascite.push(pool);
    streamPools.write(JSON.stringify({
      t: ts, pool, mint: s.mint, quote: s.quote, piattaforma: s.piattaforma,
      baseDec: s.baseDec, quoteDec: s.quoteDec,
      vBase: s.vBase, vQuote: s.vQuote, target: s.target,
      fIniziale: Number(f.toFixed(6)), stato: s.stato, tipo: 'pool',
    }) + '\n');
  }

  const cambiaStato = s.stato !== stato.ultimoStato;
  if (!cambiaStato && Math.abs(f - stato.ultimaF) < PASSO_MINIMO) return;

  stato.ultimaF = f;
  stato.ultimoStato = s.stato;
  stato.campioni += 1;
  if (f > stato.maxF) { stato.maxF = f; stato.maxTs = ts; }

  streamCurva.write(JSON.stringify({
    t: ts, p: pool, f: Number(f.toFixed(6)), q: Number(s.rQuote.toFixed(s.quoteDec)), s: s.stato,
  }) + '\n');
  scritteCurva += 1;
}

function battito() {
  const vive = [...viste.values()];
  const sopra = (x) => vive.filter((v) => v.maxF >= x).length;
  console.log([
    `[${new Date().toISOString()}]`,
    'STONK',
    `pool=${viste.size}`,
    `notifiche=${notifiche}`,
    `campioni=${scritteCurva}`,
    `max>=1%=${sopra(0.01)}`,
    `max>=5%=${sopra(0.05)}`,
    `max>=20%=${sopra(0.2)}`,
    `migrate=${vive.filter((v) => v.ultimoStato === 2).length}`,
    `nascite=${nasciteRisolte}/${viste.size}`,
    `nateQui=${nateQui.size}`,
    `log=${logRicevuti}/${logConCreazione}`,
    `coda=${codaNascite.length}+${codaCreazioni.length}`,
  ].join(' '));
}

function collega() {
  const url = endpointWs();
  console.log(`osservatorio stonk.fun -> ${mascheraEndpoint(url)}`);
  const ws = new WebSocket(url);
  let vivo = null;

  ws.on('open', () => {
    Object.keys(PIATTAFORME).forEach((plat, i) => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: i + 1, method: 'programSubscribe',
        params: [LAUNCHLAB, {
          encoding: 'base64', commitment: 'processed',
          filters: [{ dataSize: POOL_STATE_BYTES }, { memcmp: { offset: 173, bytes: plat } }],
        }],
      }));
    });
    Object.keys(PIATTAFORME).forEach((plat, i) => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 100 + i, method: 'logsSubscribe',
        params: [{ mentions: [plat] }, { commitment: 'processed' }],
      }));
    });
    vivo = setInterval(() => { try { ws.ping(); } catch { /* chiuso */ } }, 20000);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.error) { console.error('errore sottoscrizione:', msg.error.message); return; }
    if (msg.method === 'logsNotification') {
      logRicevuti += 1;
      const v = msg.params.result.value;
      if (v.err) return;
      const nomi = (v.logs || []).filter((r) => r.includes('Instruction:')).map((r) => r.split(': ').pop());
      if (!nomi.includes('InitializeWithToken2022') && !nomi.includes('InitializeV2')) return;
      logConCreazione += 1;
      codaCreazioni.push({ firma: v.signature, tentativi: 0 });
      return;
    }
    if (msg.method !== 'programNotification') return;
    notifiche += 1;
    const v = msg.params.result.value;
    const s = leggiPoolState(Buffer.from(v.account.data[0], 'base64'));
    if (s) registra(v.pubkey, s);
  });

  const riparti = (perche) => {
    if (vivo) clearInterval(vivo);
    console.error(`connessione chiusa (${perche}), riprovo fra 5s`);
    setTimeout(collega, 5000);
  };
  ws.on('close', () => riparti('close'));
  ws.on('error', (e) => { console.error('errore socket:', String(e).slice(0, 160)); try { ws.close(); } catch { /* gia' chiuso */ } });
}

fs.mkdirSync(LOG_DIR, { recursive: true });
setInterval(battito, HEARTBEAT_MS);
setInterval(giroNascite, 1000);
collega();

for (const seg of ['SIGINT', 'SIGTERM']) {
  process.on(seg, () => {
    battito();
    streamPools.end();
    streamCurva.end();
    process.exit(0);
  });
}
