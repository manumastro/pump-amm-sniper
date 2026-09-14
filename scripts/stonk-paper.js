#!/usr/bin/env node
// Paper trade sulle curve stonk.fun: non compra niente, apre posizioni simulate quando la
// raccolta attraversa una soglia e le chiude quando ne attraversa un'altra.
//
// Su ogni ingresso apre una posizione per ciascuna regola d'uscita in prova: costano zero e
// fanno misurare tutte le uscite sulla stessa sessione. Il report e' scripts/stonk-paper-report.js.
//
// Vedi docs/stonk-fun.md per il modello della curva e docs/controls.md per le soglie.

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const WebSocket = require('ws');
const bs58 = require('bs58');

const curva = require('../dist/services/stonk/curva.js');
const paper = require('../dist/services/stonk/paper.js');

const encodeBase58 = bs58.default ? bs58.default.encode : bs58.encode;
const b58 = (b) => encodeBase58(b);

const LOG_DIR = path.join(process.cwd(), 'logs');
const OUT = path.join(LOG_DIR, 'stonk-paper.jsonl');

const ENTRATA = Number(process.env.STONK_ENTRATA || '0.015');
const TAGLIA = Number(process.env.STONK_TAGLIA_FRAZIONE || '0.002');
const SCAMBIO_PER_LATO = Number(process.env.STONK_FEE_SCAMBIO || '0.0125');
// lo stop e' una caduta di PREZZO dall'ingresso, non un punto di raccolta: un punto vale
// -5,3% di prezzo se sei entrato al 2% e -3,6% se sei entrato al 20%.
const RICADUTA = Number(process.env.STONK_RICADUTA || '0.10');
const SCADENZA_MS = Number(process.env.STONK_SCADENZA_MS || '1800000');
const HEARTBEAT_MS = Number(process.env.STONK_HEARTBEAT_MS || '60000');
// con l'ingresso `sopra` attivo le posizioni aperte insieme diventano migliaia: 400 veniva
// toccato in dieci minuti e da li' in poi gli ingressi sparivano in silenzio, falsando la misura.
const MAX_APERTE = Number(process.env.STONK_MAX_APERTE || '8000');
// le curve che incontriamo gia' sopra la soglia: comprarle o no e' una domanda aperta, quindi
// si comprano e si taggano `modo: sopra`, cosi' il report confronta i due ingressi sulla stessa
// sessione invece di ragionarci sopra. MAX_INGRESSO evita di entrare su una curva quasi piena.
const ANCHE_SOPRA = process.env.STONK_ANCHE_SOPRA !== 'false';
// FiFawHqx, l'unico portafoglio che abbiamo visto lavorare davvero su queste curve, su 25
// acquisti verificati non ha MAI comprato sopra il 2,33% di raccolta (mediana 0,85%). E la
// nostra misura sulle 95 pool dice lo stesso: sotto il 3% il prezzo sale del 10% tre volte su
// quattro con discesa mediana zero, fra il 10 e il 30% ci arriva una volta su quattro.
const MAX_INGRESSO = Number(process.env.STONK_MAX_INGRESSO || '0.025');
// il pool_state e' l'indice 5 dei conti dell'istruzione di creazione di LaunchLab
const INDICE_POOL_STATE = 5;
const CREAZIONI_AL_SEC = Number(process.env.STONK_CREAZIONI_AL_SEC || '4');
const SCADENZE_AL_SEC = Number(process.env.STONK_SCADENZE_AL_SEC || '10');

// Le uscite in prova: stessa entrata, tutte misurate insieme. Sono guadagni di PREZZO
// rispetto all'ingresso, non livelli di raccolta: cosi' la stessa regola vuol dire la stessa
// cosa per chi entra all'1,5% e per chi entra al 20%, che prima non era vero.
// Nessuna scende sotto il 10%: i costi del giro completo misurati sono ~6,6 punti, sotto quella
// soglia l'operazione perde anche quando indovina.
const REGOLE = (process.env.STONK_USCITE || '0.10,0.15,0.25,0.40,0.60,1.00,3.00,10.00')
  .split(',').map(Number).filter((x) => x > 0)
  .map((guadagno) => ({
    nome: `p${(guadagno * 100).toFixed(0)}`,
    guadagno,
    stop: RICADUTA,
    scadenzaMs: SCADENZA_MS,
  }));

