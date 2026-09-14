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
- whitelist: `0,2,4,47`
- blocca tutto tranne i valori in whitelist
- cp=1 RIMOSSO dalla whitelist (2026-04-02): 43.6% WR con 20 rug su 39 trade, funder=N/A non tracciabile

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

Puo uscire in tre modi:
- `winner take profit`
- `winner trailing stop`
- `winner profit floor`

Regole importanti recenti:
- token CP=1 hanno TP piu alto
- token CP=0 hanno trailing allineato al trailing principale (15%) per evitare uscite premature su slow rug
- check winner piu frequente (`HOLD_WINNER_CHECK_INTERVAL_MS = 200ms`) per ridurre slippage tra picco e uscita
- ciclo hold piu frequente (poll interno allineato ai check veloci) per intercettare prima i dump rapidi
- profit floor: una volta che il winner e armato (peakPnl >= armPnlPct), se il PnL scende sotto `HOLD_WINNER_PROFIT_FLOOR_PCT`, esce subito. Evita che un winner armato a +15% finisca a -70% per un crash istantaneo che il trailing non intercetta.

Soglie attuali (aggiornate 2026-03-29):
- `HOLD_WINNER_ARM_PNL_PCT = 8` (era 10, abbassato per armare anche winner che raggiungono solo +8-10%)
- `HOLD_WINNER_TRAILING_DROP_PCT = 10` (era 20; con 20% il trailing era inutile sotto peak ~29% — il profit floor usciva sempre prima a +3%. Con 10% il trailing e attivo gia da peak ~14.5%)
- `HOLD_WINNER_TRAILING_DROP_PCT_CP0 = 10` (allineato al trailing principale)
- `HOLD_WINNER_CHECK_INTERVAL_MS = 200` (era 250, piu reattivo)
- `HOLD_WINNER_HARD_TAKE_PROFIT_PCT = 50` (era 100; con 100% non scattava mai. 50% cattura i trade che fanno 1.5x)
- `HOLD_WINNER_HARD_TAKE_PROFIT_PCT_CP1 = 50` (allineato)
- `HOLD_WINNER_MIN_PEAK_SOL = 0.0104`
- `HOLD_WINNER_PROFIT_FLOOR_PCT = 3` (floor minimo di profitto per winner armati)

Nota: il trailing drop e RELATIVO al peak (drawdown = (peak - current) / peak), non assoluto. Con trailing 10% e peak +20%, il trailing scatta a PnL +8% (non a +10%). Tabella di riferimento:

| Peak PnL | Trailing exit PnL (10%) | Trailing exit PnL (vecchio 20%) |
| --- | --- | --- |
| +15% | +3.5% | -8% (floor: +3%) |
| +20% | +8% | -4% (floor: +3%) |
| +30% | +17% | +4% |
| +50% | +35% | +20% |

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
- **eccezione**: se il trade e un winner armato (peak >= armPnlPct), il profit floor intercetta prima dell'hard stop loss e l'exit reason diventa `winner profit floor` invece di `hard stop loss`

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
| Winner profit floor | hold | ON | exit | `winner profit floor` |
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

## 16. Changelog tuning 2026-03-29

### Modifiche applicate

| Parametro | Prima | Dopo | Motivo |
| --- | --- | --- | --- |
| `HOLD_WINNER_ARM_PNL_PCT` | 10 | 8 | Armava troppo tardi; Loss #1 peaked +9.32% senza armarsi |
| `HOLD_WINNER_PROFIT_FLOOR_PCT` | (nuovo) | 3 | Floor di profitto per winner armati; evita crash istantanei da +15% a -70% |

### Nuova feature: Winner profit floor

Aggiunto un floor di profitto post-arming. Una volta che il trade e "armato" (peakPnl >= armPnlPct), se il PnL corrente scende sotto `HOLD_WINNER_PROFIT_FLOOR_PCT` (3%), esce immediatamente con reason `winner profit floor`.

Motivazione: analisi degli 11 trade della sessione corrente ha mostrato che 2 dei 4 loss erano winner armati (peaked +16%, +15.9%) dove il trailing stop (20% drawdown da peak) non ha intercettato il crash perche il prezzo e crollato istantaneamente (in un singolo intervallo da 200ms) da +15% a -70%. Il trailing avrebbe dovuto uscire a ~-4% ma il crash e stato troppo veloce.

Con profit floor = 3%:
- Loss #2 (peaked +16.09%, exit -70.19%) -> sarebbe uscito a ~+3% = salvato ~73%
- Loss #3 (peaked +15.88%, exit -29.21%) -> sarebbe uscito a ~+3% = salvato ~32%
- Loss #1 (peaked +9.32%, exit -41.68%) -> ora si arma a 8% -> sarebbe uscito a ~+3% = salvato ~45%

### Fix infrastruttura: Healthcheck circuit breaker

Aggiunto circuit breaker al `startLogHealthcheck()` in `src/app/runtime.ts`:
- Conta i resubscribe consecutivi senza ricevere log
- Dopo 5 tentativi consecutivi: `process.exit(1)` per lasciare che systemd riavvii il processo
- Counter resettato quando arriva un log valido
- Previene il death spiral visto il 2026-03-28 (444 resubscribe in 10 ore, zombie state)

### Dati sessione pre-modifica (11 trade, 1h40m)

| Metrica | Valore |
| --- | --- |
| Win rate | 63.6% (7W/4L) |
| Median win | +15.01% |
| Avg loss | -53.34% |
| Total PnL | -0.0104 SOL |
| Break-even win rate needed | 77.3% |

Raccolta dati in corso con nuovo config per validare impatto profit floor.

### Dati sessione post-modifica (43 trade, ~6h)

| Metrica | Valore |
| --- | --- |
| Win rate | 76.7% (33W/10L) |
| Median win | +15.86% |
| Avg win | +23.54% |
| Total PnL | +0.0025 SOL |
| Rug losses | 7 at -100% = -0.0700 SOL |
| Non-rug losses | 3 at -4%/-10%/-38% = -0.0052 SOL |
| Win total | +0.0777 SOL |

Bot e profittevole ma i 7 rug a -100% mangiano quasi tutti i profitti. Analisi dettagliata funder pattern ha portato all'implementazione del dynamic rug tracking.

### Nuova feature: Dynamic funder rug tracking

Quando un paper trade esce con rug (pnlPct <= -80% e exitReason in {remove liquidity, single swap shock, sell quote collapse}), il bot automaticamente:

1. **Incrementa il contatore funder** in `blacklists/funder-counts.json` (read-modify-write atomico)
2. **Aggiunge il creator** a `blacklists/creators.txt` (se non gia presente)
3. **Invalida la cache** rug history del processo corrente (`cachedRugHistoryAtMs = 0`)

Funzione: `recordRugFunder()` in `src/pumpAmmSniper.ts`, chiamata in `handleNewPool()` sia sul path loss che sul path ok (difensivo).

### Config changes per rug tracking

| Parametro | Prima | Dopo | Motivo |
| --- | --- | --- | --- |
| `CREATOR_RISK_HISTORICAL_FUNDER_CLUSTER_MIN_RUG_CREATORS` | 2 | 1 | Un singolo rug runtime blocca immediatamente il funder |
| `RUG_HISTORY_CACHE_TTL_MS` | 300000 (5 min) | 60000 (1 min) | Worker pickup piu rapido dei nuovi blacklist |

### Analisi rug a supporto

Analisi di 7 rug su 43 trade (tutti a -100%):

| Funder | Rugs | Trades | Rug rate | EV/trade |
| --- | --- | --- | --- | --- |
| `Fbm7CY...` | 3 | 12 | 25% | -0.0013 (block) |
| `HbCBfg...` | 2 | 13 | 15% | -0.0003 (block) |
| `3JXy5G...` | 1 | 11 | 9% | +0.0005 (borderline) |
| `CCyYKt...` | 1 | ? | same network as Fbm7CY | block |
| null (no funder) | 1 | 5 | 20% | non-trackable |

- 6/7 rug hanno funder noto → trackable
- Tutti exit via `single swap shock` (5) o `remove liquidity` (1)
- Simulazione "block after 1st rug" → salva 3 rug (-0.03 SOL) ma perde 13 win (+0.021 SOL) → **net +0.009 SOL improvement**
- Break-even rug rate: >15% per funder con avg win 0.0015 SOL e rug loss 0.01 SOL

### Winner management tuning — trailing e take profit

| Parametro | Prima | Dopo | Motivo |
| --- | --- | --- | --- |
| `HOLD_WINNER_TRAILING_DROP_PCT` | 20 | 10 | Con 20% il trailing era inutile sotto peak ~29% — il profit floor usciva sempre prima. Con 10% attivo da peak ~14.5% |
| `HOLD_WINNER_TRAILING_DROP_PCT_CP0` | 15 | 10 | Allineato al trailing principale |
| `HOLD_WINNER_HARD_TAKE_PROFIT_PCT` | 100 | 50 | Con 100% non scattava mai. 50% cattura i trade che fanno 1.5x |
| `HOLD_WINNER_HARD_TAKE_PROFIT_PCT_CP1` | 100 | 50 | Allineato |

Analisi: il trailing drop e calcolato come drawdown relativo (`(peak-current)/peak`), non come differenza assoluta di PnL. Con trailing 20%, un peak di +15% produceva trailing exit a PnL -8%, ben sotto il profit floor di +3%. Quindi per tutta la fascia di peak 8-29% (che include la mediana dei win a +15.86%), il trailing non scattava MAI — usciva sempre il profit floor a +3%, regalando l'80% del profitto di picco.

Con trailing 10%, un peak di +15% produce trailing exit a PnL +3.5%, appena sopra il floor. Un peak di +20% esce a +8%, uno di +30% a +17%. Il miglioramento e sostanziale nella fascia 15-30% dove si concentra la maggior parte dei win.

### Sessione 2: 7 trade (19:28-20:46) — primi risultati TP + trailing

| # | Exit | PnL | Peak | Hold | Funder |
|---|---|---|---|---|---|
| 1 | hold timeout | +16.1% | +19.7% | 965s | `3JXy5G...` |
| 2 | hard stop loss | -43.0% | +48.1% | 258s | `3JXy5G...` |
| 3 | hard stop loss | -16.9% | +15.3% | 77s | `3JXy5G...` |
| 4 | single swap shock | -100% | +3.7% | 101s | `3JXy5G...` |
| 5 | hard stop loss | -18.6% | +33.3% | 150s | `EGfATZ...` |
| 6 | hard stop loss | -100% | +18.9% | 831s | `Fbm7CY...` |
| 7 | winner take profit | +51.2% | +51.2% | 552s | ? |

Key findings: trade #7 first `winner take profit` exit (50% TP works). Trade #6 -100% via `hard stop loss` (rug non tracciato perche exit reason non in `RUG_EXIT_REASONS`). Trades #2/#5 crash da peak +48%/+33% a -43%/-19% in singolo polling interval — trailing stop bypassato.

### Fix: rug tracking ora copre tutti gli exit reason catastrofici

Modificato `recordRugFunder()` in `src/pumpAmmSniper.ts`:
- **Prima**: richiedeva `pnlPct <= -80%` AND `exitReason` in {remove liquidity, single swap shock, sell quote collapse}
- **Dopo**: `pnlPct <= -80%` registra il funder INDIPENDENTEMENTE dall'exit reason; gli exit reason rug registrano anche con loss moderate

Motivazione: trade #6 era un rug chiaro (peak +18.9%, exit -100%) ma non e stato tracciato perche l'exit era `hard stop loss` (il prezzo e crollato cosi velocemente che il hard stop loss ha triggerato prima del single swap shock detection).

### Blacklist funder pre-caricati

Aggiunto alla blacklist statica (`blacklists/funders.txt` e `blacklists/funder-counts.json`) i funder noti dalla sessione 43-trade:
- `Fbm7CYMzBrXHCU5YVijvJWVvdiy5XWhDAybup43eRqCo` (3 rug, 25% rug rate)
- `HbCBfgBgsPCHcfrJbdPECd4te9kXF9P1MpAyezh4kVWu` (2 rug, 15% rug rate)
- `CCyYKtPKFPLR42A8hCwSLfuFE6WD8oWqCKGUFMy5Q` (network Fbm7CY)

Questi funder erano stati identificati ma mai aggiunti — la conversazione si era interrotta a meta dell'operazione.

## 17. Changelog tuning 2026-04-01

### Fix: cp=1 mancante nella whitelist UC

Il default in `src/app/config.ts` era `"0,2,4,47"` — mancava `1`. La documentazione (sezione 6.15) dichiarava `{0,1,2,4,47}` ma il codice non lo rispettava. Risultato: 32 token con cp=1 venivano skippati inutilmente dal filtro UC pre-entry.

**Fix**: default corretto a `"0,1,2,4,47"` in `config.ts:121`.

### Fix: profit floor mai attivato (intercept nell'hard stop loss)

Analisi di 66 trade ha rivelato che il profit floor (`HOLD_WINNER_PROFIT_FLOOR_PCT = 3%`) aveva **zero exit** nonostante 9 armed losses (peak da +9% a +41%) che crollavano a -10%/-100%.

**Root cause**: nel loop hold di `holdMonitor.ts`, l'hard stop loss (L285) viene controllato PRIMA del blocco winner management (L310). In un crash rapido, il prezzo salta da sopra +3% a sotto -15% in un singolo polling interval → l'hard stop loss cattura il trade prima che il profit floor (dentro il blocco winner, L348) abbia la possibilita di intervenire.

**Fix**: dentro il blocco hard stop loss, se il trade e un winner armato (peak >= armPnlPct + minPeakSol), viene controllato il profit floor PRIMA di uscire con hard stop loss. Se le condizioni sono soddisfatte, esce con `winner profit floor` invece di `hard stop loss`. Per trade NON armati, il comportamento resta invariato.

Effetto atteso: i 6/9 armed losses che uscivano via hard stop loss ora usciranno via profit floor. L'exit PnL resta lo stesso (il prezzo e gia sotto -15% al momento del check), ma la classificazione corretta permette di:
- Tracciare correttamente quanti winner armati vengono protetti dal floor
- Distinguere nei report tra hard stop su trade mai armati (veri loss) e crash su winner armati (floor intercept)

## 18. Changelog tuning 2026-04-02

### Revert: cp=1 rimosso dalla whitelist UC

Dopo 55 trade con cp=1 in whitelist, i dati sono catastrofici:

| CP | Trades | WR | Avg PnL | Rug |
|----|--------|-----|---------|-----|
| cp=1 | 39 | 43.6% | -32.6% | 20 rug a -100% |
| cp=0 | 5 | 80.0% | +20.2% | 1 rug |
| cp=2 | 3 | 100% | +51.2% | 0 |
| cp=4 | 8 | 62.5% | +0.03% | 2 rug |

I token cp=1 hanno funder=N/A (non tracciabile), nessuna history utile, e sono prevalentemente wallet usa-e-getta per rug. Il creator risk non riesce a filtrarli.

