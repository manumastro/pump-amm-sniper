# Controls

Documentazione operativa completa dei controlli del bot.

Obiettivo del file:
- spiegare in modo semplice cosa controlla il bot
- chiarire quali controlli bloccano l'entry e quali invece fanno uscire durante l'hold
- allineare la documentazione alla logica reale del codice attuale

Riferimenti principali:
- config: `src/app/config.ts`
- orchestrazione: `src/pumpAmmSniper.ts`
- creator risk: `src/services/creator-risk/index.ts`
- pre-buy validation: `src/services/paper-trade/preBuyValidation.ts`
- hold monitor: `src/services/paper-trade/holdMonitor.ts`
- token security: `src/services/token-security/index.ts`
- top10: `src/services/top10/index.ts`
- dev holdings: `src/services/dev-holdings/index.ts`

## 1. Mappa veloce

Il bot lavora in 4 fasi:

1. controlli pre-entry base
2. controlli creator risk pre-entry
3. controlli finali immediatamente prima del buy
4. controlli di uscita durante l'hold

In pratica:
- se fallisce un controllo pre-entry, il bot fa `SKIP`
- se il buy e gia avvenuto, i controlli hold fanno `EXIT`
- alcuni controlli creator risk vengono rieseguiti anche durante l'hold

## 2. Flusso reale del bot

Per ogni nuovo `create_pool` il bot esegue:

1. parse della tx e risoluzione di token / pool / creator
2. check liquidita minima
3. check token security (mint authority / freeze authority)
4. check creator risk
5. attesa pre-buy + flow gate
6. revalidation finale pre-buy
7. check Top 10
8. buy simulato/live
9. monitor hold con uscite protettive
10. check dev holdings

## 3. Stato attuale dei controlli creator-risk

### Attivi ora

Controlli creator-risk ON in config:

- `CREATOR_RISK_CHECK_ENABLED`
- `CREATOR_RISK_FUNDER_CLUSTER_ENABLED`
- `CREATOR_RISK_STANDARD_POOL_MICRO_BLOCK_ENABLED`
- `CREATOR_RISK_STANDARD_POOL_OUTBOUND_HEAVY_BLOCK_ENABLED`
- `CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_BLOCK_ENABLED`
- `CREATOR_RISK_SPRAY_OUTBOUND_BLOCK_ENABLED`
- `CREATOR_RISK_INBOUND_SPRAY_BLOCK_ENABLED`
- `CREATOR_RISK_SETUP_BURST_BLOCK_ENABLED`
- `CREATOR_RISK_CLOSE_ACCOUNT_BURST_BLOCK_ENABLED`
- `CREATOR_RISK_RAPID_DISPERSAL_BLOCK_ENABLED`
- `CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_BLOCK_ENABLED`
- `CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_STRICT_FLOW_ENABLED`
- `CREATOR_RISK_PRECREATE_BURST_BLOCK_ENABLED`
- `CREATOR_RISK_PRECREATE_LARGE_UNIFORM_BLOCK_ENABLED`
- `CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_BLOCK_ENABLED`
- `CREATOR_RISK_CONCENTRATED_INBOUND_BLOCK_ENABLED`
- `CREATOR_RISK_LOOKUP_TABLE_NEAR_CREATE_BLOCK_ENABLED`
- `CREATOR_RISK_REPEAT_CREATE_REMOVE_BLOCK_ENABLED`

### Disattivi ora

Controlli creator-risk OFF in config:

- `CREATOR_RISK_RELAY_FUNDING_ENABLED`
- `CREATOR_RISK_STANDARD_POOL_RELAY_BLOCK_ENABLED`
- `CREATOR_RISK_STANDARD_POOL_RELAY_OUTBOUND_BLOCK_ENABLED`
- `CREATOR_RISK_CREATOR_SEED_RATIO_BLOCK_ENABLED`
- `CREATOR_RISK_DIRECT_AMM_REENTRY_ENABLED`
- `PAPER_CREATOR_RISK_PROBATION_ENABLED`

Nota importante:
- un controllo puo comparire nel report anche quando non e il motivo reale dello skip
- il motivo reale e quello che porta `creatorRisk.ok = false`
- quindi il campo da guardare per capire il blocco vero e il `reason`, non solo i singoli flag nel report