// A tempo secco: spente, e non per opinione. Su 58 posizioni ciascuna hanno fatto -4,4%, -5,4%
// e -5,6%, il campione piu' grande che avessimo. Appaiando le stesse pool si vede perche': uscire
// sempre a 5 secondi salva 10 punti quando la pool sta morendo ma ne butta 16 quando sta correndo,
// perche' vende anche le vincenti. Resta la versione condizionata (le `b`), che taglia solo quelle
// ferme. La chiave resta, con default vuoto: basta valorizzarla nel .env per riaccenderle.
for (const secondi of (process.env.STONK_USCITE_TEMPO ?? '').split(',').map(Number).filter((x) => x > 0)) {
  REGOLE.push({ nome: `t${secondi}`, guadagno: Infinity, stop: RICADUTA, scadenzaMs: secondi * 1000 });
}

// A completamento: si esce quando la curva arriva a quella quota del suo bersaglio, comunque sia
// andato il prezzo. Ha senso di nuovo adesso che si compra solo sotto il 2,5%: tutti gli ingressi
// partono dallo stesso punto, quindi la stessa soglia vuol dire la stessa cosa per tutti. r100 =
// tenere fino alla migrazione.
for (const quota of (process.env.STONK_USCITE_RACCOLTA || '0.05,0.10,0.20,0.50,1.00').split(',').map(Number).filter((x) => x > 0)) {
  REGOLE.push({
    nome: `r${(quota * 100).toFixed(0)}`,
    guadagno: Infinity, stop: RICADUTA, scadenzaMs: SCADENZA_MS, obiettivoRaccolta: quota,
  });
}

// A pareggio ritardato: spente. L'idea era giusta (le vincite arrivano in ~6 secondi, le perdite
// marciscono per 24-89), ma la regola cosi' com'e' non ha nessuna uscita in guadagno: se a N secondi
// sei sopra, resti dentro finche' non scendi del 10% SOTTO l'ingresso, cioe' finche' non hai
// restituito tutto. Per rimetterle serve prima decidere cosa fa uscire una vincente: un obiettivo
// abbinato o uno stop mobile. La chiave resta, con default vuoto.
for (const secondi of (process.env.STONK_USCITE_PAREGGIO ?? '').split(',').map(Number).filter((x) => x > 0)) {
  REGOLE.push({
    nome: `b${secondi}`,
    guadagno: Infinity, stop: RICADUTA, scadenzaMs: SCADENZA_MS, verificaMs: secondi * 1000,
  });
}

// A meta': si vende una parte all'obiettivo e il resto continua a correre fino allo stop o alla
// scadenza. E' l'unica differenza vera fra una regola secca e quello che fa FiFawHqx, che vende
// in piu' pezzi (fino a 7 sullo stesso token).
const FRAZIONE_META = Number(process.env.STONK_FRAZIONE_META || '0.5');
for (const guadagno of (process.env.STONK_USCITE_META || '0.25,0.60').split(',').map(Number).filter((x) => x > 0)) {
  REGOLE.push({
    nome: `m${(guadagno * 100).toFixed(0)}`,
    guadagno,
    stop: RICADUTA,
    scadenzaMs: SCADENZA_MS,
    frazioneAlObiettivo: FRAZIONE_META,
  });
}

const stream = fs.createWriteStream(OUT, { flags: 'a' });
const seguite = new Map();   // pool -> { sottoSoglia, aperte: Map<regola, Posizione> }
const tasse = new Map();     // mint -> aliquota per lato
const contatori = {
  notifiche: 0, aperte: 0, chiuse: 0, parziali: 0, scadenzeRisolte: 0, ingressi: 0, ingressiSopra: 0,
  poolSotto: 0, poolSopra: 0, troppoAlte: 0,
  nate: 0, nateSopra: 0, log: 0, logCreazioni: 0, sottoscrizioni: 0, scartate: {},
};
const codaCreazioni = [];

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

/**
 * L'aliquota della tassa sui trasferimenti si legge dal mint, non si assume: sui lanci
 * reward vale 1% o 3% a scelta di chi lancia, e la differenza sul giro completo e' 4 punti.
 * Finche' non e' nota si usa 1%, il caso piu' comune, e si corregge appena arriva.
 */
async function leggiTassa(mint, piattaforma) {
  if (piattaforma === 'standard') return 0;
  if (tasse.has(mint)) return tasse.get(mint);
  tasse.set(mint, 0.01);
  try {
    const info = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
    const est = info && info.value && info.value.data.parsed.info.extensions;
    const fee = (est || []).find((e) => e.extension === 'transferFeeConfig');
    const bp = fee && fee.state && fee.state.newerTransferFee
      && Number(fee.state.newerTransferFee.transferFeeBasisPoints);
    if (Number.isFinite(bp)) tasse.set(mint, bp / 10000);
  } catch { /* resta il default */ }
  return tasse.get(mint);
}

