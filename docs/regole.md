# Regole e modello di esecuzione

## Le tre cose da sapere prima di toccare qualcosa

### 1. I controlli sono il prodotto

Prima di modificare entry, hold, creator-risk, report o analisi rug: **leggere `docs/controls.md`**.
Ogni modifica a una soglia, un toggle, una regola di blocco o al significato di un log deve aggiornare
`controls.md` nello stesso ciclo. Non e burocrazia: e l'unico posto dove il ragionamento dietro 30
controlli e scritto.

### 2. Allentare i filtri e gia stato provato e ha fatto danni

Il 2026-04-01 e stato aggiunto `cp=1` alla whitelist unique-counterparties. Risultato su 39 trade:
43,6% WR, 20 rug a −100%, −0,102 SOL. Revertito il giorno dopo. I token `cp=1` hanno funder non
tracciabile e nessuna storia utile.

**Regola pratica:** non toccare i filtri pre-entry o le soglie di hold senza prima consultare
l'ultima analisi in `analysis/`. Il collo di bottiglia non e il flusso di eventi, e la selezione.

### 3. Il crash da `remove liquidity` e atomico

25 dei 26 rug della sessione di aprile escono per `remove liquidity`. 17 su 26 avevano fatto un picco
sopra +3% (diversi tra +20% e +39%) ed erano winner armati con trailing al 10% e profit floor al 3%
attivi: sono usciti a −100% lo stesso. La liquidita se ne va in **una singola transazione**, il prezzo
non attraversa i livelli di stop.

Conseguenza: **ridurre l'intervallo di polling non serve a niente**, e nemmeno una detection
event-driven (quando vedi la tx e gia confermata). Il problema va attaccato prima dell'entry, o con un
take profit condizionato al rischio. Non proporre "polling piu veloce" come soluzione.

## Architettura e program monitorati

`src/pumpAmmSniper.ts` (3.538 righe) e ancora un monolite: entrypoint + orchestratore + helper RPC.
Il refactor a servizi e a meta strada.

```
src/app/          bootstrap, config, runtime (subscription + supervisor), worker lifecycle
src/domain/       tipi condivisi
src/services/
  creator-risk/   30 controlli su creator, funder, relay, burst, cashout (1.948 righe)
  paper-trade/    pre-buy validation, hold monitor, quote/exit simulation
  liquidity/  token-security/  top10/  dev-holdings/  reporting/
src/utils/        formatter e helper puri
```

**Regole:** nuovi controlli non vanno in `pumpAmmSniper.ts`, ma nel servizio di competenza.
I nomi delle env esistenti non si cambiano durante il refactor.

### Modello di esecuzione

Un processo supervisore ascolta `connection.onLogs(programId)` e per ogni signature con un log
`create_pool` fa spawn di un **processo figlio** (`src/app/runtime.ts:369`) che esegue lo stesso
binario con `WORKER_TASK_SIGNATURE` impostata. `MAX_CONCURRENT_OPERATIONS=2` slot.
`getWorkerEntryCommand()` usa `dist/pumpAmmSniper.js` se esiste, altrimenti ricade su ts-node.

**Dopo ogni modifica a `src/**`: `npm run build`.** Senza build il bot esegue il codice vecchio in `dist/`.

### Program monitorati

La lista viene dal registro degli adapter in `src/services/dex/index.ts`:

```
pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA   // pumpswap  AMM di Pump.fun (post-diploma)
6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P    // pump      bonding curve di Pump.fun
```

I due lati dello stesso ecosistema: la curva e l'AMM in cui i token si diplomano.
`meteora_damm_v2` e `ray_v4` sono implementati e verificati ma **non registrati**
(`src/services/dex/index.ts` spiega perche); riattivarli e una riga.

**Flusso misurato** (`node scripts/creation-rate.js 300`, 2026-09-12):

| DEX | creazioni/ora | quota |
|---|---|---|
| `pump` | 2.652 | **92,9%** |
| `pumpswap` | 204 | 7,1% |