## 4. Controlli pre-entry base

### 4.1 Liquidity check

Scopo:
- evitare pool troppo piccoli

Regola:
- la liquidita in SOL deve essere almeno `MIN_POOL_LIQUIDITY_SOL`

Esito:
- se sotto soglia: `SKIP: low liquidity`

### 4.2 Token security

Scopo:
- evitare token ancora controllabili dal creator/dev

Regole:
- se `REQUIRE_RENOUNCED_MINT = true`, la mint authority deve essere nulla
- se `REQUIRE_NO_FREEZE = true`, la freeze authority deve essere nulla

Esito:
- se fallisce: `SKIP: token security`

### 4.3 Top 10 concentration

Scopo:
- evitare supply troppo concentrata in pochi wallet

Regole:
- calcola la percentuale detenuta dai top 10 holder
- puo escludere il pool se `PRE_BUY_TOP10_EXCLUDE_POOL = true`
- fallisce se supera `PRE_BUY_TOP10_MAX_PCT`
- opzionale: blocca anche se il maggiore holder esterno al pool supera `PRE_BUY_TOP1_EXTERNAL_HOLDER_MAX_PCT`

Esito:
- se supera soglia: `SKIP` con motivo `top10 concentration ...`
- se il dato non e disponibile, il comportamento dipende da `PRE_BUY_TOP10_FAIL_OPEN`

### 4.4 Dev holdings

Scopo:
- evitare token dove il creator trattiene troppo supply

Regola:
- stima la quota del creator dopo `create_pool`
- blocca se `devPct > MAX_DEV_HOLDINGS_PCT`

Esito:
- se enforcement attivo e supera soglia: `SKIP: Dev holds too much ...`

## 5. Creator Risk: come ragiona davvero

Il creator-risk lavora in due livelli:

- `early checks`: veloci, fatti subito
- `deep checks`: piu costosi, fatti dopo

Un creator puo essere bloccato da:
- blacklist diretta
- pattern comportamentali storici o recenti
- cashout sospetti
- pattern di funding o dispersal
- burst tecnici e setup wallet sospetti

Se un check creator-risk blocca:
- il risultato diventa `ok: false`
- il bot fa `SKIP: creator risk`

## 6. Elenco completo dei controlli creator-risk

### 6.1 Historical rug blacklist

Blocca se:
- il creator e gia nella blacklist storica dei rug

Motivo tipico:
- `creator in historical rug blacklist`

### 6.2 Funder blacklisted / suspicious infra

Blocca se:
- il funder e gia noto in rug history
- oppure il funder e legato a infrastruttura sospetta nota

Motivi tipici:
- `funder blacklisted ...`
- `funder linked to suspicious infra ...`

### 6.3 Micro-burst source blacklisted

Blocca se:
- una source dei micro inbound e gia nota come wallet sospetto

Motivo tipico:
- `micro-burst source blacklisted ...`

### 6.4 Fresh-funded high-seed

Blocca se:
- il creator ha ricevuto funding fresco rilevante poco prima del create
- il seed del creator e molto alto rispetto alla liquidita del pool
- il numero di counterparties resta basso entro soglia

Effetto aggiuntivo:
- puo anche attivare `strictPreEntryFlowRequired`

Motivo tipico:
- `fresh-funded high-seed creator ...`

### 6.5 Creator seed ratio

Stato:
- attualmente OFF

Quando sarebbe attivo:
- bloccherebbe creator con seed troppo piccolo rispetto alla liquidita osservata

Motivo tipico:
- `creator seed too small ...`

### 6.6 Micro inbound burst

Blocca se:
- molti micro-transfer inbound verso il creator
- da abbastanza source
- in una finestra temporale stretta

Motivo tipico:
- `micro inbound burst ...`

### 6.7 Inbound collector pattern

Blocca se:
- molti inbound simili da molte source verso il creator
- distribuzione compatta / poco naturale

Motivo tipico:
- `inbound collector pattern ...`

### 6.8 Spray outbound pattern

Blocca se:
- il creator manda molti transfer simili a molte destinazioni

Motivo tipico:
- `spray outbound pattern ...`

### 6.9 Repeated create-remove pattern

Blocca se:
- il creator mostra schema ripetuto `create_pool -> remove_liquidity -> cashout`