La sessione precedente (senza cp=1) aveva 72.7% WR e +0.078 SOL. Con cp=1 la sessione e andata a -0.102 SOL.

**Revert**: whitelist torna a `"0,2,4,47"` (senza cp=1). La documentazione in sezione 6.15 e stata aggiornata.

## 19. Changelog strumentazione 2026-09-12

### Price path recorder nell'HOLDLOG

**Problema.** `holdLog` salvava solo un riepilogo del trade: entry, picco, time-to-peak, exit reason, trigger e guard attivi. Il percorso del prezzo durante l'hold non veniva registrato da nessuna parte, nemmeno nei worker log. Conseguenza: le sessioni paper non sono ri-simulabili offline. Con i soli dati storici si puo validare la soglia di take profit (basta il picco), ma **non** il trailing stop, il profit floor o qualsiasi exit anticipata, perche non si sa come il prezzo e arrivato al picco ne quanto ci ha messo a crollare.

**Cosa fa.** `waitForExitStateWithLiquidityStop()` campiona il quote di uscita a ogni lettura di stato e lo accumula in due array paralleli, emessi nell'HOLDLOG sotto `pricePath`:

```json
"pricePath": { "t": [0, 1400, 3200], "q": [0.00993, 0.01102, 0.01041], "samples": 3, "dropped": 0 }
```

- `t` = millisecondi dall'inizio dell'hold
- `q` = SOL ricavabili vendendo l'intera posizione a quell'istante (stesso valore su cui ragionano tutti i trigger di hold)

**Filtro di campionamento.** Il quote resta piatto tra uno swap e l'altro, quindi salvare ogni poll produrrebbe migliaia di punti identici. Un punto viene registrato solo se:
- il prezzo si e mosso di almeno `HOLD_PRICE_PATH_MIN_CHANGE_PCT` rispetto all'ultimo punto salvato, **oppure**
- sono passati `HOLD_PRICE_PATH_HEARTBEAT_MS` dall'ultimo punto (battito, serve a distinguere "prezzo fermo" da "monitor bloccato"), **oppure**
- e un nuovo massimo (i picchi entrano sempre, anche sotto soglia)

Il punto di ingresso (`t=0`) e il punto di uscita entrano sempre. A cap raggiunto (`HOLD_PRICE_PATH_MAX_SAMPLES`) i campioni successivi vengono scartati e contati in `dropped`, ma il prezzo di uscita rimpiazza comunque l'ultimo campione: **il prezzo a cui il trade e stato chiuso non si perde mai**.

**Parametri:**

| Parametro | Valore | Note |
|---|---|---|
| `HOLD_PRICE_PATH_RECORD_ENABLED` | true | a false, `pricePath` e `null` e il comportamento torna identico a prima |
| `HOLD_PRICE_PATH_MAX_SAMPLES` | 3000 | cap per trade |
| `HOLD_PRICE_PATH_MIN_CHANGE_PCT` | 0.05 | soglia di movimento per registrare un punto |
| `HOLD_PRICE_PATH_HEARTBEAT_MS` | 5000 | battito su prezzo piatto |

**Impatto sui controlli:** nessuno. Il recorder e puramente osservativo, non modifica soglie ne decisioni di exit.

**Impatto sui report:** `logs/paper-report.json` cresce (stima ~5-10 MB in piu su una sessione da ~300 trade). Il daemon non richiede modifiche: `pricePath` viene assorbito come parte dell'oggetto `holdLog`.

**Perche serve.** Da qui in avanti ogni sessione paper diventa un dataset ri-simulabile all'infinito: si possono testare offline trailing diversi, floor diversi, exit anticipate e TP condizionati al rischio, senza rimettere il bot in paper per 72h a ogni ipotesi.

---

## 20. Soglia di liquidita configurabile e superficie multi-DEX

**Aggiunto il 2026-09-12.**

### Cosa cambia

`MIN_POOL_LIQUIDITY_SOL` e `MIN_POOL_LIQUIDITY_USD` erano costanti nel codice (20 SOL /
10.000 USD). Ora si leggono da env, con gli stessi valori come default:

```bash
MIN_POOL_LIQUIDITY_SOL=20      # default, invariato
MIN_POOL_LIQUIDITY_USD=10000   # default, invariato
```

**Nessun comportamento cambia se le env non sono impostate.** La soglia resta quella con cui
sono stati prodotti i numeri di aprile.

### Perche

Con tre DEX attivi (`pumpswap`, `ray_v4`, `meteora_damm_v2`) la soglia non descrive piu una
popolazione sola: i pool nascono con profondita diverse a seconda del DEX. Serviva poterla
muovere per una sessione senza ricompilare e senza toccare il codice.

### Come leggere i risultati dopo un cambio

Ogni trade logga `entrySolLiquidity` nell'HOLDLOG (vedi sezione 19), quindi una sessione con
soglia bassa **resta segmentabile per fascia di liquidita a posteriori**: si puo ricostruire
quale sarebbe stato il PnL a 20 SOL, a 10, a 5, dalla stessa sessione. Abbassare la soglia
aggiunge dati, non li sostituisce.

⚠️ **Ma non e gratis.** Vale la lezione della sezione su `cp=1` (whitelist unique-counterparties,
2026-04-01): allentare un filtro pre-entry ha gia prodotto 43,6% WR e 20 rug su 39 trade. Un pool
con poca liquidita e piu facile da svuotare e piu facile da manipolare, e il crash da
`remove liquidity` e atomico. Una sessione a soglia bassa va letta come **raccolta dati**, non
come configurazione candidata, finche i numeri per fascia non dicono il contrario.

### `MIN_POOL_LIQUIDITY_USD` non e un filtro

Nonostante il nome, non e mai confrontata con niente: `grep MIN_POOL_LIQUIDITY_USD src/` la trova
solo in `config.ts`. Il valore USD viene calcolato e loggato accanto a quello in SOL, ma **l'unico
cancello e `MIN_POOL_LIQUIDITY_SOL`**. Metterla a 0 non cambia nulla; metterla a 10.000 non blocca
niente.

### Vedere le creation non richiede di abbassare la soglia

Ogni pool valutata e gia loggata prima del filtro, con la sua liquidita:

```
🛑 SKIP: Liquidity too low (0.02 SOL / $4; min 20 SOL)
```

Abbassare la soglia non serve a **vedere** le creation, serve a **farci trading sopra**. Sono due
cose diverse: su un pool da 0,005 SOL un ingresso da 0,01 SOL ha un round trip di −80% per solo
price impact, prima che succeda qualunque cosa. Quel −80% finisce nelle statistiche accanto alle rug
vere, e non e la stessa cosa.

**Sessione 2026-09-12: `MIN_POOL_LIQUIDITY_SOL=0.1`**, scelta deliberata di osservazione per
verificare a runtime la pipeline multi-DEX e il price path recorder. I numeri di questa sessione
**non sono confrontabili** con quelli di aprile, ne come win rate ne come PnL.

### Il filtro di liquidita e per DEX, ma i controlli no

I 30 controlli creator-risk non guardano il DEX: guardano il wallet del creator, i suoi funder,
la dispersione e il cashout. Restano validi identici su `ray_v4` e `meteora_damm_v2`, che sono
AMM con riserve reali come pumpswap.

**Non si estendono invece ai launchpad su bonding curve** (`pump`, `meteora_virtual_curve`,
`ray_launchpad`). La ragione non e prudenza, e meccanica:

| Controllo | Su bonding curve |
|---|---|
| liquidita minima | non esiste liquidita alla creazione |
| top-10 holder | alla creazione non detiene nessuno |
| dev holdings | idem |
| exit su `remove liquidity` | impossibile: i fondi stanno in un PDA fino al diploma |

`remove liquidity` e 25 dei 26 rug della sessione di aprile. Su bonding curve il rug e il dump
del dev, che e un trigger che questo bot non ha. Sono una strategia separata, non un adapter.

---

## 21. Correzione: meta dei pool PumpSwap erano invisibili al filtro di liquidita

**Trovato e corretto il 2026-09-12. Non e una modifica di soglia: e un bug.**

### Il sintomo

`getPoolOrientation()` leggeva il mint del lato quote da `state.quoteMint`. Quel campo **non
esiste**: `swapSolanaState()` dell'SDK Pump espone `baseMint` in cima allo stato, ma il quote sta
dentro `state.pool.quoteMint`. La lettura tornava sempre stringa vuota.

Conseguenza su `hasWsol`:

```
hasWsol = (baseMint === WSOL) || (quoteMint === WSOL)
                                  ^^^^^^^^^ sempre ""
```

Quindi `hasWsol` era vero **solo** per i pool con layout `base=WSOL`. Per i pool con layout
`base=token, quote=WSOL` tornava falso, e a cascata:

- `getSolLiquidityFromState()` → `null`
- liquidita letta come non disponibile → sotto `MIN_POOL_LIQUIDITY_SOL`
- pool scartato come "liquidita insufficiente"

Entrambi i layout sono normali su PumpSwap. Nel campione live del 2026-09-12, 4 pool su 11 avevano
il layout `base=token`. Uno di quelli scartati aveva **478 SOL** di liquidita.

### Come si e visto

Non dai log del bot: lo scarto sembrava un normale "sotto soglia". E emerso da
`scripts/dex-adapter-live-check.js`, che stampa orientamento e mint accanto a ogni quote — il
`quote=-` accanto a una liquidita `n/d` ha reso la cosa leggibile in una riga.

**E la ragione per cui quello script esiste** ed e un passaggio obbligato per ogni nuovo adapter:
un errore di orientamento non solleva eccezioni, si traveste da pool scartato o da PnL plausibile.

### Effetto sui numeri storici

I risultati di aprile (387 outcome, +0,645 SOL) sono stati prodotti con questo bug attivo. Restano
validi come misura di **cosa ha fatto il bot**, ma il bot vedeva meno opportunita di quante ce ne
fossero. Non c'e motivo di pensare che i pool scartati fossero peggiori: venivano scartati per il
loro layout, non per una loro proprieta. La prossima sessione paper e quindi la prima su
popolazione completa, e **il volume di trade non e confrontabile con quello di aprile**.

### Cosa e cambiato nel codice

`poolMints()` in `src/services/dex/pumpswap.ts` legge da entrambe le posizioni
(`state.baseMint ?? state.pool.baseMint`, `state.quoteMint ?? state.pool.quoteMint`).
Nessuna soglia toccata.

---

## 22. Il tetto alle richieste RPC simultanee

**Aggiunto il 2026-09-12 dopo aver mandato in 429 un endpoint da 200 req/s.**

### Il difetto

`fetchParsedTransactionsForSignatures()` faceva `Promise.all` sull'intera lista di firme.
Le liste arrivano a 40 elementi (`CREATOR_RISK_*_SIG_LIMIT`), la funzione e chiamata da otto
punti, e i deep check creator-risk girano a loro volta in parallelo fra loro
(`Promise.all` di quattro controlli in `creator-risk/index.ts`). Il picco di richieste
simultanee non era limitato da niente: 40 x 4 x 2 worker nel caso peggiore.

E lo stesso difetto che il 2026-03-29 ha bruciato una chiave Helius. Allora era stato
curato il sintomo (circuit breaker sui resubscribe), non la causa.

### La correzione

`src/utils/concurrency.ts` — un semaforo, e un solo punto in cui passa tutto:

```ts
const txFetchSemaphore = createSemaphore(CONFIG.RPC_MAX_CONCURRENT_TX_FETCH);
```

`RPC_MAX_CONCURRENT_TX_FETCH` vale **6 per processo worker**, quindi il tetto di sistema e
6 x `MAX_CONCURRENT_OPERATIONS`. Configurabile da env.

**Il tetto e di processo, non di chiamata.** E la differenza che conta: un limite
per-chiamata lascerebbe quattro deep check paralleli a 6 ciascuno.

### Perche non si risolve pagando

Un piano RPC piu veloce non limita un picco illimitato, alza solo il muro contro cui si
sbatte. Con 40x4x2 richieste in volo anche 300 req/s vanno in 429, semplicemente piu tardi.

### Test

`test/concurrency.test.js`, **il primo test del repo** (`npm test`). Non e l'inizio di una
suite per principio: il semaforo e il tipo di codice che si rompe in silenzio — se il tetto
smette di funzionare non compare un errore, compaiono dei 429 sotto carico, cioe ore dopo e
altrove. Cinque casi: tetto rispettato, ordine dei risultati preservato, tetto condiviso fra
chiamate concorrenti, doppio rilascio che non gonfia i permessi, permesso restituito anche
se il task lancia.

---

## 23. Il collo di bottiglia sono i worker, non l'RPC

**Misurato il 2026-09-12** con `node scripts/creation-rate.js 300` (solo WebSocket, nessuna
chiamata HTTP: si puo lasciare girare senza consumare rate limit).

| DEX | creazioni/ora | quota |
|---|---|---|
| `pump` | 2.652 | 87,4% |
| `pumpswap` | 204 | 6,7% |
| `meteora_damm_v2` | 180 | 5,9% |
| **totale** | **3.036** | 0,84 al secondo |

Con `MAX_CONCURRENT_OPERATIONS=2`, la capacita e `2 / durata_valutazione`:

| Durata di una valutazione | Valutazioni/ora | Copertura del flusso |
|---|---|---|
| 5s | 1.440 | 47,4% |
| 10s | 720 | 23,7% |
| 20s | 360 | 11,9% |
| 40s | 180 | 5,9% |

**Conseguenze operative:**

1. **Aggiungere un DEX non aumenta il carico RPC.** Lo decidono i worker. Aumenta la
   pressione sulla coda, che scarta i piu vecchi (`QUEUE_MAX_PENDING_SIGNATURES=300`).
2. **Con pump attivo il bot diventa quasi solo un bot pump.** La coda e unica e pump e l'87%
   degli eventi: a parita di tutto il resto, circa 9 dispatch su 10 sono curve pump, e
   pumpswap viene affamato. Se si vuole continuare a coprire pumpswap serve una quota per
   DEX, che **oggi non esiste**.
3. **La latenza dell'endpoint vale quanto il numero di worker.** Una valutazione e fatta di
   round trip in gran parte sequenziali: passare da 250ms a 58ms di latenza accorcia la
   valutazione e alza la copertura senza toccare i worker.

Prima di aumentare `MAX_CONCURRENT_OPERATIONS`: il carico RPC scala linearmente con i worker,
ed e li che un piano a pagamento inizia a servire davvero.

---

## 24. Bonding curve pump: cosa e stato misurato

**Aggiunto il 2026-09-12.** Registro: `pumpswap` + `pump`, i due lati dello stesso
ecosistema. `meteora_damm_v2` e `ray_v4` sono implementati ma non registrati.

### Non tutte le curve sono denominate in SOL

**E il controllo piu importante di questo adapter.** All'offset 83 dell'account
`BondingCurve` c'e il quote mint: tutto zeri significa SOL nativo, altrimenti e un altro
token. Pump emette curve quotate in **BONK** e **PUMP** — nel campione del 2026-09-12 sono
**18 creazioni su 111, il 16%**.

