# pump-amm-sniper

Sniper per le pool AMM di Pump.fun (PumpSwap). TypeScript/Node, ~14.500 righe.
**Non e mai andato live:** gira in paper trade (`MONITOR_ONLY=true`), size simulata 0,01 SOL.

## Indice rapido

| Cosa | Dove |
|---|---|
| **Controlli del bot (il documento piu importante)** | `docs/controls.md` |
| Architettura e ownership moduli | `docs/architecture.md` |
| Roadmap tuning profit | `docs/profit-roadmap.md` |
| Fonti di eventi: cosa ascolta il bot vs gmgn | `docs/expansion-sources-2026-09-12.md` |
| Deploy con Docker | `docs/docker-runbook.md` |
| Deploy systemd (**obsoleto**, la macchina non esiste piu) | `docs/systemd-runbook.md` |
| Analisi periodiche complete | `analysis/` |
| Worklog dei cicli di marzo | `docs/worklog-2026-03-2*.md` |
| Analisi creator/dev | `idea/creator-tx-analysis.md` |
| Checklist per il passaggio a live | `PRODUCTION_BOT_CHECKLIST.md` |

Script diagnostici: `node scripts/rug-analysis.js` (tabella completa pre-entry e post-entry per ogni rug),
`node scripts/rpc-smoke-test.js` (verifica se un endpoint RPC regge il bot),
`node scripts/gmgn-new-pairs-probe.js` (feed nuove pair di gmgn).

## Stato attuale

**Ferma dal 2026-04-06.** L'ultima sessione utile e stata 2026-04-02 → 2026-04-06 (~90h, 8.645 eventi).
I commit di giugno sono un revert che riporta `main` al tag `v1.0.0-paper-stable`.

Ultimi numeri validi (`analysis/2026-04-06-full-analysis.md`, metodologia corretta):

| Metrica | Valore |
|---|---|
| Outcome totali | 387 (348 trade + 39 rug) |
| Win rate | 69,4% |
| Net PnL | **+0,645 SOL** |
| EV/trade | +0,00167 SOL |
| Median win | +37,5% |
| Rug | 39, **−0,389 SOL** = 37,6% del profitto lordo |

⚠️ **Non usare i numeri dell'analisi 04-05** (WR 77,3%, +0,826 SOL): escludevano le rug losses, che nel
report sono eventi separati con `checksPassed=false, rugLoss=true`. Il valore reale era +0,566 SOL.
Il file 04-05 ha un'errata in testa. Verifica sempre contro `totalPnlSol` nell'header del report.

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

## Architettura

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

La lista viene dal registro degli adapter in `src/services/dex/index.ts`. Oggi ce n'e uno:

```
pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA   // PumpSwap, AMM di Pump.fun
```

La pipeline e gia multi-DEX: una subscription per adapter, il program viaggia fino al worker che
risolve il proprio `ACTIVE_ADAPTER`. Aggiungerne uno = implementare `DexAdapter` + una riga nel
registro. Vedi `docs/architecture.md` (DEX Layer).

E il **14%** delle nuove pair Solana: il bot vede solo token gia diplomati dalla bonding curve.
Il 65% delle creazioni che si vedono su gmgn sono lanci su bonding curve, senza pool e con
`initial_liquidity` mediana 0. Dettagli e piano di espansione in `docs/expansion-sources-2026-09-12.md`.

## Deploy

**La vecchia macchina (`/home/manu`, systemd --user) non esiste piu.** Usare Docker:

```bash
cp .env.example .env      # poi riempire SVS_UNSTAKED_RPC
docker compose up -d --build
docker compose logs -f sniper
```

Due servizi: `sniper` (il bot) e `report` (il daemon che genera `logs/paper-report.json`).
`blacklists/` e `logs/` sono bind mount: il dynamic funder rug tracking **riscrive**
`funder-counts.json` e `creators.txt` a runtime, quel path deve persistere.

Sequenza per un cambio di config: build → stop servizi → backup e reset log/report → start.
**Prima di resettare fare sempre** `cp logs/paper-report.json logs/paper-report-YYYY-MM-DD.json`.
File da resettare: `paper.log`, `logs/paper-report.{json,txt}`, `logs/paper-report-daemon.log`,
tutti i `logs/paper-worker-*.log`.

### RPC

Un solo env var, provider-agnostico: `SVS_UNSTAKED_RPC`.

**Endpoint verificati** (con `scripts/rpc-smoke-test.js`, 2026-09-12):

| Endpoint | logsSubscribe | Esito |
|---|---|---|
| `https://solana-rpc.publicnode.com` | si | **usato**, 71 req/s, 0 rate-limit, nessuna registrazione |
| `https://api.mainnet-beta.solana.com` | si | 1,1 req/s effettivi: inutilizzabile |
| Alchemy free | **no** | l'intera WebSocket API risponde "method not found": nessun metodo pubsub disponibile |
| dRPC free | — | Solana non inclusa nel piano free |

**Il requisito che scarta la maggior parte dei provider e `logsSubscribe`**, non il rate limit:
il bot rileva le nuove pool esattamente da li. Verificare sempre prima di adottare un endpoint.

Il bot e affamato di RPC. Due profili di carico:
- `logsSubscribe` permanente sul program
- raffiche di `getSignaturesForAddress`/`getParsedTransaction` per i deep check creator-risk,
  piu un poll di stato ogni 200ms per ogni hold attivo

Con 2 worker in hold contemporaneo sono **~10 req/s sostenuti solo per l'hold**, prima dei deep check.
Un free tier a 10 RPS (Helius free) satura e va in 429. E gia successo: il 2026-03-29 una chiave e
stata bruciata da 444 resubscribe in 10 ore (WebSocket death spiral, poi risolto con un circuit breaker
in `startLogHealthcheck()` che fa `process.exit(1)` dopo 5 resubscribe a vuoto).

**Prima di adottare un endpoint, verificarlo:** `SVS_UNSTAKED_RPC="https://..." node scripts/rpc-smoke-test.js`.
Controlla che logsSubscribe funzioni davvero, misura la latenza e trova la soglia di 429.

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