Motivo tipico:
- `creator repeated create-remove pattern ...`

### 6.10 Standard pool micro burst

Blocca se:
- il pool rientra nella fascia standard monitorata
- e il creator mostra micro-burst inbound su quella fascia

Motivo tipico:
- `standard pool micro burst ...`

### 6.11 Standard pool outbound-heavy creator history

Blocca se:
- pool standard
- counterparties alte
- tante uscite
- pochissimi ingressi

Motivo tipico:
- `standard pool outbound-heavy creator history ...`

### 6.12 Funder cluster

Blocca se:
- lo stesso funder compare in molti creator rug storici
- oppure compare su molti creator recenti in finestra breve

Motivi tipici:
- `funder cluster historical ...`
- `funder cluster recent ...`

### 6.13 Linked to historical rug creator

Blocca se:
- dalle istruzioni emerge collegamento diretto a creator gia noti come rug

Motivo tipico:
- `linked to historical rug creator ...`

### 6.14 Creator refunded funder

Blocca se:
- il creator rimanda SOL al proprio funder oltre soglia

Motivo tipico:
- `creator refunded funder ...`

### 6.15 Unique counterparties

Blocca se:
- `uniqueCounterparties NOT IN CREATOR_RISK_WHITELISTED_CC_VALUES`

Stato pratico attuale:
- whitelist: `0,1,2,4,47`
- blocca tutto tranne i valori in whitelist

Motivo tipico:
- `unique counterparties X not in whitelist`

### 6.16 Compressed activity

Blocca se:
- molte counterparties in finestra molto corta

Motivo tipico:
- `compressed activity ...`

### 6.17 Burner profile

Blocca se:
- quasi nessun inbound
- poche uscite ma grosse
- pattern da wallet burner/operativo

Motivo tipico:
- `burner profile out=...`

### 6.18 Precreate uniform outbound burst

Blocca se:
- prima del create ci sono molte uscite simili verso molte destinazioni

Motivo tipico:
- `precreate uniform outbound burst ...`

### 6.19 Precreate large uniform outbound burst

Blocca se:
- come sopra, ma con importi piu grandi e molto uniformi

Motivo tipico:
- `precreate large uniform outbound burst ...`

### 6.20 Precreate dispersal + setup burst

Blocca se:
- pattern dispersal precreate
- seguito da burst di setup/create

Motivo tipico:
- `precreate dispersal + setup burst ...`

### 6.21 Concentrated inbound funding

Blocca se:
- funding inbound concentrato da poche source
- insieme a setup burst e repeat-create

Motivo tipico:
- `concentrated inbound funding ...`

### 6.22 Lookup-table + setup burst

Blocca se:
- `lookupTables >= soglia`
- `creates >= soglia`
- `windowSec <= soglia`

Importante:
- non basta avere tanti `create`
- servono anche i lookup tables vicini nel tempo

Motivo tipico:
- `lookup-table + setup burst ...`

### 6.23 Setup burst

Blocca se:
- troppe create/mint ops in poco tempo

Motivo tipico:
- `setup burst ...`

### 6.24 Close-account burst

Blocca se:
- molte chiusure account in poco tempo

Motivo tipico:
- `close-account burst ...`

### 6.25 Rapid dispersal

Blocca se:
- c'e `rapidDispersal.detected`
- e in piu vale almeno una di queste:
  - c'e gia `creatorCashout.totalSol > 0`
  - la dispersal pesa almeno `CREATOR_RISK_RAPID_DISPERSAL_MIN_PCT_OF_ENTRY_LIQ` sulla liquidita di entry

Questa e una modifica recente importante.

Prima:
- di fatto era molto piu permissivo
- il blocco forte dipendeva troppo dal cashout

Ora:
- puo bloccare anche senza cashout, se la dispersal e severa rispetto alla liquidita del pool

Motivo tipico:
- `rapid creator dispersal ...`

### 6.26 Creator cashout

Blocca se:
- il cashout del creator produce score abbastanza alto

Motivo tipico:
- `creator cashout ...`

### 6.27 Relay funding recent on standard pool