Su quelle `virtualSolReserves` non contiene lamport. Leggendole come SOL:

```
curva quotata in BONK letta come SOL  ->  "21.421 SOL di liquidita"
```

Non e un errore che si nota: non solleva eccezioni, non fa fallire un quote, produce solo
numeri. In paper trade sarebbero diventati PnL inventati, e l'unica traccia sarebbe stata
un token con una liquidita d'ingresso assurda in mezzo a centinaia di righe.

`unusable()` le scarta. Il bot sa prezzare solo in SOL: interpretarle sarebbe peggio che
ignorarle.

**Come e emersa:** dalla distribuzione. La coda diceva p90 = 232 SOL e max = 5.092 SOL, e
una bonding curve si diploma intorno agli 85 SOL — impossibile per costruzione. Senza quel
controllo di plausibilita il numero sarebbe passato.

### Il mint giusto e quello creato dalla tx

Una `CreateV2` puo contenere acquisti in bundle su token pump gia esistenti, che nei token
balance sono indistinguibili dal nuovo. Prendere il primo candidato portava ad analizzare
curve vecchie, a volte gia diplomate (`virtualSol = 503`, `complete = true`).
`mintCreatedInTx()` usa l'istruzione `initializeMint` del token program: identifica il mint
creato **in quella transazione**, e non e un'euristica.

### Fee: 125 bps, misurate

Su 1.111 `TradeEvent` decodificati dai log: `95 + 30 = 125 bps` nel **75%** dei casi,
`0 bps` nel 23%, `95 + 100` in coda. Si usa il caso dominante (`PUMP_CURVE_FEE_BPS`), che e
anche il prudente. **Sono dinamiche:** se pump cambia tariffario va rimisurata, non
indovinata.

La formula del prodotto costante sulle riserve virtuali riproduce i token effettivamente
ricevuti **a meno di 1 unita atomica** rispetto ai `TradeEvent` reali.

### Il costo d'ingresso e quattro volte quello di PumpSwap

| | round trip su 0,01 SOL |
|---|---|
| `pumpswap` | −0,62% |
| `pump` | **−2,53%** |

Il profit floor e al 3%: su pump un trade parte 2,5 punti sotto, quindi il floor si attiva
subito dopo il pareggio invece che dopo un guadagno reale. Non e un bug, e la struttura di
costo — ma i winner su pump vanno letti sapendolo.

### Distribuzione della liquidita alla creazione

`node scripts/pump-curve-liquidity.js 300` — 91 curve in SOL, escluse le 18 non-SOL:

| | SOL realmente in curva |
|---|---|
| p10 | 0,0000 |
| p25 | 0,0395 |
| p50 | **0,1945** |
| p75 | 1,8445 |
| p90 | 5,2799 |
| max | 13,6543 |

| Soglia | Passano | Quota |
|---|---|---|
| 0 | 91 | 100% |
| 0,1 | 49 | 53,8% |
| 0,5 | 35 | 38,5% |
| 1 | 29 | 31,9% |
| 5 | 10 | 11,0% |

⚠️ **Correzione a quanto scritto in precedenza.** Nella mappa delle fonti
(`docs/expansion-sources-2026-09-12.md`) le bonding curve risultavano con liquidita iniziale
mediana 0, e da li era stato concluso che non hanno liquidita da filtrare. La mediana reale
e **0,19 SOL**, e il 32% delle curve nasce sopra 1 SOL: la soglia di liquidita su pump ha
significato. Resta vero che il grosso nasce quasi vuoto.

---

## 25. Coda: TTL e LIFO

**Aggiunto il 2026-09-12**, prima della sessione di osservazione pump.

### Il difetto

`pendingSignatures` era **FIFO senza TTL**: `drainPendingQueue()` prendeva `pendingSignatures[0]`,
cioe la firma piu vecchia, e sull'overflow scartava anch'esso il piu vecchio.

Con la sola pumpswap (204 creazioni/ora contro 360 di capacita) la coda non si riempiva mai e il
difetto era invisibile. Con pump registrata il flusso sale a **2.856/ora**, circa **8x la capacita**:
la coda e permanentemente piena a 300 elementi, e una firma entrata in fondo esce dopo
`300 / (360/3600) = 50 minuti`.

Una pool di 50 minuti fa non e una pool da snipare. E gia migrata, gia ruggata, o ha gia fatto il suo
movimento: il worker spende 20 secondi di RPC per produrre una valutazione priva di significato.
**Non era un problema di performance, era un problema di correttezza dei dati raccolti.**

### Le due correzioni

| Controllo | Default | Effetto |
|---|---|---|
| `QUEUE_MAX_AGE_MS` | `45000` | Scarta all'uscita dalla coda le firme piu vecchie di 45s |
| `QUEUE_ORDER` | `lifo` | Serve la firma piu fresca; `fifo` riproduce il comportamento storico |

Entrambe stanno in `takeNextPendingSignature()` (`src/app/runtime.ts`), che e ora **l'unico punto**
da cui una firma esce dalla coda — prima la logica era duplicata dentro il `while` di
`drainPendingQueue()`.

**Perche 45s.** E il tempo oltre il quale una valutazione non e piu un'osservazione della creazione
ma di qualcos'altro. Con una valutazione da 20s, 45s significa che una firma ha avuto due giri di
dispatch per essere presa; oltre, lo stato on-chain e cambiato abbastanza da rendere il dato non
comparabile con gli altri.

**Perche LIFO.** Su una coda satura FIFO e esattamente il contrario di quello che serve: garantisce
che ogni firma servita sia la piu stantia disponibile. LIFO serve la piu fresca e lascia scadere le
altre, che e il comportamento corretto quando l'input e 8 volte la capacita.

⚠️ **Lo scarto non e una perdita.** Una firma scaduta non era comunque valutabile in tempo: con
questo flusso l'88% degli eventi non viene visto in nessun caso. Il TTL rende esplicito cio che
gia accadeva, invece di nasconderlo dietro valutazioni tardive che sembrano valide.

Il log `QUEUE | expired <sig> (eta Xs > 45s, totale scadute=N)` e la misura di quanto il bot e
sott'acqua: `totale scadute` che cresce linearmente conferma la saturazione.

### Cosa resta aperto: la quota per DEX

Non implementata. Con una coda unica e pump al 92,9% degli eventi, circa 9 dispatch su 10 sono
curve pump e **pumpswap viene affamata** — l'unica fonte con un track record (387 outcome,
+0,645 SOL). La decisione e rimandata a dopo la prima ora di sessione, quando si sapra quanto dura
davvero una valutazione e quindi quanta capacita ci sia da ripartire. Vedi sezione 23.

### Soglia di liquidita per la sessione

`MIN_POOL_LIQUIDITY_SOL=0.1` e `MIN_POOL_LIQUIDITY_USD=0` in `.env` (i default nel codice restano
20 e 10.000). A 0,1 SOL passa il 53,8% delle curve pump (sezione 24). E una soglia da
**osservazione**, non da trading: serve a raccogliere abbastanza campioni per vedere come si
comportano top-10, dev-holdings e creator-risk su token appena nati. Da rialzare prima di
qualunque conclusione sul PnL.

### La spazzata della testa

In LIFO le firme scadute si accumulano **in testa**, dove `takeNextPendingSignature()` — che pop-pa
dalla coda — non arriva mai finche la coda resta satura. Senza intervento resterebbero dentro fino
all'overflow a 300 e verrebbero contate come `drop oldest` invece che come scadute: il contatore
avrebbe riportato **0 scadute proprio nella condizione che deve misurare**.

`sweepExpiredPendingSignatures()` gira a ogni enqueue e svuota la testa. Verificato a runtime: senza
la spazzata, con `pending` salito a 64 in cinque minuti, il log `expired` restava a zero.

---

## 26. Il deadlock da 429: due worker appesi fermano tutto

**Successo il 2026-09-12**, alla prima sessione con `pump` registrata. Il bot si e fermato dopo
circa un minuto di attivita ed e rimasto fermo **due ore**, senza errori e senza crash.

### I sintomi

Il supervisore continuava a ricevere eventi e a far scadere firme (`totale scadute=256`), ma
`DISPATCH` e `WORKER done` erano **zero** da minuti. I due log dei worker si fermavano entrambi
subito dopo `WAIT | pre-entry liquidity`, seguiti solo da una riga al minuto:

```
[W1] Server responded with 429 Too Many Requests.  Retrying after 4000ms delay...
```

### La causa

Quella riga **non e del bot**: e il retry interno di `@solana/web3.js`. Su 429 la libreria ritenta
da sola con backoff raddoppiante (500ms, 1s, 2s, 4s, ...) e **senza un tetto**: la chiamata non
ritorna mai, ne come valore ne come errore.

Il punto in cui si sono fermati e `top10Service.runCheck()`, che e la prima cosa dopo il gate di
pre-entry e **non emette nessun log prima di partire** — per questo sembrava silenzio invece che
blocco. Le retry del servizio top-10 sono limitate (`PRE_BUY_TOP10_MAX_ATTEMPTS=4` x 8 tentativi
interni), ma **non partivano mai**, perche l'eccezione che le innesca non arrivava.

Con `MAX_CONCURRENT_OPERATIONS=2` bastano due worker in questo stato: nessuno slot si libera mai,
`drainPendingQueue()` non ha dove mandare le firme, e il bot resta vivo e inutile a guardare la
coda scadere.

⚠️ **Perche non si era mai visto:** con la sola pumpswap (204 creazioni/ora) il carico non
produceva 429. Il deadlock non e stato introdotto dal 2026-09-12, e stato solo **reso raggiungibile**
dal volume di pump.

### Le due correzioni

**1. `disableRetryOnRateLimit: true` su ogni `Connection`** (`createRuntimeConnection()`).
Su 429 web3.js ora solleva subito, e le retry limitate del bot funzionano come previsto. Il costo
e scartare qualche pool in piu sotto rate limit; il beneficio e che una chiamata ritorna sempre.

**2. `WORKER_MAX_LIFETIME_MS` (default 1.200.000 = 20 minuti).** Il supervisore uccide con SIGKILL
un worker che supera il tetto e ne libera lo slot. E una **rete di sicurezza, non una manopola di
tuning**: copre qualunque futura chiamata che non ritorna, non solo i 429. Deve restare sopra
`AUTO_SELL_DELAY_MS` (900s) piu il tempo di valutazione, altrimenti troncherebbe gli hold legittimi.

Il log da cercare e:
```
WORKER | worker-N ucciso dopo 1200s <sig> (slot bloccato, vedi controls.md 26)
```
Se compare con regolarita non e il tetto a essere sbagliato: e un blocco da diagnosticare.

### Cosa resta da guardare

`top10Service.runCheck()` dovrebbe emettere un log di ingresso come tutti gli altri step. La sua
assenza ha trasformato un blocco diagnosticabile in due ore di silenzio.

---

## 27. "Could not extract pool/token": un 429 travestito da transazione illeggibile

**2026-09-12.** Dopo il deadlock della sezione 26, il motivo di skip piu frequente era
`SKIP: pool/token unresolved` — 17 su 40 eventi. Il messaggio dice che la transazione non e
interpretabile. **Non era vero in nessuno dei due casi che lo producevano.**

Prendendo le 27 firme non risolte e rilanciandole a mano:

| Causa | Eventi | Cosa sono davvero |
|---|---|---|
| errore RPC ingoiato | 15 | creazioni **valide**, che si risolvono tutte se richieste di nuovo |
| transazione fallita on-chain | 12 | `Custom:6082` (7) e `Custom:1` (5) |

### Causa 1: l'errore travestito da assenza

`getAccountsChunked()` in `src/services/dex/txScan.ts` aveva:

```ts
} catch {
    out.push(...chunk.map(() => null));   // "la chiamata e fallita" -> "l'account non esiste"
}
```

`resolvePoolFromCreateTx()` deriva la PDA della curva per ogni mint candidato e chiede gli account:
se tornano tutti `null` conclude che nessun candidato ha una curva e restituisce `null`. Un 429 su
`getMultipleAccountsInfo` era quindi **indistinguibile da una curva inesistente**, e il bot
riportava un problema di parsing per quello che era un rate limit.

Verificato: tutte e 15 le firme "non interpretabili" si risolvono correttamente al primo tentativo
quando l'RPC risponde.

**Correzione:** `getAccountsChunked()` ritenta 3 volte con backoff e, se fallisce ancora, **solleva**
invece di restituire null. Il costo e che l'evento finisce in `ERROR:` invece che in `SKIP:` — ed e
esattamente la differenza che serve vedere.

⚠️ **E il terzo caso identico in un giorno** (endpoint che rispondono ok senza dati, publicnode muto
su Meteora, questo). Vale come regola: **in questo codice un `catch` che restituisce un valore neutro
al posto di un errore e da considerare un bug finche non si dimostra il contrario.**

### Causa 2: le creazioni fallite

Una `CreateV2` che fallisce on-chain **emette comunque i log con il marker di create**, quindi il
supervisore la trattava come una creazione: spawn di un worker, fetch della transazione, derivazione
delle PDA, ~1,5s di RPC, per arrivare a "unresolved". Erano 12 eventi su 27.

**Correzione:** il gestore di `onLogs` scarta `logs.err` senza consumare uno slot worker.

Il controllo sta **dopo** `matchesCreateMarkers()`, non prima. Messo prima contava tutte le
transazioni fallite del program — 27.000 in tre minuti, perche su pump la stragrande maggioranza
delle swap fallisce per slippage — invece delle sole creazioni fallite. Il risparmio di lavoro e
identico (il marker e una scansione di stringhe in memoria), ma il contatore torna a misurare
quello che dice di misurare.

### Nuova riga di diagnostica

```
QUEUE STATS  | pending=42 scadute=256 create_fallite=31 slot_liberi=0/2
```

Emessa dall'healthcheck. `slot_liberi=0/2` per molti giri consecutivi e la firma del deadlock
della sezione 26; `scadute` che cresce linearmente e saturazione; `create_fallite` misura quanto
del flusso pump grezzo e rumore.

---

## 28. Nessun endpoint gratuito serve tutti i metodi: il terzo ruolo RPC

**2026-09-12**, subito dopo le correzioni della sezione 26. Il bot non era piu in deadlock, ma
restava fermo lo stesso: `slot_liberi=0/2` per otto minuti di fila, zero skip nuovi. I worker erano
in `top10Service.runCheck()`, e stavolta **ritentavano** — la correzione precedente funzionava — ma
ogni giro costava cinque minuti:

```
[17:20:20] TOP10 | retry 1/4 after error: largest accounts error (wait 400ms)
[17:25:24] TOP10 | retry 2/4 after error: largest accounts error (wait 640ms)
```

L'attesa dichiarata era 400ms. A consumare il tempo era la chiamata sotto.

### La misura

`getTokenLargestAccounts` sullo stesso mint, tre endpoint:

| Endpoint | Esito |
|---|---|
| publicnode | **32,5s → 429** |
| Alchemy free | **691ms → OK** |
| Chainstack | 939ms → 403, metodo non disponibile |