/**
 * Le pool si incontrano quasi sempre a meta' strada: su programSubscribe arrivano solo
 * quando qualcuno le scambia, e a quel punto la raccolta e' gia' oltre la soglia d'ingresso.
 * Per avere un attraversamento vero bisogna conoscerle da quando nascono, e le nascite si
 * vedono solo nei log dei platform_config. La transazione arriva a commitment 'processed'
 * e non e' leggibile subito: va chiesta a 'confirmed' e ritentata.
 */
function scarta(perche) {
  contatori.scartate[perche] = (contatori.scartate[perche] || 0) + 1;
}

async function registraCreazione(voce) {
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
  const istr = dentro.find((i) => i.programId === curva.LAUNCHLAB_PROGRAM
    && Array.isArray(i.accounts) && i.accounts.length > INDICE_POOL_STATE);
  if (!istr) { scarta('senza istruzione launchlab'); return; }
  const pool = istr.accounts[INDICE_POOL_STATE];
  // NON si esce se la pool e' gia' in `seguite`: fra la creazione e il momento in cui
  // riusciamo a leggerla passano uno o due secondi, e in quel tempo ha gia' scambiato ed e'
  // arrivata da programSubscribe. Uscire qui faceva perdere ogni nascita.
  // anche questa va chiesta a 'confirmed': a 'finalized' l'account appena creato non esiste
  // ancora e torna null, ed e' il motivo per cui le nascite sparivano in silenzio.
  const conto = await rpc('getAccountInfo', [pool, { encoding: 'base64', commitment: 'confirmed' }]);
  if (!conto || !conto.value) { scarta('conto non ancora leggibile'); return; }
  const c = curva.leggiPoolState(Buffer.from(conto.value.data[0], 'base64'), b58);
  if (!c) { scarta('pool_state non decodificabile'); return; }
  const f = curva.raccolta(c);
  contatori.nate += 1;
  let s = seguite.get(pool);
  if (!s) { s = { sottoSoglia: false, aperte: new Map() }; seguite.set(pool, s); }
  s.nascita = (tx.blockTime || 0) * 1000;
  // se quando riusciamo a leggerla e' gia' oltre la soglia l'attraversamento e' perso: puo'
  // essere nata sopra (dev buy grosso) o averla superata in quei due secondi. Contate insieme.
  if (f < ENTRATA) s.sottoSoglia = true;
  else contatori.nateSopra += 1;
  registraVista(pool, s, c, f, Date.now(), 'nascita');
}

async function giroCreazioni() {
  for (let i = 0; i < CREAZIONI_AL_SEC && codaCreazioni.length; i += 1) {
    const voce = codaCreazioni.shift();
    try {
      await registraCreazione(voce);
    } catch (e) {
      voce.errori = (voce.errori || 0) + 1;
      if (voce.errori <= 3) console.error('creazione:', String(e).slice(0, 140));
      if (voce.errori <= 5) codaCreazioni.push(voce);
      break;
    }
  }
}

/**
 * Il primo incontro con una pool, scritto una volta sola: a che punto era la raccolta e da
 * quanti secondi la curva esisteva. Serve a rispondere con una misura a "quando le vediamo,
 * a che punto sono?" — prima c'era solo un contatore di notifiche, che contava la stessa
 * pool decine di volte e faceva sembrare l'imbuto molto peggiore di com'e'.
 */
function registraVista(pool, s, c, f, ora, da) {
  if (s.vista) return;
  s.vista = true;
  const sopra = f >= ENTRATA;
  if (sopra) contatori.poolSopra += 1; else contatori.poolSotto += 1;
  scrivi({
    tipo: 'vista', t: ora, pool, mint: c.baseMint, da, sopra, stato: c.stato,
    f: Number(f.toFixed(6)),
    secondiDallaNascita: s.nascita ? Number(((ora - s.nascita) / 1000).toFixed(1)) : null,
  });
}

/**
 * Le posizioni scadute si chiudono chiedendo la pool all'RPC, non aspettando che passi qualcuno.
 *
 * La curva la vediamo solo quando qualcuno la scambia: quando scadeva il tempo non avevamo un
 * prezzo a cui chiudere e la posizione restava appesa al prossimo scambio altrui. Misurato: `t10`
 * chiudeva dopo 24 secondi di mediana e `t30` dopo 59. Rendeva ingiusta proprio la prova che
 * serviva di piu', perche' FiFawHqx esce a 4 secondi mandando una transazione, non aspettando.
 */
const scadenzeInCorso = new Set();