Stato pratico:
- il blocco standard-pool relay resta attivo nel ramo finale quando `relayFunding.detected` e il pool e standard-risk
- ma i toggle relay principali sono attualmente OFF, quindi questa famiglia va trattata con cautela quando si legge la config

Motivo tipico:
- `relay funding recent on standard pool ...`

### 6.28 Relay funding recent + micro burst

Blocca se:
- relay funding rilevato
- insieme a micro burst inbound

Motivo tipico:
- `relay funding recent + micro burst ...`

### 6.29 Relay funding root blacklisted

Blocca se:
- il root del relay funding e gia blacklisted

Motivo tipico:
- `relay funding root blacklisted ...`

### 6.30 Direct AMM re-entry

Stato:
- attualmente OFF

Quando attivo:
- blocca se il creator torna a toccare direttamente l'AMM dopo il create

Motivo tipico:
- `creator direct AMM re-entry ...`

## 7. Pre-buy wait e revalidation finale

Questa fase serve a evitare di comprare troppo presto.

### 7.1 Wait / flow gate

Scopo:
- aspettare il primo trade reale del pool
- non entrare immediatamente sul create

Controlli principali:
- `PRE_BUY_WAIT_MS`
- `PRE_BUY_SIGNAL_MIN_TRADES`
- conferme multiple

### 7.2 Final creator-risk recheck

Scopo:
- rifare creator-risk subito prima del buy

Se fallisce:
- il buy viene annullato

Motivo tipico:
- `creator risk recheck (...)`

### 7.3 Final remove-liquidity recheck

Scopo:
- evitare entry se il creator ha gia iniziato remove liquidity

Se rilevato:
- entry bloccata

Motivo tipico:
- `remove liquidity detected before entry ...`

### 7.4 Liquidity revalidation

Scopo:
- evitare entry se la liquidita e peggiorata troppo rispetto alla baseline

Blocca se:
- la liquidita corrente scende sotto la soglia minima
- oppure scende troppo rispetto alla baseline pre-entry

Motivo tipico:
- `liquidity ... below revalidation threshold`

### 7.5 Ultra-short rug guard

Scopo:
- osservare il pool per una piccola finestra finale prima del buy

Blocca se in quella finestra:
- la liquidita crolla troppo
- oppure la quote peggiora troppo

Motivi tipici:
- `ultra-short rug guard liquidity drop ...`
- `ultra-short rug guard quote drop ...`

### 7.6 Quote sanity check

Scopo:
- evitare buy se la quote e troppo distante dallo spot

Motivo tipico:
- `quote sanity ...x spot`

### 7.7 No-WSOL guard (semplificata)

Scopo:
- evitare ingressi su pool senza lato WSOL

Comportamento:
- se manca WSOL → **SKIP immediato** (niente retry)
- se `FORCE_ENTRY_ON_NO_WSOL_SIDE=true` (oggi `false`) può bypassare in best-effort

Controlli rilevanti:
- `FORCE_ENTRY_ON_NO_WSOL_SIDE`

### 7.8 Deferred no-WSOL queue (postuma)

Scopo:
- recuperare pool che al primo passaggio non espongono ancora il lato WSOL, ma lo mostrano poco dopo

Stato attuale:
- disattivata (`DEFERRED_NO_WSOL_QUEUE_ENABLED=false`)

Comportamento:
- quando un evento chiude con `SKIP: no WSOL side`, viene scritto un candidato in coda postuma
- il supervisor process legge la coda, rifa check WSOL con retry temporizzato
- se il check on-chain resta negativo ma DexScreener mostra pair WSOL (stesso pool o best pair), puo sbloccare il redispatch
- se WSOL compare entro finestra, redispatcha la stessa signature a un worker libero
- il replay non bypassa i controlli: rifanno il flusso standard pre-entry (token security, creator risk, liquidity, pre-buy)

Config runtime dedicata:
- `DEFERRED_NO_WSOL_QUEUE_ENABLED`
- `DEFERRED_NO_WSOL_QUEUE_MAX_JOBS`
- `DEFERRED_NO_WSOL_INITIAL_DELAY_MS`
- `DEFERRED_NO_WSOL_MAX_ATTEMPTS`
- `DEFERRED_NO_WSOL_BASE_INTERVAL_MS`
- `DEFERRED_NO_WSOL_BACKOFF_MULTIPLIER`
- `DEFERRED_NO_WSOL_MAX_INTERVAL_MS`
- `DEFERRED_NO_WSOL_MAX_AGE_MS`