Il metodo scandisce tutti i token account di un mint: e caro, e publicnode lo strozza. Otto
tentativi interni x quattro esterni, a 16-32s l'uno, fanno oltre otto minuti di slot occupato.

⚠️ **Con `PRE_BUY_TOP10_FAIL_OPEN=false` questo non e un degrado, e un blocco totale:** un endpoint
che non serve `getTokenLargestAccounts` fa scartare **ogni** token al top-10, e `checksPassed` resta
zero per sempre. Il bot sembra funzionare — valuta, logga, scarta — e non puo entrare mai.

### Perche non basta cambiare endpoint

Alchemy serve il metodo ma regge 25 req/s: nello smoke test **55 richieste su 60 finiscono in 429**.
publicnode ne regge 218 su tutto il resto. Nessuno dei due gratuiti fa entrambe le cose.

Da qui il terzo ruolo, accanto a HTTP e WebSocket:

```bash
SVS_UNSTAKED_RPC=https://solana-rpc.publicnode.com                  # il carico grosso
SVS_UNSTAKED_WS=wss://solana-mainnet.core.chainstack.com/<node-id>  # le subscription
SVS_HEAVY_RPC=https://solana-mainnet.g.alchemy.com/v2/<key>         # solo i metodi strozzati
```

`SVS_HEAVY_RPC` e opzionale: senza, si usa la connessione normale come prima. Passa di qui **solo**
il controllo top-10, cioe una chiamata per valutazione — ben dentro i 25 req/s del piano free.

All'avvio il bot dichiara quale sta usando, e se non e impostato lo dice esplicitamente.

### Le due correzioni strutturali

| Controllo | Default | Cosa impedisce |
|---|---|---|
| `RPC_REQUEST_TIMEOUT_MS` | `8000` | Che una singola richiesta HTTP duri all'infinito |
| `PRE_BUY_TOP10_MAX_TOTAL_MS` | `20000` | Che il controllo top-10 sfori a orologio |

**Il timeout per richiesta e la correzione piu importante delle due.** `@solana/web3.js` non impone
alcun timeout: la richiesta resta aperta finche il server non risponde, e publicnode ci ha messo 32
secondi per dire di no. Ora ogni `Connection` monta un `fetch` con `AbortController` a 8s. Verificato:
la stessa chiamata passa da 32.552ms a 8.007ms.

**Il tetto a orologio serve perche i tentativi non limitano il tempo.** `PRE_BUY_TOP10_MAX_ATTEMPTS=4`
sembra un budget, ma 4 x 8 tentativi interni x 8s di timeout sono ancora oltre quattro minuti. Il
deadline viene controllato sia nel giro esterno sia in `getLargestAccountsWithRetry`.

### La lezione che si ripete

E il quarto caso oggi di **guasto che non si presenta come guasto** (sezioni 26 e 27 per gli altri).
Qui un endpoint che "funziona" ma e lentissimo su un metodo solo produceva esattamente gli stessi
sintomi di un bot sano che scarta tutto. La difesa e sempre la stessa: un tetto a orologio su ogni
attesa, e un contatore che dica quante volte e scattato.

---

## 29. "entry state unavailable": vocabolario PumpSwap in codice condiviso

**2026-09-12.** Con il top-10 finalmente funzionante (sezione 28), un token pump ha superato
liquidita (2,96 SOL), token security, top-10 (10,81%) e **tutti e 30 i controlli creator-risk**
(`cr_allPassed: true`), arrivando a `STEP 6/7 | paper simulation`. Li e morto:

```
🛑 SKIP: Paper simulation guard (entry state unavailable)
```

### La causa

Il codice che aspetta che il pool sia indicizzato prima di simulare l'entrata faceva:

```ts
const state = await ACTIVE_ADAPTER.fetchPoolState(poolKey, observerUser);
if (state.poolBaseAmount.gt(new BN(0)) && state.poolQuoteAmount.gt(new BN(0))) return state;
```

`poolBaseAmount` e `poolQuoteAmount` sono campi della **SDK PumpSwap**. Lo stato di una bonding
curve pump non li ha: e `{ virtualTokenReserves, virtualSolReserves, realTokenReserves,
realSolReserves, complete, creator, quoteMint }`. Quindi `.gt()` veniva chiamato su `undefined`,
il `TypeError` finiva in un `catch {}` vuoto, il ciclo ripeteva **dodici volte** e restituiva
`null` — che il chiamante traduce in "entry state unavailable", cioe un problema di indicizzazione.

**Conseguenza: nessun token pump avrebbe mai potuto entrare.** Non alcuni, nessuno — e solo dopo
aver superato ogni singolo filtro, cioe nei casi migliori.

⚠️ Il difetto e mio, dell'adapter pump: l'interfaccia `DexAdapter` esiste proprio per impedire
questo, ma questo controllo era rimasto scritto inline nel codice comune.

### La correzione

Nuovo metodo nel contratto `DexAdapter`:

```ts
/** Le riserve sono utilizzabili per quotare? */
hasUsableReserves(state: any): boolean;
```

| Adapter | Implementazione |
|---|---|
| `pumpswap` | `poolBaseAmount > 0 && poolQuoteAmount > 0` |
| `pump` | `!unusable(state)` — stessa condizione dei quote: non completa, denominata in SOL, riserve > 0 |
| `ray_v4` | `baseReserve > 0 && quoteReserve > 0` |
| `meteora_damm_v2` | liquidita in range diversa da zero (su un CLMM i saldi dei vault non bastano) |

I due punti che aggiravano l'adapter — `src/pumpAmmSniper.ts` e `src/services/paper-trade/index.ts`
— ora lo chiamano. Verificato sulla curva che era fallita: `hasUsableReserves = true`.

**E stato tolto anche il `catch {}` vuoto.** Ora l'ultimo errore viene conservato e stampato:

```
STATE | pool non quotabile dopo 12 tentativi: <motivo>
```

Senza quella riga, un errore di forma e un pool davvero non indicizzato producono lo stesso identico
messaggio — ed e esattamente il motivo per cui questo e costato mezza giornata.

### Regola che si conferma

Quinto caso in un giorno di guasto che non sembra un guasto. Qui il pattern e piu preciso dei
precedenti: **un `catch` vuoto dentro un ciclo di retry converte un bug deterministico in un timeout
apparentemente transitorio.** Se il codice riprova dodici volte, deve saper dire perche ha fallito
l'ultima.

---

## 30. Precedenza per DEX: pumpswap riceveva il 5% delle valutazioni

**2026-09-12.** Terza e ultima delle correzioni di coda, dopo TTL e LIFO (sezione 25).

### La misura

Prime due ore con entrambi i DEX registrati:

| DEX | valutazioni | quota | quota degli **arrivi** |
|---|---|---|---|
| `pump` | 247 | 95% | ~93% |
| `pumpswap` | 13 | **5%** | ~7% |

E la coda non e quasi mai vuota:

```
516 giri con arretrato
  5 giri a coda vuota
```

⚠️ **Correzione a quanto concluso in mattinata.** Misurato che una valutazione dura 2-4 secondi
invece dei 20 stimati, avevo concluso che la quota per DEX non servisse. Il ragionamento sulla
capacita era giusto, la conclusione no: la coda resta satura il 99% del tempo lo stesso, perche
pump genera piu creazioni di quante se ne possano consumare a qualunque velocita ragionevole.

**E il LIFO peggiora lo squilibrio.** Su una coda sempre piena, "servi il piu fresco" coincide in
pratica con "servi chi arriva piu spesso", e pump arriva ~13 volte piu spesso. Il LIFO resta la
scelta giusta per la freschezza, ma da solo penalizza il DEX di minoranza.

### Perche conta

`pumpswap` e **l'unica fonte con un track record**: 387 outcome, +0,645 SOL, 69,4% di win rate. Le
bonding curve pump sono una strategia nuova, non validata, con un round trip che parte a -2,53%
contro un profit floor al 3%.

E non c'e nemmeno un vero conflitto di capacita:

| | |
|---|---|
| Throughput misurato | ~1.300 valutazioni/ora |
| Arrivi pumpswap | ~204/ora = **16%** della capacita |

Dare la precedenza a pumpswap lo copre quasi del tutto lasciando l'84% a pump.

### Il controllo

| Controllo | Default | Effetto |
|---|---|---|
| `QUEUE_PRIORITY_DEX` | `pumpswap` | Nomi di DEX, separati da virgola, che passano avanti in coda |

Vuoto = nessuna precedenza, comportamento identico a prima. Un nome che non corrisponde a nessun
adapter registrato viene segnalato all'avvio invece di restare una precedenza silenziosamente
inattiva — un refuso in `.env` altrimenti non si vedrebbe mai.

La precedenza **non scavalca il TTL**: una firma prioritaria scaduta viene scartata come le altre.
Fra piu firme prioritarie vince comunque la piu fresca.

### La logica di selezione ora ha dei test

TTL, LIFO e precedenza interagiscono, e `selectNextSignature()` e l'unico punto da cui una firma
esce dalla coda. Un errore li non produce un log sbagliato: fa **sparire un DEX**, in silenzio.

Per questo la selezione e stata estratta da `runtime.ts` in `src/app/queueSelect.ts` come funzione
pura, con 10 casi in `test/queue-select.test.js` — compresi quelli che si sbagliano facilmente:
la firma prioritaria scaduta che non deve essere resuscitata, e la firma gia in lavorazione che non
deve essere restituita due volte.

Nuovo campo in `QUEUE STATS`:

```
QUEUE STATS | pending=7 scadute=151 create_fallite=195 precedenza=12 slot_liberi=1/2
```

`precedenza` che resta a zero mentre pumpswap riceve poche valutazioni significa che la
configurazione non sta avendo effetto.

---

## 31. Il 66% delle valutazioni moriva in 429: limitare il ritmo, non il parallelismo

**2026-09-12.** Con tutto il resto funzionante, il tasso di errore delle valutazioni era salito
al **66%**, tutte allo `STEP 1/7` e tutte con lo stesso messaggio:

```
ERROR: getMultipleAccountsInfo fallita dopo 3 tentativi su 10 account: 429 Too Many Requests
```

### Prima misurare, poi tarare

Una sonda esterna contro publicnode **mentre il bot girava** ha risposto `ok=12 429=0` a ritmo
sequenziale. Quindi l'endpoint non ci stava bloccando: era il bot a superarne il ritmo. Ma non si
sapeva quanto costasse una valutazione, e senza quel numero qualunque taratura dei tetti sarebbe
stata a caso.

Da qui il contatore per valutazione, aggiunto in modo permanente alla riga `END`:

```
END | SKIP: no WSOL side  (1049ms, rpc=6 429=0)
END | SKIP: low liquidity (6361ms, rpc=17 429=0)
END | SKIP: creator risk  (2717ms, rpc=60 429=39)
```

| Esito | richieste RPC |
|---|---|
| `no WSOL side` | 5-10 |
| `low liquidity` | 17-22 |
| **`creator risk`** | **57-63 in ~2,4s** |

I deep check creator-risk emettono **circa 25 richieste al secondo da un solo worker**, cioe 50
con due, e due terzi tornavano 429.

### Perche il tetto esistente non bastava

`RPC_MAX_CONCURRENT_TX_FETCH=6` limita il **parallelismo** di un solo helper
(`fetchParsedTransactionsForSignatures`). I deep check creator-risk fanno tutt'altro: richieste
brevi, molte, in gran parte sequenziali. **Nessun tetto di concorrenza rallenta una sequenza.**
Concorrenza e ritmo sono due grandezze diverse, e il bot aveva solo la prima.

### La correzione

`src/utils/rateLimiter.ts`, un token bucket, agganciato dentro `fetchWithTimeout` — **l'unico punto
da cui esce ogni chiamata RPC del processo**. Metterlo nei singoli servizi significherebbe
dimenticarselo nel prossimo.

| Controllo | Default | Limita |
|---|---|---|
| `RPC_MAX_REQUESTS_PER_SEC` | `12` | Il **ritmo**, per processo worker |
| `RPC_MAX_CONCURRENT_TX_FETCH` | `6` | Il **parallelismo** di un helper |

Il totale verso l'endpoint e `RPC_MAX_REQUESTS_PER_SEC x MAX_CONCURRENT_OPERATIONS` = 24/s.
`0` disattiva il limite, da usare solo con un endpoint a pagamento.

Il bucket si ricarica in modo continuo, non a scatti a inizio secondo: altrimenti una raffica
aspetterebbe il secondo successivo per ripartire tutta insieme, che e il comportamento che genera
i 429.

### Risultato

| Tetto | Valutazioni in errore | 429 per valutazione (max) |
|---|---|---|
| nessuno | **66%** | 40 |
| 12/s | 15% | 25 |
| **8/s** | **0%** | **0** |

Il default e **8** (16/s con due worker). A 12/s restavano valutazioni con 18-25 rifiuti; a 8/s
la mediana e il massimo dei 429 sono entrambi zero su un campione di 38 valutazioni.

Il costo e che una valutazione creator-risk passa da ~2,4s a ~5s. E un cambio favorevole: prima
due terzi di quelle richieste venivano rifiutate e l'intera valutazione era persa.

⚠️ **Il limite resta condiviso fra endpoint.** `SVS_HEAVY_RPC` passa dallo stesso bucket, il che va
bene finche riceve una chiamata per valutazione (sezione 28), ma se in futuro ci finisse altro
servirebbe un bucket per endpoint.

⚠️ **Attenzione a non attribuire tutto al tetto.** La sessione a 8/s e partita mentre il flusso
di creazioni era circa la meta di quello del mattino:

| | mattina | sera |
|---|---|---|
| `pump` | 2.652/h | 1.230/h |
| `pumpswap` | 204/h | 210/h |
| **totale** | **3.036/h** | **1.440/h** |

Con ~1.020 valutazioni/ora di throughput, la capacita copre il 71% degli arrivi serali ma solo il
34% di quelli del mattino. **Lo zero errori va quindi riverificato a volume pieno**, e la coda
tornera ad avere arretrato — che e anche quando la precedenza per DEX (sezione 30) torna a contare:
a coda vuota `precedenza` resta a zero perche non c'e contesa, ed e corretto cosi.

Nota di lettura: la quota pumpswap sugli arrivi passa dal 7% al 14,6% fra mattina e sera, ma in
valore assoluto pumpswap e stabile (204 -> 210/h). A cambiare e solo il volume di pump.

---

## 32. Il bot si e fermato 15 minuti: il portatile dormiva

**2026-09-12, sera.** Sessione apparentemente sana, poi i contatori di `QUEUE STATS` congelati e
i due slot worker liberi senza che succedesse niente.

```
[18:28:19] QUEUE STATS  | pending=13 scadute=13 create_fallite=73 precedenza=5 slot_liberi=0/2
   ... 913 secondi di nulla ...
[18:43:38] WORKER       | worker-1 done 5A11vJ...6qQwKc
[18:43:41] ⚠️ Log stream stale for 915s. Resubscribe attempt 1/5
[18:44:54] ws error: Unexpected server response: 403
```