async function giroScadenze() {
  const ora = Date.now();
  const dovute = [];
  for (const [pool, s] of seguite) {
    if (!s.aperte.size || scadenzeInCorso.has(pool)) continue;
    for (const [nome, p] of s.aperte) {
      const regola = REGOLE.find((r) => r.nome === nome);
      if (!regola) continue;
      if (ora - p.apertaIl >= regola.scadenzaMs) { dovute.push(pool); break; }
      // le regole a pareggio ritardato vanno guardate anche loro all'ora giusta, altrimenti la
      // verifica slitta al prossimo scambio di qualcun altro; una volta ogni 5s basta e avanza
      if (regola.verificaMs !== undefined && ora - p.apertaIl >= regola.verificaMs
          && ora - (s.ultimaSpazzata || 0) >= 5000) { dovute.push(pool); break; }
    }
  }
  for (const pool of dovute.slice(0, SCADENZE_AL_SEC)) {
    scadenzeInCorso.add(pool);
    try {
      const conto = await rpc('getAccountInfo', [pool, { encoding: 'base64', commitment: 'confirmed' }]);
      const c = conto && conto.value && curva.leggiPoolState(Buffer.from(conto.value.data[0], 'base64'), b58);
      const s2 = seguite.get(pool);
      if (s2) s2.ultimaSpazzata = Date.now();
      if (c) { contatori.scadenzeRisolte += 1; await aggiorna(pool, c); }
    } catch (e) {
      console.error('scadenza:', String(e).slice(0, 140));
    } finally {
      scadenzeInCorso.delete(pool);
    }
  }
}

function scrivi(record) {
  stream.write(JSON.stringify(record) + '\n');
}

function chiudiPosizione(pool, nome, p, c, motivo, ora) {
  paper.chiudi(p, c, motivo, ora);
  scrivi({
    tipo: 'chiusa', t: ora, pool, regola: nome, mint: p.mint, quote: p.quoteMint, modo: p.modo,
    piattaforma: p.piattaforma, tassa: p.costi.trasferimentoPerLato,
    fIngresso: Number(p.fIngresso.toFixed(6)), fUscita: Number(p.chiusa.fUscita.toFixed(6)),
    movimento: Number((p.chiusa.prezzoUscita / p.prezzoIngresso - 1).toFixed(6)),
    fMassima: Number(p.fMassima.toFixed(6)), fMinima: Number(p.fMinima.toFixed(6)),
    secondi: Number(((ora - p.apertaIl) / 1000).toFixed(1)),
    secondiAlMassimo: Number(((p.fMassimaIl - p.apertaIl) / 1000).toFixed(1)),
    quoteSpesa: p.quoteSpesa, quoteIncassata: p.chiusa.quoteIncassata,
    parziale: p.parzialeIl ? Number(((p.parzialeIl - p.apertaIl) / 1000).toFixed(1)) : null,
    rendimento: Number(p.chiusa.rendimento.toFixed(6)), motivo,
  });
  contatori.chiuse += 1;
}

async function aggiorna(pool, c) {
  const ora = Date.now();
  let s = seguite.get(pool);
  if (!s) { s = { sottoSoglia: false, aperte: new Map() }; seguite.set(pool, s); }
  const f = curva.raccolta(c);

  for (const [nome, p] of s.aperte) {
    paper.segui(p, c, ora);
    const regola = REGOLE.find((r) => r.nome === nome);
    if (paper.daVendereParziale(p, c, regola)) {
      paper.vendiParziale(p, c, regola.frazioneAlObiettivo, ora);
      contatori.parziali += 1;
    }
    const motivo = paper.motivoChiusura(p, c, regola, ora);
    if (motivo) { chiudiPosizione(pool, nome, p, c, motivo, ora); s.aperte.delete(nome); }
  }

  registraVista(pool, s, c, f, ora, 'scambio');

  if (c.stato === 2) return;
  if (f < ENTRATA) { s.sottoSoglia = true; return; }
  if (s.giaEntrata || s.aperte.size) return;
  // due ingressi diversi, misurati insieme: l'attraversamento vero (l'avevamo vista sotto) e
  // la pool incontrata quando era gia' oltre. Sopra MAX_INGRESSO non si entra comunque.
  let modo = null;
  if (s.sottoSoglia) modo = 'attraversamento';
  else if (ANCHE_SOPRA && f <= MAX_INGRESSO) modo = 'sopra';
  else { if (!s.troppoAlta) { s.troppoAlta = true; contatori.troppoAlte += 1; } return; }
  if (contatori.aperte - contatori.chiuse >= MAX_APERTE) return;

  s.giaEntrata = true;
  contatori.ingressi += 1;
  if (modo === 'sopra') contatori.ingressiSopra += 1;
  const tassa = await leggiTassa(c.baseMint, c.piattaforma);
  const costi = { scambioPerLato: SCAMBIO_PER_LATO, trasferimentoPerLato: tassa };
  for (const regola of REGOLE) {
    const p = paper.apri(pool, c, regola, TAGLIA, costi, ora);
    p.modo = modo;
    s.aperte.set(regola.nome, p);
    contatori.aperte += 1;
  }
  scrivi({
    tipo: 'ingresso', t: ora, pool, mint: c.baseMint, quote: c.quoteMint, modo,
    piattaforma: c.piattaforma, tassa, f: Number(f.toFixed(6)),
    bersaglio: c.bersaglio, quoteDecimali: c.quoteDecimali, regole: s.aperte.size,
    dallaNascita: !!s.nascita,
    secondiDallaNascita: s.nascita ? Number(((ora - s.nascita) / 1000).toFixed(1)) : null,
  });
}

