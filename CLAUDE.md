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

Due env var, entrambe provider-agnostiche:

```bash
SVS_UNSTAKED_RPC=https://solana-rpc.publicnode.com                  # letture HTTP
SVS_UNSTAKED_WS=wss://solana-mainnet.core.chainstack.com/<node-id>  # subscription (opzionale)
```

Senza `SVS_UNSTAKED_WS` il WebSocket viene derivato dall'HTTP, come prima.

**Perche separarli.** I due carichi sono opposti — una connessione permanente da un lato,
raffiche da decine di req/s dall'altro — e nessun provider gratuito e buono su entrambi:

| Endpoint | logsSubscribe | HTTP | Esito |
|---|---|---|---|
| `https://solana-rpc.publicnode.com` | parziale | 218 req/s, archive ok, 250ms | **usato per HTTP** |
| Chainstack free (nodo Elastic) | completo, primo log ~500ms | **niente archive** | **usato per WS** |
| `wss://api.mainnet-beta.solana.com` | completo | 1,1 req/s | ripiego per il WS |
| Alchemy free | **no** | archive ok, **58ms**, 25 req/s | HTTP ottimo, WS assente |
| dRPC free | — | — | Solana non inclusa nel piano free |

**Chainstack free blocca i metodi archive** (`getSignaturesForAddress`, `getParsedTransaction`)
con `403 -32002 "Archive, Debug and Trace requests are not available"`. Le letture di account
funzionano, quindi i poll di hold girerebbero, ma **i 30 controlli creator-risk no**: sono costruiti
sulla storia delle transazioni. Ottimo come WebSocket, inutilizzabile come `SVS_UNSTAKED_RPC`.

**Alchemy free e il contrario:** in HTTP e il piu veloce misurato (58ms contro i 250ms di
publicnode, archive incluso, 12/12 senza rate limit a ritmo sequenziale), ma **ogni metodo pubsub
risponde "method not found"** — `logsSubscribe`, `programSubscribe`, `accountSubscribe`,
`slotSubscribe`. La documentazione Alchemy elenca i WebSocket su tutti i piani, quindi la causa non
e chiara e **non e detto che un piano a pagamento la risolva**. Il limite del free e 25 req/s, il
PAYG sale a 300.

⚠️ **Alchemy restituisce un array vuoto, senza errore, su `getSignaturesForAddress` di un program
id** ad altissimo volume. Su wallet e pool risponde correttamente, ed e l'unica cosa che il bot
interroga davvero (`grep getSignaturesForAddress src/`: sempre creator, funder o pool) — quindi non
lo scarta. Ma e il terzo endpoint in un giorno che **risponde "ok" senza dare i dati**, ed e la
ragione per cui la fase 3 dello smoke test ora conta anche le risposte vuote.

⚠️ **"parziale" significa che publicnode accetta la subscription e non consegna niente** per il
program Meteora DAMM v2. Misurato il 2026-09-12: 0 eventi in 45s, contro 6.026 dello stesso program
su mainnet-beta nella stessa finestra, mentre pumpswap e ray_v4 arrivavano regolarmente sulla stessa
connessione. Nessun errore, nessun log: quel DEX sarebbe stato semplicemente invisibile.

`getProgramAccounts` su publicnode risponde 403 (richiede un token), e anche
`getMultipleAccountsInfo` con troppi account in una volta. Il bot non usa il primo, e il secondo
passa da `getAccountsChunked()`. Non e un problema, ma spiega i 403 se compaiono.

**Prima di adottare un endpoint, verificarlo:** `SVS_UNSTAKED_RPC="https://..." node scripts/rpc-smoke-test.js`.
La fase 2 prova **tutti** i program registrati, proprio per far emergere i buchi silenziosi come
quello sopra; poi misura la latenza e trova la soglia di 429.

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