Tuning attuale:
- finestra postuma estesa: fino a ~5 minuti (`MAX_AGE_MS=300000`)
- retry postumi aumentati (`MAX_ATTEMPTS=14`) con backoff e cap a 30s

File operativi:
- coda candidati: `logs/no-wsol-deferred-queue/*.json`
- log manager/queue: `logs/no-wsol-deferred.log`

Metriche report dedicate (`paper-report.json` / `paper-report.txt`):
- `noWsolSkipCount`
- `noWsolRetryEvents`
- `noWsolRetryRecoveredCount`
- `noWsolRetryExhaustedCount`
- `noWsolRetryAttemptsTotal`

## 8. Controlli durante l'hold

Una volta entrato, il bot continua a difendersi.

### 8.1 Remove liquidity exit

Esce se:
- rileva remove liquidity verso il creator

Exit reason:
- `remove liquidity`

### 8.2 Creator AMM burst

Esce se:
- il creator tocca ripetutamente l'AMM entro finestra breve

Exit reason:
- `creator amm burst`

### 8.3 Creator risk recheck

Esce se:
- il creator-risk peggiora dopo l'entry

Exit reason:
- `creator risk: ...`

Nota: il recheck è ora attivo (`HOLD_CREATOR_RISK_RECHECK_ENABLED: true`). Le rug loss senza `entryFilters` nel report sono dovute a un bug di logging (il bot supera i controlli ma il log "✅ Checks passed" non viene catturato). È stato aggiunto un controllo esplicito per bloccare l'ingresso se i controlli falliscono.

Intervallo recheck: `HOLD_CREATOR_RISK_RECHECK_INTERVAL_MS = 1500ms` (era 5000ms, ridotto 2026-03-28 per rilevare rug 3.3x piu veloce).

**Analisi sub-trigger "unique counterparties" nel recheck (2026-03-28):**

Il recheck riesegue lo stesso `runCheck` del pre-entry. Il sub-trigger piu frequente e "unique counterparties N not in whitelist". Dall'analisi di 120 win + 11 loss:

- 95/120 win (79%) escono per `unique counterparties` nel recheck, con median PnL 1.89%
- 0/11 loss escono per `unique counterparties` (tutte le loss avevano recheck disabilitato)
- I win che NON escono per UC hanno median PnL 43.34% (22x meglio)
- Pattern dominante: entry cc=4 (ok) -> recheck cc=1 (non in whitelist) -> exit forzato

Dato chiave: non abbiamo controffattuale diretto (le loss avevano recheck OFF), ma i dati suggeriscono che il trigger UC nel recheck taglia soprattutto win legittimi. Gli altri trigger recheck (spray, close-account, outbound, cashout) sono quelli che proteggono davvero dai rug.

**Decisione applicata (2026-03-28):** disabilitato il sub-trigger UC **solo nel recheck** tramite `skipUniqueCounterparties: true` passato come opzione al `runCheckWithRetry`. Il check UC resta attivo al pre-entry. Tutti gli altri sub-trigger recheck (spray, close-account, outbound, cashout, compressed, burner, ecc.) restano attivi durante l'hold.

### 8.4 Winner management

Serve a proteggere i winner e i pump rapidi.

Puo uscire in due modi:
- `winner take profit`
- `winner trailing stop`

Regole importanti recenti:
- token CP=1 hanno TP piu alto
- token CP=0 hanno trailing allineato al trailing principale (15%) per evitare uscite premature su slow rug
- check winner piu frequente (`HOLD_WINNER_CHECK_INTERVAL_MS = 200ms`) per ridurre slippage tra picco e uscita
- ciclo hold piu frequente (poll interno allineato ai check veloci) per intercettare prima i dump rapidi

Soglie attuali (aggiornate 2026-03-28):
- `HOLD_WINNER_ARM_PNL_PCT = 10` (era 6, alzato per non armare il trailing su micro-profitti)
- `HOLD_WINNER_TRAILING_DROP_PCT = 20` (era 15, allargato per dare piu spazio alla volatilita dei winner)
- `HOLD_WINNER_TRAILING_DROP_PCT_CP0 = 15` (era 8, allineato al vecchio trailing principale)
- `HOLD_WINNER_CHECK_INTERVAL_MS = 200` (era 250, piu reattivo)
- `HOLD_WINNER_HARD_TAKE_PROFIT_PCT = 100`
- `HOLD_WINNER_MIN_PEAK_SOL = 0.0104`