function battito() {
  const aperte = [...seguite.values()].reduce((a, s) => a + s.aperte.size, 0);
  console.log([
    `[${new Date().toISOString()}]`, 'PAPER',
    `pool=${seguite.size}`, `notifiche=${contatori.notifiche}`,
    `ingressi=${contatori.ingressi}`, `posizioni=${contatori.aperte}`,
    `chiuse=${contatori.chiuse}`, `aperte=${aperte}`, `parziali=${contatori.parziali}`,
    `scadenze=${contatori.scadenzeRisolte}`,
    `log=${contatori.log}/${contatori.logCreazioni}`, `sub=${contatori.sottoscrizioni}`,
    `nate=${contatori.nate}`, `scartate=${JSON.stringify(contatori.scartate)}`, `nate_gia_sopra=${contatori.nateSopra}`,
    `pool_sotto=${contatori.poolSotto}`, `pool_sopra=${contatori.poolSopra}`,
    `ingressi_sopra=${contatori.ingressiSopra}`, `troppo_alte=${contatori.troppoAlte}`,
    `coda=${codaCreazioni.length}`,
  ].join(' '));
}

function collega() {
  const url = endpointWs();
  console.log(`paper stonk.fun -> ingresso ${(100 * ENTRATA).toFixed(1)}-${(100 * MAX_INGRESSO).toFixed(1)}%, `
    + `${REGOLE.length} regole: ${REGOLE.map((r) => r.nome).join(' ')}, stop -${(100 * RICADUTA).toFixed(0)}%`);
  const ws = new WebSocket(url);
  let vivo = null;
  ws.on('open', () => {
    Object.keys(curva.PIATTAFORME).forEach((plat, i) => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: i + 1, method: 'programSubscribe',
        params: [curva.LAUNCHLAB_PROGRAM, {
          encoding: 'base64', commitment: 'processed',
          filters: [{ dataSize: curva.POOL_STATE_BYTES }, { memcmp: { offset: 173, bytes: plat } }],
        }],
      }));
    });
    Object.keys(curva.PIATTAFORME).forEach((plat, i) => {
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
    if (msg.error) { console.error('errore sottoscrizione:', JSON.stringify(msg).slice(0, 200)); return; }
    if (msg.id !== undefined && msg.result !== undefined) {
      contatori.sottoscrizioni += 1;
      console.log(`sottoscrizione ${msg.id} attiva (${msg.result})`);
      return;
    }
    if (msg.method === 'logsNotification') {
      contatori.log += 1;
      const v = msg.params.result.value;
      if (v.err) return;
      const nomi = (v.logs || []).filter((r) => r.includes('Instruction:')).map((r) => r.split(': ').pop());
      if (!nomi.includes('InitializeWithToken2022') && !nomi.includes('InitializeV2')) return;
      contatori.logCreazioni += 1;
      codaCreazioni.push({ firma: v.signature, tentativi: 0 });
      return;
    }
    if (msg.method !== 'programNotification') return;
    contatori.notifiche += 1;
    const v = msg.params.result.value;
    const c = curva.leggiPoolState(Buffer.from(v.account.data[0], 'base64'), b58);
    if (c) aggiorna(v.pubkey, c).catch((e) => console.error('aggiorna:', String(e).slice(0, 140)));
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
setInterval(giroCreazioni, 1000);
setInterval(giroScadenze, 1000);
collega();
for (const seg of ['SIGINT', 'SIGTERM']) {
  process.on(seg, () => { battito(); stream.end(); process.exit(0); });
}