**Due guasti indipendenti sovrapposti**, che da soli sarebbero stati facili e insieme sembravano
un bug del supervisore.

### 1. L'healthcheck non era rotto: l'host dormiva

`HEALTHCHECK_INTERVAL_MS=15000` e `LOG_STALE_RESUBSCRIBE_MS=90000`: il rilevatore avrebbe dovuto
reagire dopo 90 secondi, non 915. E sembrava un event loop bloccato.

Non lo era. `pmset -g log` sull'host:

```
2026-09-12 20:43:35  Sleep    Entering Sleep state due to 'Sleep Service Back to Sleep'
2026-09-12 20:45:11  Wake     Wake from Deep Idle ... lid ... HID Activity
```

Il Mac e andato in sleep (l'orario del container e quello dell'host meno due ore). La VM Docker si
congela, **nessun timer scatta**, la connessione WebSocket cade. Al risveglio tutto riparte e il
rilevatore di stallo fa esattamente il suo lavoro — 3 secondi dopo il ritorno del processo.

⚠️ **Un portatile che dorme non puo ospitare una sessione paper.** Ogni sleep uccide la subscription
e congela il bot, e i buchi non si distinguono da un guasto senza guardare i log di sistema. Per
una sessione lunga serve `caffeinate -i` davanti al comando, le impostazioni di risparmio energia
cambiate, o una macchina che non dorme.

**Come riconoscerlo:** un salto nei timestamp di `QUEUE STATS` molto piu lungo di
`HEALTHCHECK_INTERVAL_MS`, con il processo ancora vivo dopo. Prima di cercare un bug nel codice,
controllare `pmset -g log | grep -E "Sleep|Wake"`.

### 2. Chainstack free: quota mensile esaurita

Al risveglio la riconnessione ha ricevuto 403. Non era un problema di rete:

```json
{"code":-32005,"message":"You've reached your monthly quota of Request Units (RUs)."}
```

Le Request Units del piano free sono **mensili**, non giornaliere: una giornata di misure e riavvii
le ha consumate, e l'endpoint resta inutilizzabile fino al rinnovo. Vale sia per HTTP che per WS.

### L'endpoint WebSocket sostitutivo

Misurato subito dopo, 60 secondi per endpoint:

| Endpoint | creazioni `pump` | `pumpswap` |
|---|---|---|
| `wss://api.mainnet-beta.solana.com` | **46** | 2 |
| `wss://solana-rpc.publicnode.com` | 33 | 2 |

`mainnet-beta` consegna circa il 40% in piu di publicnode su pump. Il suo limite noto — 1,1 req/s
in HTTP — non conta, perche qui fa solo da WebSocket: le letture restano su publicnode e i metodi
pesanti su Alchemy (sezione 28).

```bash
SVS_UNSTAKED_WS=wss://api.mainnet-beta.solana.com
```

⚠️ **Terza volta in un giorno che un endpoint viene sostituito.** La configurazione a tre ruoli
della sezione 28 non e un'ottimizzazione: e la struttura che permette di cambiarne uno senza
toccare gli altri. Qui e servita davvero.


---

## 33. Soglia di liquidita pump a 1 SOL, e dove va davvero il budget RPC

**2026-09-12, sera.** Prima sessione con 14 trade reali su bonding curve pump.

### La misura

Liquidita **all'ingresso** (non quella iniziale: con `LOW_LIQUIDITY_RECHECK_ENABLED=true` una curva
letta troppo presto viene riletta, e in un caso e passata da 0,0196 a 0,3129 SOL in 1,5 secondi).

| SOL all'entry | esito |
|---|---|
| 0,13 | -100% |
| 0,23 | -100% |
| 0,29 | -100% |
| 0,31 | **+73,48%** |
| 0,46 | -100% |
| 0,51 | -100% |
| 0,90 | -100% |
| 2,00 | -46,19% |
| 2,45 | -9,36% |
| 2,74 | **+56,73%** |
| 4,00 | -100% |
| 5,66 | -4,80% |
| 5,96 | -32,14% |
| 27,38 | -63,06% |

| | sotto 1 SOL | sopra 1 SOL |
|---|---|---|
| Trade | 7 | 7 |
| Rug a -100% | **6 (86%)** | 1 (14%) |
| Net | **-0,0527 SOL** | -0,0199 SOL |

Ha senso meccanicamente: una curva con 0,1-0,9 SOL dentro e un dev con un sacchetto minuscolo, che
puo svuotarlo in una transazione. Non serve malizia, basta che venda.

`MIN_POOL_LIQUIDITY_SOL` passa da **0,1 a 1**. Lo 0,1 era una soglia da osservazione, scelta per
raccogliere campioni (sezione 25), non da trading.

⚠️ **Limiti di questa conclusione, che non sono piccoli.** 14 trade sono pochissimi; il campione e
**distorto** perche il 64% delle valutazioni e morto su errori RPC, quindi non e casuale; e anche
sopra 1 SOL il risultato resta negativo (-0,0199 su 7 trade). La soglia toglie la parte peggiore,
**non rende pump profittevole**: il round trip a -2,53% contro un profit floor al 3% resta.

La soglia e globale, condivisa con pumpswap, ma le pool pumpswap alla creazione nascono su un'altra
scala (ne e stata vista una a 88 SOL), quindi 1 SOL non le tocca.

### Dove va il budget RPC: il 42% in 14 trade

Costo misurato per esito, dal contatore `rpc=` della sezione 31:

| Esito | n | richieste medie |
|---|---|---|
| **TRADE (fino all'uscita)** | 14 | **~1.000** |
| `SKIP: creator risk` | 172 | 54,5 |
| `SKIP: low liquidity` | 109 | 22,0 |
| `SKIP: creator unresolved` | 121 | 11,7 |
| `SKIP: no WSOL side` | 125 | 8,4 |

**I 14 trade sono l'1,0% delle valutazioni e il 42% di tutte le richieste RPC.** Il motivo e
l'hold monitor: nove controlli che pollano ogni 1-1,5 secondi per i 900s di `AUTO_SELL_DELAY_MS`.

⚠️ **Questa e la leva piu grossa sul costo, molto piu della soglia di liquidita.** E si combina con
un fatto gia noto (punto 3 di `docs/regole.md`): **il crash da `remove liquidity` e atomico**, quindi
pollare piu spesso non aiuta a intercettarlo. Se il polling veloce non serve a prendere i rug,
raddoppiare gli intervalli di hold dimezza il costo di un trade con una perdita di informazione che
riguarda solo la granularita del trailing stop. Da valutare con i dati di `pricePath` (sezione 19),
che e esattamente cio che serve per rispondere.

---

## 34. Audit RPC e registrazione del pricePath a piena frequenza (2026-09-12)

Rivalutazione completa dei controlli che fanno chiamate RPC: **`docs/rpc-audit-2026-09-12.md`**.
Misure su 1.482 valutazioni (33.853 richieste) per il costo e su 386 trade di aprile per il valore.

Risultati principali:
- i 14 trade sono lo **0,9% delle valutazioni e il 41,4% della spesa RPC**;
- l'hold costa **6,9 richieste/s**, di cui **5,0/s** è il solo poll di stato a 200ms;
- 5 poller di hold (remove-liq, pool churn, close-account burst, creator outbound, inbound spray)
  valgono complessivamente **6 uscite per +0,003 SOL** su 386 trade e pagano RPC ogni 1-1,5s;
- di 30 regole creator-risk **ne sparano 4**, e una sola (unique counterparties) fa il 79% dei blocchi;
- `PRE_BUY_TOP10_CHECK_ENABLED` blocca **1 token su 1.482** ed è l'unica ragione per cui serve
  `SVS_HEAVY_RPC`; `ENFORCE_DEV_HOLDINGS_CHECK` blocca **0 su 1.482**.

**Modifica applicata in questo ciclo.** `HOLD_PRICE_PATH_HEARTBEAT_MS` e `HOLD_PRICE_PATH_MAX_SAMPLES`
diventano override da env (prima erano costanti a 5000 e 3000) e in `.env` valgono ora **200** e **6000**.

| Controllo | prima | ora |
|---|---|---|
| `HOLD_PRICE_PATH_HEARTBEAT_MS` | 5000 | **200** |
| `HOLD_PRICE_PATH_MAX_SAMPLES` | 3000 | **6000** |

Perché: il recorder registrava un campione ogni 5s, quindi i dati non permettevano di simulare
intervalli di poll più fitti di 5s — cioè esattamente la domanda da cui dipende il 72% del costo per
trade. A 200ms il `pricePath` coincide con il poll di stato e ogni intervallo di hold diventa
ri-simulabile offline. **Costo RPC: zero** — il recorder legge lo stato già scaricato dal loop, non
aggiunge chiamate; cresce solo la dimensione del report (6.000 campioni per hold pieno invece di 180).
Nessuna decisione di uscita cambia. Si torna al comportamento precedente togliendo le due env.

---

## 35. Tagli applicati dall'audit RPC (2026-09-12)

Tutti i toggle sotto erano costanti in `src/app/config.ts`: ora leggono da env tramite `envBool()`,
quindi il rollback è togliere la riga dal `.env` senza toccare il codice. Motivazioni e misure in
`docs/rpc-audit-2026-09-12.md`.

| Controllo | prima | ora | evidenza |
|---|---|---|---|
| `HOLD_REMOVE_LIQ_DETECT_ENABLED` | true | **false** | 4 uscite +0,001 SOL, **36 rug mancati su 36**; RPC ogni 1,5s |
| `HOLD_POOL_CHURN_DETECT_ENABLED` | true | **false** | **0 uscite** su 386 trade; RPC ogni 1,5s |
| `HOLD_CREATOR_CLOSE_ACCOUNT_BURST_EXIT_ENABLED` | true | **false** | 1 uscita, +0,002 SOL; RPC ogni 1s |
| `HOLD_CREATOR_OUTBOUND_EXIT_ENABLED` | true | **false** | 1 uscita, +0,000 SOL; RPC ogni 1,5s |
| `HOLD_CREATOR_INBOUND_SPRAY_EXIT_ENABLED` | true | **false** | **0 uscite** su 386 trade; RPC ogni 1,5s |
| `HOLD_SELL_QUOTE_COLLAPSE_EXIT_ENABLED` | true | **false** | **0 uscite** su 386 trade (non costava RPC) |
| `HOLD_WINNER_PROFIT_FLOOR_PCT` | 3 | **0** (spento) | 4 uscite normali 1W/3L, **−0,011 SOL** |
| `CREATOR_RISK_PRECREATE_BURST_BLOCK_ENABLED` | true | **false** | **0 blocchi** su 1.482 valutazioni |
| `PRE_BUY_TOP10_CHECK_ENABLED` | true | **false** | **1 blocco** su 1.482; unica ragione di `SVS_HEAVY_RPC` |
| `ENFORCE_DEV_HOLDINGS_CHECK` | true | **false** | **0 blocchi** su 1.482 valutazioni |

**Restano accesi** i tre poller di hold che producono valore: `winner take profit` (119 uscite,
+0,781 SOL), `creator outbound spray` (147 uscite, +0,141 SOL) e il recheck creator-risk
(38 uscite, +0,057 SOL). Resta acceso anche `PRE_BUY_FINAL_REMOVE_LIQ_CHECK_ENABLED`: a differenza
del poller di hold, controlla un rug **già avvenuto** fra rilevamento ed entrata, quindi non è
soggetto al problema dell'atomicità.

**Non applicato:** `CREATOR_RISK_PARSED_TX_LIMIT` resta **50**. Dimezzarlo non è un risparmio ma un
allentamento del filtro unique-counterparties — meno transazioni lette, meno counterparties contate,
meno blocchi — cioè la stessa direzione dell'esperimento `cp=1` che costò −0,102 SOL.

**Non applicato:** `HOLD_WINNER_CHECK_INTERVAL_MS` resta **200ms**, ed è il 72% del costo di un
trade. Dipende dal `pricePath` a piena frequenza attivato alla sezione 34: prima i dati, poi il taglio.

**Conseguenza operativa:** con il top-10 spento, `SVS_HEAVY_RPC` non serve più. Resta configurato ma
inutilizzato; se dopo una sessione i log non mostrano chiamate pesanti, si può togliere Alchemy.

---

## 36. Il `.env` era in gran parte ignorato dal codice (2026-09-12)

Scoperto verificando i tagli della sezione 35 contro il container: il banner stampava
`exit delay 900s` mentre il `.env` conteneva `AUTO_SELL_DELAY_MS=90000`.

**Causa.** `src/app/config.ts` definiva la quasi totalità dei controlli come letterali
(`AUTO_SELL_DELAY_MS: Number(900000)`) invece che come override da env. Su ~285 chiavi presenti
nel `.env`, **solo 39 venivano effettivamente lette**: le altre 246 erano scritte, caricate da
Docker nell'ambiente del processo, e poi ignorate. Nessun errore, nessun log.

**Le 34 con un valore diverso da quello del codice**, cioè i tuning che non hanno mai avuto effetto.
Le tre che pesano sulle chiamate RPC:

| Controllo | `.env` (creduto attivo) | codice (realmente attivo) | effetto |
|---|---|---|---|
| `AUTO_SELL_DELAY_MS` | 90.000 (90s) | **900.000 (900s)** | hold **10× più lungo** |
| `HOLD_WINNER_CHECK_INTERVAL_MS` | 1.000 | **200** | poll **5× più fitto** |
| `CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES` | 25 | **3** | filtro **8× più severo** |

Le prime due si moltiplicano: il costo RPC di un trade è stato **~50 volte** quello che il `.env`
descriveva. È la spiegazione del 41,4% di spesa sui trade misurato nella sezione 34, e non era una
scelta di progetto ma un bug silenzioso.
La terza spiega perché `unique counterparties` fa il 79% dei blocchi: la soglia attiva è 3, non 25.

**Correzione strutturale.** Tutte le 328 chiavi di `CONFIG` ora accettano un override da env
(`Number(process.env.X ?? default)`, `envBool("X", default)`). Il `.env` non può più mentire.

**Correzione di comportamento: nessuna, deliberatamente.** Attivare di colpo le 34 chiavi avrebbe
significato applicare 34 modifiche mai validate insieme ai tagli della sezione 35, fra cui
allentare `CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES` da 3 a 25 — la stessa direzione dell'esperimento
`cp=1` che costò −0,102 SOL. I valori del codice sono anche gli unici validati: i +0,645 SOL di
aprile sono stati prodotti da quelli, non da quelli del `.env`. Le 34 righe sono quindi
**commentate** nel `.env`, con il valore leggibile accanto: riattivarle è togliere un `#`, una alla
volta e misurando.

Verifica: dump di `CONFIG` prima e dopo la conversione, **328 chiavi su 328 identiche**.

---

## 37. Hold: 90 poll per trade invece di 4.500 (2026-09-12)

Riattivate due delle 34 chiavi congelate alla sezione 36, più tre intervalli che le rendevano inefficaci.

| Controllo | prima | ora |
|---|---|---|
| `AUTO_SELL_DELAY_MS` | 900.000 (900s) | **90.000 (90s)** |
| `HOLD_WINNER_CHECK_INTERVAL_MS` | 200 | **1000** |
| `HOLD_HARD_STOP_LOSS_CHECK_INTERVAL_MS` | 250 | **1000** |
| `HOLD_SINGLE_SWAP_SHOCK_CHECK_INTERVAL_MS` | 300 | **1000** |
| `HOLD_SELL_QUOTE_COLLAPSE_CHECK_INTERVAL_MS` | 300 | **1000** |

`pollIntervalMs` è il **minimo** fra tutti gli intervalli dei controlli di prezzo
(`holdMonitor.ts:110`), quindi alzare solo il winner non sarebbe bastato: il poll sarebbe sceso da
200 a 250ms per via dell'hard stop loss, cioè un risparmio dell'1,25× invece del 5×. Alzati anche
gli altri tre, nessuno dei quali merita di quadruplicare il ritmo: hard stop loss vale 2 uscite per
−0,005 SOL su 386 trade, single swap shock etichetta un −100% comunque inevitabile, e sell quote
collapse è già spento (sezione 35, 0 uscite su 386).

**Effetto:** da 4.500 poll per trade (900s / 200ms) a **90** (90s / 1000ms), cioè **50×**, che è
esattamente il divario fra il `.env` e il codice descritto alla sezione 36.

⚠️ **Da verificare, non è una modifica gratuita.** I +0,781 SOL di `winner take profit` — il 121%
del net PnL di aprile — sono stati prodotti a 200ms su un hold di 900s. Un hold di 90s tronca per
definizione i trade che impiegavano più di un minuto e mezzo a raggiungere il picco: in aprile il
`time-to-peak` mediano non è stato misurato contro questa soglia. Il `pricePath` a piena frequenza
(sezione 34) rende la verifica possibile sui dati della prossima sessione: se una quota rilevante
dei picchi cade oltre i 90s, `AUTO_SELL_DELAY_MS` va rialzato tenendo il poll a 1000ms — le due
manopole sono indipendenti e il risparmio grosso è già nel poll.

---

## 38. Architettura seriale: un worker, un token alla volta, solo pump (2026-09-12)

Sostituisce il modello a 2 worker + coda condivisa (sezioni 23, 25, 29).

**Come funziona.** Il supervisore ascolta `logsSubscribe` sul solo program `pump`. Alla prima
creazione valida fa spawn di un worker e **da quel momento scarta ogni altra creazione** finche il
worker non termina. Non e una coda con capienza 1: l'evento scartato non torna piu. Quando il worker
si libera, il supervisore prende la prima creazione che arriva *dopo* — cioe sempre la piu fresca
possibile. Una coda, anche di un solo posto, potrebbe solo consegnare qualcosa di piu vecchio.

**Cosa sparisce.** `src/app/queueSelect.ts` e il suo test, `pendingSignatures`, TTL, LIFO/FIFO,
precedenza per DEX, `drainPendingQueue`, `QUEUE STATS`. Le chiavi `QUEUE_MAX_PENDING_SIGNATURES`,
`QUEUE_MAX_AGE_MS`, `QUEUE_ORDER`, `QUEUE_PRIORITY_DEX` non esistono piu e sono commentate nel `.env`.
`MAX_CONCURRENT_OPERATIONS` passa da 2 a **1**: alzarlo reintrodurrebbe la contesa che la coda
serviva a gestire, e la coda non c'e piu. Netto: −290 righe.

**Nuova riga di log**, al posto di `QUEUE STATS`:

```
SERIALE      | valutate=N ignorate_occupato=N quota_vista=N% create_fallite=N worker=N/1
```

`quota_vista` e la metrica che conta: quante creazioni valutiamo sul totale arrivato.

**Perche.** Tre motivi, in ordine di peso.

1. **Il tetto di spesa diventa vero.** Il rate limiter e un token bucket **per processo**, e ogni
   worker e un processo nuovo che parte col secchio pieno: con piu worker vivi insieme
   `RPC_MAX_REQUESTS_PER_SEC` non limitava quasi nulla. Con un solo processo alla volta e un tetto
   globale reale. Questo risolve strutturalmente il difetto annotato alla sezione 29, senza spostare
   il limiter nel supervisore.
2. **Il costo scende e resta prevedibile.** Proiezione sui dati della sessione delle 20:32
   (valutazione media 6,2s / 27 richieste, trade ~1% con hold 90s e ~200 richieste):
   ciclo medio 7,1s → **507 valutazioni/ora, ~14.500 richieste/ora, ~10,6M/mese**, contro le
   25.617/ora di oggi.
3. **Semplicita.** La coda esisteva solo per arbitrare fra due worker in contesa.

**Costo della scelta, esplicito.** Sul flusso pump (1.350 creazioni/ora) si valuta il **38%**.
E soprattutto **`pumpswap` viene spento**: e il DEX dei +0,645 SOL di aprile, 69,4% di win rate,
mentre pump finora ha fatto −0,056 SOL su 14 trade. La decisione e deliberata — cercare edge su pump
con dati puliti invece di dividere la capacita fra due popolazioni — ma va rivalutata contro i
numeri di pump quando ce ne saranno abbastanza. `pumpSwapAdapter` resta implementato: riattivarlo e
rimetterlo nella lista di `src/services/dex/index.ts`. Con un solo worker pero' **ruberebbe**
capacita a pump invece di aggiungersi.

⚠️ Il supervisore **ignora** gli eventi nel callback, non chiude la subscription. Disiscriversi e
riscriversi ogni pochi secondi farebbe sbattere la connessione WebSocket contro il circuit breaker
dei resubscribe. L'effetto RPC e identico: `logsSubscribe` e un flusso push, ricevere un evento non
costa chiamate.

---

## 39. Strumentazione per misurare i filtri invece di crederci (2026-09-12)

Il problema che risolve: **vediamo l'esito solo dei token che passano.** Ogni token scartato
sparisce, quindi nessuna soglia e' mai stata confutabile. E' lo stesso vizio che ha prodotto 30
regole creator-risk di cui ne sparano 4 (sezione 34).

### 39.1 Traiettoria della liquidita all'ingresso (costo zero)

`recheckLowLiquidity` campionava la curva 16 volte in 5s e teneva **solo il massimo**. Ora registra
la traiettoria completa e la emette come `LIQPATH`, che il report daemon salva in `liqPath`:

```json
{"esito":"sotto_soglia","initialSol":0.0779,"finalSol":0.0323,"bestSol":0.0779,
 "slopeSolPerSec":-0.0092,"windowMs":5000,"t":[...],"q":[...]}
```

**Perche' conta.** Su una bonding curve il livello di liquidita e' uno *stock* che parte da zero
per tutti: quello che distingue un token a sei secondi di vita non e' quanta SOL c'e' dentro, ma
quanto in fretta sta arrivando. `MIN_POOL_LIQUIDITY_SOL` misura lo stock; la pendenza misura il
flusso. I primi due campioni reali mostrano la differenza:

| token | da → a | pendenza | esito |
|---|---|---|---|
| A | 0,0779 → 0,0323 SOL | **−0,0092 SOL/s** (si sta svuotando) | scartato |
| B | 0,9890 → 1,0949 SOL | **+0,2259 SOL/s** | passato |

**Costo RPC: zero.** I 16 campioni erano gia' pagati, venivano buttati.
Si spegne con `LOW_LIQUIDITY_RECHECK_ENABLED=false`, che pero' spegne anche il recheck.

### 39.2 Shadow tracking esteso agli skip di liquidita

`CC_SHADOW_ENABLED` passa da `false` a **`true`**, e lo shadow tracker — che seguiva solo gli skip
da creator risk — ora segue anche quelli da liquidita, il **55,6%** degli scarti.

| Controllo | prima | ora | perche' |
|---|---|---|---|
| `CC_SHADOW_ENABLED` | false | **true** | senza, nessun controfattuale |
| `CC_SHADOW_LOW_LIQ_ENABLED` | — (nuovo) | **true** | e' la popolazione piu' grossa |
| `CC_SHADOW_SAMPLE_PCT` | — (nuovo, era 100 implicito) | **20** | tetto al costo |
| `CC_SHADOW_LOW_LIQ_SAMPLE_PCT` | — (nuovo) | **20** | idem |
| `CC_SHADOW_HOLD_TTL_MS` | — (era `AUTO_SELL_DELAY_MS`) | **600.000** | l'hold e' sceso a 90s, troppo corto per vedere cosa fa un token scartato |
| `CC_SHADOW_FAST_INTERVAL_MS` | 5.000 | **10.000** | meta' snapshot, meta' costo |
| `CC_SHADOW_DEX_EVERY_N_SNAPSHOTS` | 1 | **3** | DexScreener non e' RPC ma ha un suo rate limit |

**Dimensionamento del costo.** A copertura piena sarebbe stato un raddoppio del conto RPC
(~9.700 richieste/ora in piu'). Con il 20% su entrambe le popolazioni e ~25 snapshot per job:
~68 job/ora × ~35 richieste = **~2.400 richieste/ora, +24%**. Il campione resta ampiamente
sufficiente per una tabella di frequenze.

⚠️ I job shadow girano nel **supervisore**, che ha il proprio token bucket: non rubano il budget al
worker, ma insistono sullo stesso endpoint. Se ricompaiono i 429, la prima manopola da abbassare e'
`CC_SHADOW_SAMPLE_PCT`.

### 39.3 Come si leggono

```
./scripts/bot analisi
```

Due tabelle: la prima incrocia pendenza d'ingresso ed esito, la seconda dice per ogni motivo di
skip quanti token scartati hanno poi fatto +10%, +25%, +50%, +100%, e quanti sono andati in rug.
Se la colonna rug regge il confronto con i picchi, il filtro sta lavorando; se i picchi dominano,
la soglia e' troppo severa.

---

## 40. Lo shadow tracking della notte 12→13 settembre era rumore (2026-09-13)

La strumentazione della sezione 39 ha girato una notte e ha prodotto questa tabella:

```
motivo dello skip       n  picco>=10%   >=25%   >=50%  >=100%   rug  picco mediano
low liquidity          13           0       0       0       0     0           0.0%
creator risk            8           0       0       0       0     0           0.0%
```

Sembrava un risultato — "nessun token scartato e mai salito" — ed era un guasto. **Tre difetti
sovrapposti, nessuno dei quali dava errore.**

### 40.1 Il supervisore leggeva le curve pump con la matematica di PumpSwap

`sampleCcShadowCandidate` usava `ACTIVE_ADAPTER`. Ma gira nel **supervisore**, che non ha
`WORKER_TASK_PROGRAM_ID`: `getActiveAdapter()` ricadeva su `defaultAdapter`, che era
`pumpSwapAdapter` **hardcoded** anche dopo che pumpswap era uscito dal registro (sezione 38).
Risultato: `hasWsol`, `solLiquidity`, ogni campo a `null` per 26 snapshot per token, per 21 token.

E' esattamente l'avvertimento in cima a `getActiveAdapter()` — *"quotare un pool con la matematica
di un altro DEX non da errore, da un PnL sbagliato"* — applicato al supervisore invece che ai worker.

| | prima | ora |
|---|---|---|
| `defaultAdapter` | `pumpSwapAdapter` (import fisso) | **`ADAPTERS[0]`** (dal registro) |
| adapter del campionatore shadow | `ACTIVE_ADAPTER` | **`getAdapterForProgram(job.programId)`** |

Il `programId` ora viaggia dentro il job shadow, quindi resta corretto anche con piu' adapter
registrati. Legare `defaultAdapter` al registro rende impossibile che il default sia un DEX non
monitorato.

### 40.2 `Number(null)` vale 0, ed e finito

`recordCcShadowSnapshot` faceva `Number(snapshot.peakPnlPct)` su un campo `null`, ottenendo `0`, che
passa `Number.isFinite`. Ogni token senza dati risultava con un picco dello **0,0%**, indistinguibile
da un token davvero fermo. Aggiunta la guardia, piu' un contatore `usableSnapshots`; l'analisi ora
esclude i token senza un solo snapshot leggibile e lo dichiara invece di mediarli con gli altri.

### 40.3 Un campione lento bloccava tutto lo shadow tracking

`runCcShadowQueueTick` e single-flight (`ccShadowTickRunning`) e il campionatore interroga l'RPC
dentro il supervisore **senza timeout**. Misurato: **1 campione in 15 minuti** e la scadenza del job
rilevata con 5,5 minuti di ritardo, contro un intervallo fast configurato a 10s. Aggiunto un tetto di
**8s per campione** (`CC_SHADOW_SAMPLE_TIMEOUT_MS`), ben sotto l'intervallo fast: al superamento il
campione viene saltato e loggato come `TIMEOUT`, il job prosegue.

### La lezione

Una tabella piena di zeri e' indistinguibile da una tabella piena di dati mancanti, se non si conta
separatamente quanti campioni erano leggibili. Prima di leggere qualunque risultato dello shadow
tracking, controllare la riga `token senza un solo snapshot leggibile` che `./scripts/bot analisi`
stampa in testa alla seconda tabella.

---

## 41. Quarto difetto dello shadow: il quote scritto a mano (2026-09-13)

Dopo le tre correzioni della sezione 40 lo shadow leggeva finalmente lo stato della pool
(`hasWsol=true`, `solLiquidity=0,1975`), ma `baselineExitQuoteSol`, `currentExitQuoteSol` e
`peakPnlPct` restavano `null`: cioe' proprio il dato per cui lo shadow tracking esiste.

**Causa.** `sampleCcShadowCandidate` non usava il contratto `DexAdapter`, che espone
`getEntryTokenOut` e `getExitQuoteSol` apposta. Aveva una funzione locale,
`quoteTokenOutFromStateForShadow`, che chiamava `sellBaseInput()` dell'SDK PumpSwap su
`state.poolBaseAmount`, `state.poolQuoteAmount` e `state.pool.coinCreator`. Su una bonding curve
pump quei campi non esistono: la funzione lanciava, il `try` la ingoiava e restituiva `null`.

E' il **terzo posto** in due giorni con lo stesso difetto: vocabolario PumpSwap in codice che vale
per tutti i DEX. Gli altri due sono `hasUsableReserves` (sezione 29) e `defaultAdapter` (sezione 40).
La regola in cima a `getActiveAdapter()` e nel contratto `DexAdapter` — *nient'altro deve conoscere
la forma dello stato interno del DEX* — vale anche per il supervisore e per il codice di
strumentazione, non solo per i worker.

`quoteTokenOutFromStateForShadow` e' stata eliminata; orientation, liquidita, spot, entry e exit
passano tutti da `shadowAdapter`, risolto dal `programId` che viaggia nel job.

**Verifica su due curve pump reali:**

| liquidita | tokenOut per 0,01 SOL | exit quote |
|---|---|---|
| 0,165 SOL | 290.128.022.469 | **0,009748 SOL** (−2,5%, la fee della curva) |
| 1e−9 SOL (svuotata) | 343.510.925.941 | 1e−9 SOL |

Il primo e' un round trip corretto, il secondo e' il comportamento giusto su una curva vuota.

⚠️ Resta vocabolario PumpSwap in `executeBuy` / `executeSell` (`src/pumpAmmSniper.ts` ~3199-3241).
Sono i percorsi **live**, mai eseguiti in `MONITOR_ONLY`, e sono gia' fra i punti aperti di
`PRODUCTION_BOT_CHECKLIST.md`. Vanno portati sull'adapter prima di qualunque passaggio a live.

---

## 42. `./scripts/bot live` mostrava solo il supervisore (2026-09-13)

I worker sono **processi figli** con lo stdout rediretto su `logs/paper-worker-N.log`
(`getWorkerLogPath`), quindi non passano dallo stdout del container. Misurato: 198 righe `SKIP:`
nel log del worker, **0** in `docker compose logs sniper`.

Conseguenza: `live`, `flusso`, `trade` ed `errori` — che leggevano solo `docker compose logs` —
mostravano DISPATCH e SERIALE e **nessuna decisione per token**. Il log piu' informativo del bot era
raggiungibile solo con `worker`, e solo un file alla volta.

Corretto con `tutti_i_log()`, che unisce le due sorgenti (`docker compose logs -f` +
`tail -F logs/paper-worker-*.log`). `flusso` include ora anche `TOKEN`, `LIQ`, `LIQPATH`, `CRISK`
e `CCSHADOW`.

Aggiunta inoltre una riga nel worker quando un token scartato finisce sotto shadow:

```
👁️  CCSHADOW: token seguito dopo lo skip (low-liq) — ./scripts/bot shadow
```

Senza, lo skip sembrava un vicolo cieco anche quando il token veniva seguito, perche' il
campionamento vive nel supervisore e scrive su file suoi (sezione 39.3).

---

## 43. Battito dell'hold e cruscotto per token (2026-09-13)

**Il problema.** Durante un hold il log del worker taceva: fra `BUY_QUOTE` e l'uscita passavano 90
secondi in cui comparivano solo `CRISK`/`RREPEAT`/`CRISKT` ripetuti, cioe' rumore. Era l'unico
momento in cui il bot ha soldi a rischio, e a schermo non succedeva niente.

**`HOLD_LOG_HEARTBEAT_MS`** (nuovo, **5000**) fa stampare all'hold monitor una riga di stato:

```
HOLD | 23s  quote 0.010412 SOL  pnl +4.12%  picco +6.80%
```

Solo log, **nessuna chiamata aggiuntiva**: il quote e' gia' in mano al loop. Si spegne alzando il
valore; a 0 viene comunque forzato a 1000ms.

**Cruscotto.** `./scripts/bot cruscotto` (il default) mostra ora anche il token in lavorazione:
mint, link gmgn, creator, DEX, la **pendenza della curva** dal `LIQPATH`, e le ultime tappe della
valutazione con l'ora. Se la posizione e' aperta, in fondo compare la riga `POSIZIONE APERTA` col
battito. Un riquadro `ULTIME VALUTAZIONI` tiene le ultime cinque con token, esito e motivo.

Il parser scarta esplicitamente `CRISK`, `RREPEAT`, `CRISKT`, `FILTERS`, `HOLDLOG` e `LIQPATH`: sono
righe utili nel file ma, a video, seppelliscono la narrazione dell'evento.

### 44. Cruscotto a due colonne (2026-09-13)

La schermata era diventata alta: cinque riquadri impilati, e per vedere il token in lavorazione si
passava sopra a esiti, RPC e shadow, che sono storia e non cambiano da un refresh all'altro.

Ora e' divisa: **sinistra = la sessione finora** (esiti, operazioni eseguite, ultime valutazioni,
ritmo RPC, token seguiti in ombra), **destra = adesso** (stato del bot, token in valutazione tappa
per tappa, posizione aperta). Le larghezze si ricavano dal terminale; sotto i **132 caratteri** le
due colonne si impilano da sole come prima, e la tabella dello shadow lascia cadere la colonna del
motivo sotto i 74.

**`OPERAZIONI ESEGUITE`** e' il riquadro nuovo: le entrate vere, una riga ciascuna, vincenti e
perdenti allo stesso modo. Ora dell'acquisto, token, PnL in percentuale e in SOL, durata reale
dell'hold, motivo dell'uscita e picco toccato — tutto da `holdLog` del report (`exitReason`,
`actualDurationMs`, `peakPnlPct`), gia' presente e mai mostrato. Le entrate sono ~1 su 25
valutazioni e prima stavano schiacciate nella sola riga `entrati N/M`.

**Shadow.** I token seguiti in ombra sono ordinati **dal piu' recente** (per `createdAtMs`), non
piu' per numero di campioni: quell'ordine metteva in cima il piu' vecchio ancora vivo, cioe' l'unico
che non interessa guardare. Ogni riga porta l'ora dello skip e, sotto, il link gmgn.

`CRUSCOTTO_REFRESH_MS` (default 2000) resta l'unica manopola.

### 45. `FILTERS_MONITOR_ONLY` — modalita' misura (2026-09-13)

**La domanda.** Quanto vale ogni filtro d'ingresso? Finora la risposta arrivava dallo shadow, che
segue i token scartati e ne stima il picco. E' una stima: campiona ogni 10-60s, non sa cosa avrebbe
fatto l'hold, e i suoi picchi vanno verificati uno a uno (vedi `docs/verifica-onchain.md`).

**Il controllo.** Con `FILTERS_MONITOR_ONLY=true` i filtri d'ingresso **girano e registrano ma non
bloccano**. Ogni token entra lo stesso, e l'operazione porta con se' in `bypassedFilters` l'elenco
dei filtri che l'avrebbero fermata, col motivo. Cosi' la domanda si risponde sugli **esiti veri**:
prendere le operazioni con `creator risk` fra i bypass e guardare quanto hanno reso.

Filtri messi in sola misura: `token security`, `creator risk`, `pre-entry guard`, `pre-buy top10`.
Anche il gate aggregato di fine sequenza viene ridotto alla sola liquidita', altrimenti riapplica
creator-risk e top10 e annulla la misura.

**Cosa continua a bloccare**, di proposito:

- **la soglia di liquidita'** (`MIN_POOL_LIQUIDITY_SOL`), che resta l'unico filtro attivo;
- **`no WSOL side`**, che non e' un filtro ma un limite: senza lato SOL la pool non e' prezzabile;
- **tutte le uscite dell'hold** (stop loss, take profit, trailing). Sono la strategia di uscita, non
  di ingresso: spegnerle cambierebbe due cose insieme e renderebbe il risultato illeggibile.

**Perche' non basta spegnere i filtri da `.env`.** Si otterrebbero le stesse entrate ma senza
attribuzione: un filtro spento non calcola nulla, quindi non si saprebbe quali operazioni avrebbe
bloccato. Il costo di tenerli accesi e' RPC (il creator-risk da solo e' il 27,7% delle chiamate),
ed e' esattamente cio' che si sta comprando.