### 8.5 Sell quote collapse

Esce se:
- la quote di uscita crolla troppo rispetto alla baseline
- oppure scende sotto un floor minimo in SOL

Exit reason:
- `sell quote collapse`

Soglia attuale:
- `HOLD_SELL_QUOTE_COLLAPSE_DROP_PCT = 35`

### 8.11 Single swap shock

Esce se:
- tra due campioni consecutivi la `sell quote` crolla oltre soglia in pochi istanti

Scopo:
- intercettare dump violenti da whale/wallet esterni anche quando il creator-risk resta pulito

Exit reason:
- `single swap shock`

Soglia attuale:
- `HOLD_SINGLE_SWAP_SHOCK_DROP_PCT = 35`
- `HOLD_SINGLE_SWAP_SHOCK_CHECK_INTERVAL_MS = 300ms`

### 8.12 Hard stop loss

Esce se:
- il PnL stimato in hold scende sotto una perdita massima assoluta

Scopo:
- imporre un limite hard alla perdita intra-trade anche quando gli altri trigger arrivano in ritardo

Controllo frequenza:
- `HOLD_HARD_STOP_LOSS_CHECK_INTERVAL_MS = 250ms`

Exit reason:
- `hard stop loss`

Soglia attuale:
- `HOLD_HARD_STOP_LOSS_PCT = 15`

### 8.6 Pool churn

Esce se:
- il pool mostra attivita troppo intensa e insieme calo quote significativo

Exit reason:
- `pool churn`

### 8.7 Creator outbound

Esce se:
- il creator manda grosse uscite durante hold

Exit reason:
- `creator outbound`

### 8.8 Creator close-account burst

Esce se:
- il creator chiude molti account in poco tempo

Exit reason:
- `creator close-account burst`

### 8.9 Creator outbound spray

Esce se:
- il creator in hold distribuisce a molte destinazioni con pattern da spray

Exit reason:
- `creator outbound spray`

### 8.10 Creator inbound spray

Esce se:
- il creator riceve molti inbound coordinati durante hold

Exit reason:
- `creator inbound spray`

## 9. Probation

Stato attuale:
- `PAPER_CREATOR_RISK_PROBATION_ENABLED = false`

Quindi oggi:
- in pratica non c'e bypass paper-only standard del creator-risk

Se verra riattivata:
- alcuni risk non faranno skip immediato ma forzeranno hold corto e controlli piu aggressivi

## 10. Come leggere i log senza confondersi

Regola pratica:
- il log diagnostico mostra tanti segnali
- ma il blocco vero e il primo che produce `ok: false`

Quindi per capire perche un token e stato saltato:

1. guarda `SKIP: ...`
2. se e `SKIP: creator risk`, guarda il `reason`
3. usa i `FILTERS` solo come supporto, non come verita assoluta del blocco

Importante dopo le ultime patch:
- il report e piu allineato alla logica reale
- `rapidDispersal` e `lookupTable` non vanno piu letti in modo fuorviante come prima

## 11. Ultime modifiche rilevanti ai controlli

Negli ultimi giorni sono cambiate soprattutto queste cose:

- filtro CP reso molto severo: oggi blocca gia da `uniqueCounterparties >= 2`
- `seed ratio` disattivato
- `direct AMM re-entry` disattivato ma fixato il rispetto del toggle
- introdotta guardia pre-buy ultra-short anti rug rapido
- `rapidDispersal` irrigidito: ora puo bloccare anche senza cashout se la dispersal e alta rispetto alla liquidita entry
- winner management differenziato per classi CP
- hard stop loss intra-hold introdotto (`hard stop loss`)
- soglie anti dump irrigidite (`single swap shock` e `sell quote collapse` a 35%)
- frequenza check winner aumentata (300ms)
- introdotto retry breve no-WSOL pre-entry con metriche dedicate nel report
- reporting dei filtri e analisi rug resi piu coerenti con la logica reale
- fix runtime e report per evitare eventi duplicati o fantasma