⚠️ **Con 2 worker la capacita e 360 valutazioni/ora** (a 20s per valutazione): il flusso e
otto volte la capacita, quindi la coda e permanentemente satura. Dal 2026-09-12 e **LIFO con
TTL** (`QUEUE_ORDER=lifo`, `QUEUE_MAX_AGE_MS=45000`): serve la firma piu fresca e scarta le
altre. Prima era FIFO senza TTL e consegnava al worker pool vecchie di ~50 minuti — invisibile
con la sola pumpswap, perche la coda non si riempiva mai. Vedi `docs/controls.md` sezioni 23 e 25.
**Non esiste ancora una quota per DEX:** pump e il 92,9% degli eventi e affama pumpswap.

Una subscription per adapter, il program viaggia fino al worker che risolve il proprio
`ACTIVE_ADAPTER`. Aggiungerne uno = implementare `DexAdapter` + una riga nel registro,
**poi verificarlo contro la rete** con `node scripts/dex-adapter-live-check.js 180`.
Vedi `docs/architecture.md` (DEX Layer).

⚠️ **Nei worker non usare mai `defaultAdapter`: usare `getActiveAdapter()`.** Quotare un pool
Raydium con la matematica di PumpSwap non solleva un errore, produce un PnL sbagliato.

**I launchpad su bonding curve non sono un adapter.** `pump` (207 creazioni su 300 nel campione
gmgn), `meteora_virtual_curve` e `ray_launchpad` non hanno pool ne liquidita alla creazione:
filtro di liquidita, top-10 e dev-holdings sono ciechi, e il rug non avviene per
`remove liquidity` (25 dei 26 rug di aprile) ma per dump del dev, trigger che il bot non ha.
Sono una seconda strategia che condivide l'infrastruttura. Dettagli in
`docs/expansion-sources-2026-09-12.md`.

## Strumentazione dati

`holdLog` nel report contiene `pricePath: {t[], q[]}` — la serie temporale del quote di uscita
durante l'hold (`t` = ms dall'inizio, `q` = SOL ricavabili vendendo tutta la posizione).
Aggiunto il 2026-09-12, vedi `docs/controls.md` sezione 19.

**Perche conta:** prima esisteva solo un riepilogo (entry, picco, time-to-peak, exit reason). Con i
soli dati storici si puo validare la soglia di take profit (basta il picco), ma **non** trailing stop,
profit floor o exit anticipate, perche manca il percorso del prezzo. Dalla prossima sessione paper ogni
trade diventa ri-simulabile offline: si testano ipotesi in secondi invece che in 72h di paper per volta.

Il recorder e osservativo, non cambia nessuna decisione di exit. Si spegne con
`HOLD_PRICE_PATH_RECORD_ENABLED=false`.

**Nota:** il codice e verificato in build ma **non ancora a runtime** — al momento della scrittura non
esisteva un ambiente con RPC attivo. Da controllare alla prima sessione.

## Passaggio a live: non e pronto

`executeBuy()` esiste (`src/pumpAmmSniper.ts:3102`) ma usa `sendRawTransaction` nudo, slippage
hardcoded al 50%, **nessuna priority fee, nessun compute budget, nessun Jito tip, nessun Helius Sender**.
Tutti e 5 i punti di `PRODUCTION_BOT_CHECKLIST.md` sono aperti.

## Qualita del codice

**Non esiste un singolo test** in tutto il repo. 30 controlli creator-risk, zero copertura: ogni tuning
e una scommessa validata solo da 72h di paper. I JSON in `last_rugpulls/` sono fixture reali gia pronte
per una suite.

## Convenzioni

- Documentazione e commit in italiano (il resto del repo lo e).
- Analisi periodiche in `analysis/`, una per sessione, con config runtime completa in coda.
- Per debug investigativo manuale c'e `solscan-parser/` (Python).