**Effetto sul ritmo.** Le entrate passano da ~2% a quasi tutto cio' che supera 1 SOL, e ogni entrata
occupa il worker per la durata dell'hold. Meno token valutati all'ora, molti piu' esiti all'ora: e'
il baratto giusto quando si misura, quello sbagliato quando si cerca.

**Da rimettere a `false`** prima di qualunque uso non-paper: cosi' com'e', entra su tutto.

**`./scripts/bot reset`** ora azzera anche `logs/cc-shadow` e i due file outcomes, oltre al report e
ai log dei worker. Il backup datato del report resta la prima cosa che fa.

### 46. Due trappole trovate azzerando (2026-09-13)

**`paper.log` nella root non e' il log del supervisore.** Dentro l'immagine `/app/paper.log` e' un
**symlink** a `/app/logs/paper.log`, che e' l'unico dei due dentro il volume montato. `./scripts/bot
reset` svuotava solo quello in root, quindi il vero log restava intero; e il daemon, quando non trova
log dei worker, ricostruisce il report proprio da li'. Risultato: l'intera storia ricompariva dopo il
reset. Ora `reset` svuota entrambi.

**`docker compose stop` non basta.** Il daemon tiene gli eventi in memoria e riscrive il report ogni
pochi secondi: se e' ancora vivo mentre si azzerano i file, si riprende il suo stato e sembra che il
reset non abbia funzionato. `reset` ora fa `docker compose down`, **aspetta** che `docker compose ps
-q` sia vuoto, e si ferma con errore se non lo diventa entro 30s.

**Terza causa, esterna al codice:** un daemon avviato a mano sull'host (`node -e "require('.../paper-
report-daemon.js')"`) sopravvive a qualunque reset di Docker e continua a riscrivere
`logs/paper-report.json` col proprio stato. Se dopo un reset ricompaiono dati vecchi, il primo
controllo e' `ps aux | grep paper-report-daemon`: dev'esserci solo il processo dentro il container.

### 47. Il recheck creator-risk svuotava la misura (2026-09-13)

Con `FILTERS_MONITOR_ONLY` attivo, **8 entrate su 13** uscivano con `creator risk: ...` dopo pochi
secondi, tutte a circa **-2,5%** (la sola fee). Il motivo: `HOLD_CREATOR_RISK_RECHECK_ENABLED`
ri-esegue durante l'hold **lo stesso controllo gia' bypassato all'ingresso**. Il token entrava e
veniva buttato fuori dallo stesso segnale dalla porta accanto, quindi non si imparava niente su cosa
avrebbe fatto.

Ora in modalita' misura il recheck **registra e non esce** (`BYPASS | creator risk (uscita hold)`).

**Restano attive** le uscite che reagiscono a cio' che il creator fa *adesso* — `creator amm burst`,
`creator outbound`, `close-account burst`, `outbound spray`, `inbound spray` — perche' non sono la
riapplicazione del filtro d'ingresso ma rilevatori di comportamento in corso. Stessa logica per stop
loss, take profit e trailing: la modalita' misura riguarda **cosa compriamo**, non **quando
vendiamo**.

### 48. Seguire la curva che ha gia' graduato (2026-09-13)

Misura di partenza: `docs/studio-curva-2026-09-13.md`. Su 255 token visti nascere dal bot, i 61
`SKIP: no WSOL side` erano **due popolazioni diverse**, distinguibili dal campo `quote` del nostro
stesso messaggio di skip:

| motivo | n | vivi dopo 5-90 min | mc max |
|---|---|---|---|
| `quote=SOL (migrata su PumpSwap)` | 13 | **13 (100%)** | $13.540.107 |
| `quote=<mint diverso da SOL>` | 48 | 0 | $5.902 |

Zero vincitori sui 194 token restanti, compresi i 28 comprati davvero (mc massima $15.131).

**Cosa e' cambiato.** `PUMP_MIGRATO_ENABLED=true`: quando il worker trova la curva **completa**
(`state.complete && !state.quoteMint`) non scarta piu' il token, passa sulla sua pool PumpSwap e
prosegue il ciclo normale. La curva quotata in un mint diverso da SOL resta uno scarto: sono 48 casi
su 61 e sono morti tutti e 48.

- La pool si **deriva**, non si cerca: `canonicalPumpPoolPda(mint)`, zero RPC, verificata 13 su 13
  contro le pool reali dello studio.
- Il cambio di DEX a meta' ciclo passa da `promuoviAdapterAttivo()` (`src/services/dex/index.ts`).
  Rompe l'invariante "un worker, un DEX", quindi e' vincolato: solo in un worker, una volta sola,
  prima di qualunque quote, e sempre insieme al cambio di pool. Tutti i call site leggono
  `getActiveAdapter()` a ogni chiamata, quindi si spostano da soli.
- `pumpSwapAdapter` e' in `DISPONIBILI` ma **non** in `ADAPTERS`: nessuna seconda subscription. Con
  un worker solo, ascoltare anche PumpSwap ruberebbe capacita' a pump invece di aggiungersi; per
  questi token non serve, arrivano gia' dall'evento `create` di pump.

**`PUMP_MIGRATO_MIN_SOL_1S = 0` — soglia disattivata, e il perche' e' cambiato.**

Prima versione di questa sezione (2026-09-13, mattina): "la SOL nella pool alla nascita separa i
vincitori, sopra 1.500 SOL 4 su 4". **Era una lettura sbagliata.** Le firme della pool venivano
ordinate per `blockTime`, ma decine di transazioni condividono lo **stesso secondo** di creazione e
il sort stabile di JS lascia quel gruppo nell'ordine dell'API, cioe' dal piu' recente: si leggeva
l'ultima transazione del secondo di nascita credendola la prima.

Rimisurato prendendo la transazione davvero piu' vecchia (ordine API ribaltato, mai `blockTime`), su
28 pool graduate in **quattro ore diverse**:

- **il seed di graduazione e' 67,4 SOL per tutti** — 22 letture su 22. E' un parametro fisso di pump
  e non discrimina niente. Come segnale non e' mai esistito.
- i 1.505 SOL erano la pool **dopo circa un secondo**: ~1.438 SOL di acquisti entrati nello stesso
  secondo della graduazione. Cosa diversa, e piu' interessante: e' domanda, non un parametro.

Vivo = mc attuale >= $100.000.

| SOL nella pool dopo ~1s | n | vivi | mc max |
|---|---|---|---|
| oltre 1.500 | 5 | 4 (80%) | $14.382.579 |
| 300 - 800 | 12 | 4 (33%) | $2.422.147 |
| sotto 150 (nessun acquisto) | 9 | 1 (11%) | $121.093 |
| non leggibile | 2 | 0 | $2.532 |

**Il gradino a 1.500 non regge.** I quattro vivi di quella fascia nascono in quattro minuti
(10:18-10:22) e almeno due condividono il payer: valgono come un campione solo. E l'unico caso
indipendente nella fascia, `43VfGSS9` con **3.027 SOL** — il piu' alto di tutti — e' morto a $456.
Piu' SOL non e' automaticamente meglio.

**Cio' che resta in piedi e' il taglio grezzo:** c'e' stato un acquisto nel primo secondo o no.

```
  >= 300 SOL    8 vivi su 17   47%
  <  150 SOL    1 vivo  su  9  11%
```

Quattro volte meglio, ma con 17 e 9 campioni e un tasso del 47% che resta una lotteria. Per questo la
soglia e' a **0**: si registra (`SOL1S` nel log, `solPrimoSecondo` nel report) e non si blocca. Serve
un campione piu' grande e nato in giornate diverse prima di accenderla. Il numero non costa chiamate:
e' la liquidita' che il worker legge comunque all'ingresso.

*Nomi:* lo stage e' `SOL1S`, non `SEED` (quello e' il seed del *creator*,
`services/creator-risk/index.ts`) e non `SEEDPOOL`, che e' stato il nome per un'ora ed era gia'
sbagliato nel merito.

**Uscita dedicata.** Il profilo di aprile (TP fisso a +50%, trailing 10%, hold 90s) e' tarato su
tanti piccoli guadagni; questa popolazione e' l'opposto — 6 vincitori su 13 da +39% a +32.532%, gli
altri 7 a -95%. Un TP a +50% prende lo 0,15% di un +32.532%, e un trailing al 10% esce al primo
rumore. Per le sole pool graduate:

| | resto del bot | pool graduata |
|---|---|---|
| `hard take profit` | 50% | **0 = nessuno** (`PUMP_MIGRATO_HARD_TAKE_PROFIT_PCT`) |
| `trailing drop` | 10% | **25%** (`PUMP_MIGRATO_TRAILING_DROP_PCT`) |
| durata hold | 90s (`AUTO_SELL_DELAY_MS`) | **600s** (`PUMP_MIGRATO_HOLD_MS`) |

Il floor a +3% (`HOLD_WINNER_PROFIT_FLOOR_PCT`) resta anche qui: impedisce di riscendere sotto zero
dopo essersi armati.

**Costo da tenere d'occhio.** Con il modello seriale un hold di 10 minuti tiene occupato l'unico
worker per 10 minuti, e tutto il resto finisce in `ignorate_occupato`. E' una scelta, non un effetto
collaterale: sui 194 token non graduati la misura dice zero vincitori, quindi la capacita' che si
perde vale zero. Resta sotto `WORKER_MAX_LIFETIME_MS` (1.200s), che non va abbassato sotto i 600s
dell'hold piu' il tempo di valutazione.

**Da rimisurare alla prossima sessione:** quanti `GRADUATA` al netto di quanti eventi persi, la
distribuzione dei `solPrimoSecondo`, e se il trailing al 25% regge o esce comunque troppo presto.

### 49. Il recheck low-liquidity costava il 55% del tempo e non ha mai vinto (2026-09-13)

Misurato su 1.813 cicli di worker degli archivi, il tempo di lavoro diviso per esito:

| esito | n | mediana | tempo totale | quota |
|---|---|---|---|---|
| **`SKIP: low liquidity`** | 995 | **6,1s** | 14.142s | **55%** |
| `COMPLETED` | 92 | 26,2s | 3.576s | 14% |
| `ERROR: richiesta RPC oltre 8000ms` | 3 | 1.109,7s | 3.329s | 13% |
| `MONITOR_ONLY` | 18 | 16,1s | 1.623s | 6% |
| `SKIP: creator risk` | 261 | 6,7s | 1.485s | 6% |
| **`SKIP: no WSOL side`** | 337 | **0,9s** | 473s | **2%** |

Il secchio che consuma piu' della meta' del bot e' quello che
`docs/studio-curva-2026-09-13.md` misura a **0 vincitori su 137**. Il secchio che contiene **tutti** i
vincitori costa lo **0,9s** e il 2% del tempo. Dei 6,1s di mediana, 5 sono
`LOW_LIQUIDITY_RECHECK_WINDOW_MS`: il worker sta fermo a ricampionare una curva sotto soglia.

**Quanto vale quell'attesa:** su 1.025 finestre registrate ha recuperato **37 token** (3,6%). Di
quei 37, 21 sono poi usciti su creator risk, 3 sono stati comprati davvero — **tutti e tre in
perdita, media -12,4%, zero vincenti**.

Quindi `LOW_LIQUIDITY_RECHECK_ENABLED=false`. Si libera circa **metà del tempo di worker** a costo
misurato zero, e il ritmo di valutazione raddoppia — che e' esattamente cio' che serve per mettere
insieme un campione di pool graduate in tempi umani.

**Non e' la stessa cosa che aggiungere worker.** Con `RPC_MAX_REQUESTS_PER_SEC=8` e un worker solo la
sessione registra **0 errori 429**: il limite RPC non e' il vincolo, lo e' il tempo che il worker
passa ad aspettare. Aggiungere un secondo worker raddoppierebbe anche quello, e reintrodurrebbe la
contesa che il modello seriale (sezione 38) serviva a togliere, piu' il rischio dei worker appesi
(sezione 26 — e sopra si vedono 3 cicli da 1.109s di mediana, il 13% del tempo). Togliere l'attesa
inutile e' lo stesso guadagno senza nessuno dei due rischi.

### 50. Il problema non era l'ingresso, era l'uscita (2026-09-13)

Prima sessione con le pool graduate comprate davvero: 4 ore, 12 graduate, 10 comprate, **8 vincenti
su 10**. Sembrava un buon risultato — pnl medio **+0,77%**. Poi il controllo on-chain su dove sono
finiti quegli stessi token:

| token | SOL1S | **noi** | mc dopo qualche ora |
|---|---|---|---|
| `6agyG6m2` | 3.038 | **+3,73%** | **$90.278.933** (+217.636%) |
| `67qfLVFw` | 3.039 | **+0,54%** | **$54.114.230** (+129.629%) |
| `MMcjZrgr` | 2.998 | **+0,89%** | **$50.492.324** (+121.947%) |
| `cGxbj7Sa` | 365 | +8,32% | $931.004 (+2.135%) |
| `2HFakYaU` | 132 | -12,03% | $543.408 (+662%) |
| gli altri 7 | — | da -0,89% a +5,09% | $383 - $1.951 (morti) |

**Cinque razzi su dodici.** Su `6agyG6m2` abbiamo preso il **0,0017%** del movimento.

**Quando si muovono.** `67qfLVFw` nasce alle 15:06 e fa +129.629% *entro l'ora*; `cGxbj7Sa` +2.135%
entro l'ora. Le otto posizioni uscite per scadenza sono uscite tutte a `hold timeout` con picco
uguale al valore finale: nei primi dieci minuti **non era ancora successo niente**. Il movimento
arriva dopo.

Conseguenze applicate:

- `PUMP_MIGRATO_HOLD_MS` 600s -> **1.800s**, e `WORKER_MAX_LIFETIME_MS` 1.200s -> 2.400s perche' deve
  restare sopra l'hold piu' il tempo di valutazione.
- `SOLO_POOL_GRADUATE=true`: non si comprano piu' le curve non graduate. In 4 ore i 122 token non
  graduati comprati hanno preso il **60% del tempo di worker** per **-0,208 SOL** e nessun
  vincitore, mentre la valutazione completa di tutto (creator risk compreso) costava l'11 minuti, il
  5%. Non era il creator risk a rallentare: erano gli hold da 90s su una popolazione gia' misurata a
  zero (studio curva: 0 vincitori su 194).
- `CREATOR_RISK_CHECK_ENABLED=false`: con `FILTERS_MONITOR_ONLY` non blocca comunque, e l'unica cosa
  che produceva — l'attribuzione — si ricostruisce a posteriori su solscan per i soli token
  effettivamente comprati, che ora sono pochi e tutti interessanti. Vale ~6s e ~60 chiamate RPC per
  ciclo.

**Il vincolo si e' spostato, e va detto chiaro.** Con un worker solo e un hold da 30 minuti si
tengono **2 posizioni all'ora**, mentre le graduate che troveremo saranno molte di piu'. Da adesso il
limite non e' ne' l'RPC (0 errori 429 in 4 ore) ne' la valutazione: sono gli hold in serie. Il passo
successivo e' tenerne piu' d'una insieme — alzare `MAX_CONCURRENT_OPERATIONS`, o spostare il
monitoraggio dell'hold fuori dal worker. Non ancora fatto.

**Da rifare con questi dati:** il confronto fra i 5 razzi e i 7 morti, sia dopo la graduazione sia
*prima* (sulla curva, on-chain), per cercare un discriminante d'ingresso. `SOL1S` da solo non lo e':
i tre razzi da $50M+ stanno a ~3.000 SOL, ma `tpW7rsb7` con 7.988 SOL e' morto a $383.

## 51. I controlli del paper trade stonk.fun (2026-09-14)

Nessuno di questi e' ancora giustificato da una misura nostra: sono il punto di partenza per
misurare, non una conclusione. L'unico ancorato a un'osservazione e' `STONK_ENTRATA`, preso dalla
mediana d'ingresso di `FiFawHqx` (1,58%), l'operatore studiato in `docs/stonk-fun.md`.

| controllo | default | perche' |
|---|---|---|
| `STONK_ENTRATA` | 0,015 | dove entra chi questo mestiere lo fa gia'; da rimisurare sui nostri dati |
| `STONK_USCITE` | +10,15,25,40,60,100,300,1000% | non una soglia ma **tutte insieme**: su ogni ingresso si apre una posizione virtuale per ciascuna, cosi' una sessione misura tutte le uscite invece di una. Sono guadagni di **prezzo dall'ingresso**, non livelli di raccolta: erano livelli assoluti (2%, 3%, 5%...) e con quelli chi entrava su una curva gia' al 7% non aveva piu' nessuna uscita vicina — gli restavano solo le lontane, che sulle prime 180 posizioni centravano il bersaglio nel 3% dei casi contro il 73-82% delle vicine. Nessuna scende sotto il +10%: i costi del giro completo misurati sono 6,6 punti, sotto quella soglia si perde anche indovinando |
| `STONK_RICADUTA` | 0,10 | si esce se il **prezzo** scende del 10% dall'ingresso. Era un punto di raccolta, ma un punto vale movimenti diversi a seconda di dove si entra (-5,3% di prezzo al 2% di raccolta, -3,6% al 20%): la stessa regola era una cosa diversa per ogni ingresso. Misurato su 132 uscite per ricaduta: il prezzo era sceso del 6,8% e incassavamo -13,3%, cioe' **meta' della perdita tipica sono i nostri costi**, e scala con la tassa del token (-10,5% senza tassa, -11,6% all'1%, -14,8% al 3%) |
| `STONK_SCADENZA_MS` | 1.800.000 | mezz'ora: oltre, la posizione dice piu' sul capitale fermo che sulla curva |
| `STONK_TAGLIA_FRAZIONE` | 0,002 | lo 0,2% del bersaglio, **non** una cifra fissa: i quote sono 21 asset con scale da 11 a 31 milioni di unita', e solo rapportandosi al bersaglio l'impatto sul prezzo resta lo stesso su tutti (~1,1% a curva vuota) |
| `STONK_FEE_SCAMBIO` | 0,0125 | l'1,25% dichiarato da Raydium+stonk, per lato |
| `STONK_ANCHE_SOPRA` | true | compra anche le curve incontrate **gia'** oltre la soglia, taggandole `modo: sopra`. Non e' una scelta: e' la domanda "varrebbe la pena comprarle lo stesso?" girata al campo, cosi' il report confronta i due ingressi sulla stessa sessione |
| `STONK_MAX_INGRESSO` | 0,025 | oltre il 2,5% di raccolta non si entra. Era 0,30, messo a occhio. Due misure indipendenti dicono 2,5: **FiFawHqx** su 25 acquisti verificati sulla curva non ha mai comprato sopra il **2,33%** (mediana 0,85%), e le nostre 95 pool dicono che comprando sotto il 3% il prezzo sale del 10% nel 76% dei casi con discesa mediana **zero**, mentre comprando fra il 10 e il 30% ci arriva nel 27% dei casi con discesa mediana -10,5% — e quelle le avevamo guardate dieci volte piu' a lungo |
| `STONK_USCITE_TEMPO` | **vuoto (spente)** | uscite a tempo secco: si usciva dopo N secondi comunque fosse andata. **Tolte sulla misura**: su 58 posizioni ciascuna hanno fatto -4,4% (`t5`), -5,4% (`t10`) e -5,6% (`t30`), il campione piu' grande che avessimo. Appaiando le stesse pool si vede il motivo: uscire sempre a 5 secondi salva 10 punti quando la pool muore ma ne butta 16 quando corre, perche' vende anche le vincenti. Resta la versione condizionata (`STONK_USCITE_PAREGGIO`), che taglia solo quelle ferme. Chiave conservata: basta valorizzarla nel `.env` per riaccenderle |
| `STONK_USCITE_META` | +25%, +60% | uscite **a meta'**: si vende `STONK_FRAZIONE_META` all'obiettivo e il resto continua fino allo stop o alla scadenza. E' l'unica differenza vera fra una regola secca e quello che fa FiFawHqx, che vende in piu' pezzi (fino a 7 sullo stesso token) |
| `STONK_USCITE_RACCOLTA` | 5,10,20,50,100% | uscite a **completamento**: si esce quando la curva arriva a quella quota del bersaglio, comunque sia andato il prezzo (100% = si tiene fino alla migrazione). E' la vecchia regola assoluta, che aveva senso togliere quando si comprava fino al 30% — chi entrava tardi non aveva piu' nessuna uscita vicina — e che torna ad averne ora che si compra solo sotto il 2,5%: tutti gli ingressi partono dallo stesso punto |
| `STONK_USCITE_PAREGGIO` | **vuoto (spente)** | uscite a pareggio ritardato: dopo N secondi si usciva appena non si era in guadagno. L'idea resta valida (le vincite arrivano in ~6 secondi mediani, le perdite marciscono per 24-89, e solo l'8% delle perdite si chiude entro 5 secondi contro il 46% delle vincite), ma la regola com'e' scritta **non ha nessuna uscita in guadagno**: chi a N secondi e' sopra resta dentro finche' non scende del 10% sotto l'ingresso, cioe' finche' non ha restituito tutto. Per riaccenderle serve prima decidere cosa fa uscire una vincente — un obiettivo abbinato o uno stop mobile. Chiave conservata |
| `STONK_FRAZIONE_META` | 0,5 | quanta parte si vende all'obiettivo nelle regole `m`. Mezzo e' un punto di partenza, non una misura |
| `STONK_MAX_APERTE` | 8.000 | solo un tetto di memoria. Era 400: con `STONK_ANCHE_SOPRA` le posizioni vive insieme sono migliaia (mezz'ora di scadenza per decine di ingressi al minuto), il tetto veniva toccato in dieci minuti e gli ingressi sparivano in silenzio |
| `STONK_CREAZIONI_AL_SEC` | 4 | ~150 nascite all'ora, ognuna con qualche ritentativo |
| `STONK_SCADENZE_AL_SEC` | 10 | quante pool con posizioni scadute risolvere al secondo chiedendole all'RPC. Serve perche' la curva la vediamo solo quando qualcuno la scambia: senza, una posizione scaduta resta appesa al prossimo scambio altrui, e `t10` chiudeva dopo 24 secondi di mediana, `t30` dopo 59. Rendeva ingiusta proprio la prova delle uscite a tempo, che e' quella che copia FiFawHqx |

La tassa sui trasferimenti **non** e' un controllo: si legge dal mint a ogni ingresso, perche' vale
1% o 3% a scelta di chi lancia e sul giro completo la differenza e' 4 punti.

**Tre trappole di commitment, tutte trovate sul campo.** I log arrivano a `processed`: la
transazione di creazione non e' leggibile subito (`getTransaction` va chiesto a `confirmed` e
ritentato, la prima volta torna `null` circa una volta su due), e **nemmeno l'account appena creato**
(`getAccountInfo` va chiesto a `confirmed`, altrimenti torna `null` e la nascita sparisce in
silenzio). La terza: non si puo' scartare una pool perche' "gia' conosciuta", perche' fra la
creazione e il momento in cui riusciamo a leggerla passano uno o due secondi e in quel tempo ha gia'
scambiato ed e' arrivata da `programSubscribe`.