## 12. Checklist pratica quando analizzi un rug o uno skip

Se vuoi capire un caso velocemente:

1. controlla `endStatus` e `skipReason`
2. se e `creator risk`, leggi il `reason`
3. guarda `entryFilters` solo dopo, per contesto
4. se c'e stato buy, guarda `holdLog.exitReason`
5. controlla se l'uscita e stata da:
   - `sell quote collapse`
   - `winner trailing stop`
   - `creator risk recheck`
   - `remove liquidity`
   - `pool churn`

## 13. File chiave da consultare quando cambi i controlli

- regole e soglie: `src/app/config.ts`
- blocchi creator-risk: `src/services/creator-risk/index.ts`
- snapshot/report dei filtri: `src/pumpAmmSniper.ts`
- controlli immediati prima del buy: `src/services/paper-trade/preBuyValidation.ts`
- uscite durante hold: `src/services/paper-trade/holdMonitor.ts`
- report runtime: `scripts/paper-report-daemon.js`
- analisi rug: `scripts/rug-analysis.js`

## 14. Tabella compatta finale

### Controlli pre-entry

| Controllo | Fase | Stato | Azione | Motivo tipico |
| --- | --- | --- | --- | --- |
| Liquidity minima | pre-entry | ON | skip | `low liquidity` |
| Token security | pre-entry | ON | skip | `token security` |
| Creator risk globale | pre-entry | ON | skip | `creator risk (...)` |
| Pre-buy wait / flow gate | pre-entry | ON | skip | `pre-entry wait` |
| Final creator-risk recheck | pre-buy finale | ON | skip | `creator risk recheck (...)` |
| Final remove-liq recheck | pre-buy finale | ON | skip | `remove liquidity detected before entry ...` |
| Liquidity revalidation | pre-buy finale | ON | skip | `liquidity ... below revalidation threshold` |
| Ultra-short rug guard | pre-buy finale | ON | skip | `ultra-short rug guard ...` |
| Quote sanity | pre-buy finale | ON | skip | `quote sanity ...x spot` |
| No-WSOL grace recheck | pre-buy finale | ON | retry->fail-open/skip | `pool has no WSOL side (...)` |
| Deferred no-WSOL queue | post-skip runtime | OFF | recheck->redispatch/expire | `SKIP: no WSOL side` -> queue |
| Top10 concentration | pre-entry finale | ON | skip | `top10 concentration ...` |
| Top1 external holder concentration | pre-entry finale | ON | skip | `top1 external holder concentration ...` |
| Dev holdings | post-resolve / gate | ON | skip | `Dev holds too much ...` |

### Controlli creator-risk pre-entry

| Controllo | Stato | Blocca davvero? | Motivo tipico |
| --- | --- | --- | --- |
| Historical rug blacklist | ON | si | `creator in historical rug blacklist` |
| Funder blacklisted | ON | si | `funder blacklisted ...` |
| Funder suspicious infra | ON | si | `funder linked to suspicious infra ...` |
| Micro-burst source blacklisted | ON | si | `micro-burst source blacklisted ...` |
| Fresh-funded high-seed | ON | si | `fresh-funded high-seed creator ...` |
| Creator seed ratio | OFF | no | `creator seed too small ...` |
| Micro inbound burst | ON | si | `micro inbound burst ...` |
| Inbound collector pattern | ON | si | `inbound collector pattern ...` |
| Spray outbound pattern | ON | si | `spray outbound pattern ...` |
| Repeated create-remove | ON | si | `creator repeated create-remove pattern ...` |
| Standard pool micro | ON | si | `standard pool micro burst ...` |
| Standard pool outbound-heavy | ON | si | `standard pool outbound-heavy creator history ...` |
| Funder cluster | ON | si | `funder cluster historical ...` / `recent ...` |
| Linked to rug creator | ON | si | `linked to historical rug creator ...` |
| Creator refunded funder | ON | si | `creator refunded funder ...` |
| Unique counterparties | ON | si | `unique counterparties X not in whitelist` |
| Compressed activity | ON | si | `compressed activity ...` |
| Burner profile | ON | si | `burner profile ...` |
| Precreate burst | ON | si | `precreate uniform outbound burst ...` |
| Precreate large uniform | ON | si | `precreate large uniform outbound burst ...` |
| Precreate dispersal + setup | ON | si | `precreate dispersal + setup burst ...` |
| Concentrated inbound funding | ON | si | `concentrated inbound funding ...` |
| Lookup-table + setup burst | ON | si | `lookup-table + setup burst ...` |
| Setup burst | ON | si | `setup burst ...` |
| Close-account burst | ON | si | `close-account burst ...` |
| Rapid dispersal | ON | si | `rapid creator dispersal ...` |
| Creator cashout | ON | si | `creator cashout ...` |
| Relay funding recent on standard pool | parziale | dipende | `relay funding recent on standard pool ...` |
| Relay funding recent + micro burst | parziale | dipende | `relay funding recent + micro burst ...` |
| Relay funding root blacklisted | parziale | dipende | `relay funding root blacklisted ...` |
| Direct AMM re-entry | OFF | no | `creator direct AMM re-entry ...` |

### Controlli hold / exit

| Controllo | Fase | Stato | Azione | Exit reason |
| --- | --- | --- | --- | --- |
| Remove liquidity | hold | ON | exit | `remove liquidity` |
| Creator AMM burst | hold | ON | exit | `creator amm burst` |
| Creator risk recheck | hold | ON | exit | `creator risk: ...` |
| Winner take profit | hold | ON | exit | `winner take profit` |
| Winner trailing stop | hold | ON | exit | `winner trailing stop` |
| Hard stop loss | hold | ON | exit | `hard stop loss` |
| Sell quote collapse | hold | ON | exit | `sell quote collapse` |
| Single swap shock | hold | ON | exit | `single swap shock` |
| Pool churn | hold | ON | exit | `pool churn` |
| Creator outbound | hold | ON | exit | `creator outbound` |
| Creator close-account burst | hold | ON | exit | `creator close-account burst` |
| Creator outbound spray | hold | ON | exit | `creator outbound spray` |
| Creator inbound spray | hold | ON | exit | `creator inbound spray` |
| Hold timeout | hold | ON | exit | `hold timeout` |

## 15. Changelog tuning 2026-03-28

### Modifiche applicate

| Parametro | Prima | Dopo | Motivo |
| --- | --- | --- | --- |
| `HOLD_WINNER_CHECK_INTERVAL_MS` | 250 | 200 | Check piu reattivi sui vincenti |
| `HOLD_CREATOR_RISK_RECHECK_INTERVAL_MS` | 5000 | 1500 | Rug detection 3.3x piu veloce |
| `HOLD_WINNER_TRAILING_DROP_PCT_CP0` | 8 | 15 | Allineato al vecchio trailing principale, evita uscite premature |
| `HOLD_WINNER_ARM_PNL_PCT` | 6 | 10 | Non arma trailing su micro-profitti; lascia correre i winner |
| `HOLD_WINNER_TRAILING_DROP_PCT` | 15 | 20 | Piu spazio per volatilita prima di uscire sui winner |

### Analisi dati a supporto (228 trade baseline)

Problema iniziale: median win PnL 2.45%, 75% dei win sotto 10%.
Causa: 79% dei win tagliati dal recheck "unique counterparties" con median PnL 1.89%.
Win che NON escono per UC: median PnL 43.34%.

Test fallito (commit 255a51d): RECHECK disabilitato completamente -> 11/15 trade in loss (median -93.72%). Revertito con 649913e.

Conclusione: RECHECK essenziale per protezione rug, ma il sub-trigger "unique counterparties" e il principale responsabile delle uscite premature sui win. Gli altri sub-trigger (spray, close-account, outbound, cashout) proteggono davvero.

### Decisioni applicate

- Sub-trigger UC disabilitato nel recheck tramite `skipUniqueCounterparties: true` (modifica codice in `src/domain/types.ts`, `src/services/creator-risk/index.ts`, `src/pumpAmmSniper.ts`)
- UC resta attivo al pre-entry: continua a bloccare creator sospetti prima del buy
- Tutti gli altri sub-trigger recheck restano attivi: spray, close-account, outbound, cashout, compressed, burner, ecc.
- Raccolta dati in corso con nuovo config per validare impatto complessivo
