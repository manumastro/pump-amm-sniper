# Controls

Guida breve ai controlli del bot, divisi per fase.

## Implementazione

Direzione architetturale attuale:
- orchestrazione runtime: `src/pumpAmmSniper.ts`
- bootstrap / supervisor / worker lifecycle: `src/app/bootstrap.ts`, `src/app/runtime.ts`, `src/app/worker.ts`
- config condivisa: `src/app/config.ts`
- tipi condivisi: `src/domain/types.ts`
- motore creator risk: `src/services/creator-risk/index.ts`
- pre-buy / hold / paper simulation: `src/services/paper-trade/`
- liquidity recheck: `src/services/liquidity/`
- token security: `src/services/token-security/`
- top10 concentration: `src/services/top10/`
- dev holdings: `src/services/dev-holdings/`
- logging operativo: `src/services/reporting/stageLog.ts`
- struttura target del refactor: `docs/architecture.md`

Regola:
- i nuovi controlli non vanno aggiunti direttamente in `src/pumpAmmSniper.ts`
- i controlli vanno estratti progressivamente in servizi dedicati mantenendo invariati comportamento e log operativi

## Obiettivo

Il bot prova a evitare 3 classi di problemi:
1. token formalmente insicuri
2. creator / funder / relay sospetti
3. pool che collassano poco dopo l'ingresso

## Flusso generale

Per ogni nuovo `create_pool` il bot esegue:
1. parse della tx
2. risoluzione di `token`, `pool`, `creator`
3. controllo liquidita iniziale
4. controllo mint / freeze
5. controllo creator risk
6. attesa pre-buy e conferme
7. controllo `Top 10`
8. buy simulato o live
9. monitoraggio durante hold
10. controllo finale dev holdings

## 1. Pre-entry

### 1.1 Parse e Resolve
Scopo:
- capire quale token e quale pool stiamo guardando
- ricavare il creator reale

Log principali:
- `TOKEN`
- `POOL`
- `GMGN`
- `CREATOR`

### 1.2 Liquidity Check
Scopo:
- evitare pool troppo piccoli o inutili

Controllo:
- solo soglia in SOL
- variabile: `MIN_POOL_LIQUIDITY_SOL`

Esito:
- se sotto soglia: `SKIP: low liquidity`

Log:
- `LIQ | <n> SOL`

### 1.3 Mint / Freeze Security
Scopo:
- evitare token ancora controllabili dal dev

Controlli:
- mint authority deve essere rinunciata
- freeze authority deve essere assente

Esito:
- se uno dei due fallisce: `SKIP: token security`

Log:
- `Mint Authority NOT renounced`
- `Freeze Authority ENABLED`
- `Mint/Freeze Security: PASSED`

### 1.4 Creator Risk
Scopo:
- bloccare creator sospetti anche se il token sembra pulito

Segnali usati:
- seed SOL reale del creator nella `create_pool`, confrontato con la liquidity osservata prima del buy
- creator blacklistato
- funder blacklistato
- micro-burst source blacklistata
- cashout relay blacklistato
- funder gia visto in piu rug storici
- funder attivo su piu creator in una finestra breve
- molte controparti in poco tempo
- attivita molto compressa nel tempo
- creator che rimborsa il funder
- micro-transfer burst verso il creator
- relay funding recente: `root -> funder -> creator`
- relay funding recente combinato con micro-burst
- relay funding recente su pool standard (`84.99 / 100 / 120 SOL`)
- relay-root gia noto come sospetto + `cp` alto + `out` alto + micro quasi assente
- relay-root sospetto + `spray outbound`: tante uscite molto simili verso molte destinazioni
- `inbound collector pattern`: tanti inbound simili da molte source verso il creator in finestra breve
- creator che richiama direttamente `pAMMBay...` dopo `create_pool`
- burst outbound pre-create (anche sub-SOL se molto uniformi e numerosi, non solo ~1 SOL)
- pattern ripetuto `create_pool -> remove_liquidity -> cashout`, seguito da un nuovo `create_pool` nella stessa finestra breve

Blacklist lette solo da:
- `blacklists/creators.txt`
- `blacklists/funders.txt`
- `blacklists/micro-burst-sources.txt`
- `blacklists/cashout-relays.txt`
- `blacklists/funder-counts.json`

Esito:
- se il rischio e alto: `SKIP: creator risk`
- opzionale in paper-only: `probation` (niente skip, hold corto forzato)

Controllo probation paper-only:
- `PAPER_CREATOR_RISK_PROBATION_ENABLED`
- `PAPER_CREATOR_RISK_PROBATION_HOLD_MS`
- `PAPER_CREATOR_CASHOUT_PROBATION_HOLD_MS`
- `PAPER_CREATOR_RISK_EXTREME_CASHOUT_BLOCK_ENABLED`
- `PAPER_CREATOR_RISK_EXTREME_CASHOUT_MIN_PCT_OF_LIQ`
- `PAPER_CREATOR_RISK_EXTREME_CASHOUT_MIN_SCORE`
- `PAPER_CREATOR_RISK_PROBATION_UNIQUE_COUNTERPARTIES_BLOCK_ENABLED`
- `PAPER_CREATOR_RISK_PROBATION_UNIQUE_COUNTERPARTIES_MIN`
- `PAPER_CREATOR_RISK_PROBATION_UNIQUE_COUNTERPARTIES_MIN_OUT_TRANSFERS`
- `PAPER_CREATOR_RISK_PROBATION_UNIQUE_COUNTERPARTIES_MAX_IN_TRANSFERS`
- `PAPER_CREATOR_RISK_PROBATION_LOW_CASHOUT_BLOCK_ENABLED`
- `PAPER_CREATOR_RISK_PROBATION_LOW_CASHOUT_MIN_SOL`
- `PAPER_CREATOR_RISK_PROBATION_LOW_CASHOUT_MIN_PCT_OF_LIQ`
- `PAPER_CREATOR_RISK_PROBATION_LOW_CASHOUT_MIN_SCORE`

Eccezioni:
- nessun probation bypass per `creator in historical rug blacklist`
- nessun probation bypass per `funder blacklisted ...`
- nessun probation bypass per `relay funding recent on standard pool`
- nessun probation bypass per `relay funding recent + micro burst`
- nessun probation bypass per `standard pool outbound-heavy creator history`
- nessun probation bypass per `micro inbound burst`
- nessun probation bypass per `creator direct AMM re-entry`
- nessun probation bypass per `creator seed too small ...`
- nessun probation bypass per `creator cashout` gia estremo rispetto alla liquidity iniziale
- nessun probation bypass per `unique counterparties` gia outbound-heavy oltre le soglie dedicate
- nessun probation bypass per `creator cashout` gia sospetto oltre le soglie probation dedicate

Durata:
- probation normale: `PAPER_CREATOR_RISK_PROBATION_HOLD_MS`
- probation per `creator cashout ...`: `PAPER_CREATOR_CASHOUT_PROBATION_HOLD_MS`
- block hard se il `creator cashout` e gia circa tutta la liquidity iniziale

Log principali:
- `CRISK | cp=... in=... out=... window=... funder=... refund=... micro=.../...`
- `RRELAY | root=... funder=... in=... out=... window=...`
- `CAMM | creator direct pAMMBay... re-entry via ...`
- `CCASH | total=... max=... rel=... score=... dest=...`
- `SEED | creator=... SOL pct=...% growth=...x`
- `ISPRAY | in=... src=... median=... rel_std=... ratio=...`
- `PBURST | precreate out=... dest=... total=... median=... rel_std=... ratio=...`
- `RREPEAT | create=... remove=... cashout=... window=... max_out=...`
- `PROBATION | paper-only bypass creator risk (...) hold=...ms`

Lettura pratica:
1. `RRELAY` da solo non significa per forza rug.
2. Su pool standard da creator fresh/relay-funded e molto piu pericoloso.
3. `CAMM` e un segnale duro: il creator ha toccato di nuovo l'AMM dopo il `create_pool`.
4. `cp alto + out alto + low micro + relay-root sospetto` e un pattern da wallet operativo, non retail.
5. `spray outbound` = il creator distribuisce importi quasi uguali a molti wallet: pattern infrastrutturale, non utente normale.
6. `seed troppo piccolo` = il creator ha quasi zero skin in the game rispetto alla liquidity che vedevamo prima del buy.
7. `inbound collector` = molti wallet alimentano il creator con importi simili in poco tempo: pattern di coordinamento, non domanda organica.
8. `precreate burst` = raffica di outbound quasi uguali subito prima del create_pool, anche sub-SOL se numerosi: pattern operativo ad alto rischio.
9. `RREPEAT` = il creator ha gia fatto almeno un ciclo `create/remove/cashout` recente e sta riprovando: da trattare come skip pre-buy, non come segnale da hold.

Gerarchia pratica dei segnali:
1. `CCASH` = segnale economico forte: il creator sta gia portando via SOL.
2. `RRELAY` = segnale infrastrutturale forte: funding coordinato `root -> funder -> creator`.
3. `micro-burst` = segnale comportamentale: attivita compressa e artificiale.

### 1.5 Pre-Buy Wait
Scopo:
- non comprare subito alla detection del pool
- aspettare il primo trade reale
- vedere se la liquidita regge un minimo

Regola:
- il timer parte dal primo trade del pool, non dalla detection

Controlli:
- attesa del primo trade
- `PRE_BUY_WAIT_MS`
- `PRE_BUY_CONFIRM_SNAPSHOTS`
- `PRE_BUY_CONFIRM_INTERVAL_MS`

Esito:
- se la liquidita degrada troppo durante l'attesa: `SKIP: pre-entry wait`

Log:
- `WAIT | waiting for first pool trade`
- `WAIT | first trade ... remaining ...`
- `WAIT | pre-entry liquidity ... (min observed ...)`

### 1.6 Pre-Buy Revalidation
Scopo:
- rifare il check del pool immediatamente prima del buy
- evitare ingressi dopo wait/probation su pool gia degradati o svuotati

Controlli:
- `PRE_BUY_REVALIDATION_ENABLED`
- `PRE_BUY_FINAL_CREATOR_RISK_RECHECK_ENABLED`
- `PRE_BUY_FINAL_REMOVE_LIQ_CHECK_ENABLED`
- `PRE_BUY_REVALIDATION_MAX_LIQ_DROP_PCT`
- `PRE_BUY_REVALIDATION_MAX_QUOTE_VS_SPOT_RATIO`

Segnali:
- creator risk peggiorato nell'ultima frazione di secondo prima del buy
- `remove liquidity` gia visibile sul pool prima dell'ingresso
- liquidity live troppo bassa rispetto alla baseline osservata
- `buy quote` molto peggiore dello `spot`

Esito:
- `SKIP: pre-buy revalidation`

Log:
- `PREBUY | liq ...`
- `PREBUY | quote_vs_spot=...x ...`

### 1.7 Top 10 Concentration
Scopo:
- evitare distribuzioni esterne troppo concentrate

Cosa misura:
- quota dei maggiori holder esterni
- opzionalmente esclude il pool dal conteggio

Controlli:
- `PRE_BUY_TOP10_CHECK_ENABLED`
- `PRE_BUY_TOP10_MAX_PCT`
- `PRE_BUY_TOP10_EXCLUDE_POOL`
- `PRE_BUY_TOP10_FAIL_OPEN`
- `PRE_BUY_TOP10_MAX_ATTEMPTS`
- `PRE_BUY_TOP10_RETRY_BASE_MS`

Comportamento:
- prova il mint estratto
- se serve, prova fallback dal pool
- ritenta alcune volte con backoff crescente
- se il dato non e calcolabile per errore tecnico:
  - `PRE_BUY_TOP10_FAIL_OPEN=true` -> `fail-open`
  - `PRE_BUY_TOP10_FAIL_OPEN=false` -> `fail-closed` (default consigliato)
- se il dato e calcolabile e supera soglia: blocca

Esito:
- `SKIP: pre-buy top10` quando:
  - la concentrazione supera soglia
  - oppure il check non e calcolabile in modalita fail-closed

Log:
- `TOP10 | <pct>% (max <pct>%)`
- `TOP10 | retry X/Y after error: ...`
- `TOP10 | unavailable (...) -> fail-open`
- `TOP10 | unavailable (...) -> fail-closed`

### 1.8 Shadow Audit Dei Filtri
Scopo:
- misurare l'upside perso su alcuni filtri senza cambiare il path decisionale live
- capire se un filtro sta scartando troppe operazioni non-rug

Regola:
- lo shadow audit non apre trade live
- lo shadow audit non cambia `skip`, `probation`, `buy` o `sell` del bot
- gira solo come simulazione silenziosa aggiuntiva su casi mirati

Target attuali:
- `creator risk` con motivo `standard pool micro burst ...`
- `creator risk` con motivo `standard pool outbound-heavy creator history ...`
- `creator risk` con motivo `creator cashout ...`
- `creator risk` con motivo `creator refunded funder ...`
- `creator risk` con motivo `burner profile ...`
- `creator risk` con motivo `rapid creator dispersal ...`

Config:
- `SHADOW_AUDIT_ENABLED`
- `SHADOW_AUDIT_STANDARD_POOL_MICRO_BURST_ENABLED`
- `SHADOW_AUDIT_STANDARD_POOL_OUTBOUND_HEAVY_ENABLED`
- `SHADOW_AUDIT_CREATOR_CASHOUT_ENABLED`
- `SHADOW_AUDIT_CREATOR_REFUNDED_FUNDER_ENABLED`
- `SHADOW_AUDIT_BURNER_PROFILE_ENABLED`
- `SHADOW_AUDIT_RAPID_CREATOR_DISPERSAL_ENABLED`

Comportamento:
- se un evento matcha il filtro auditabile, il bot esegue una `paper simulation` silenziosa
- la simulazione audit lascia attivi gli altri guard rail del motore paper
- l'esito viene salvato come telemetria aggiuntiva, non come operazione reale
- se il caso passa in `probation` ma viene fermato prima della `paper simulation` da `pre-entry guard` o `pre-buy top10`, viene comunque emesso un evento `AUDIT` con `pnlSol/pnlPct = null` e `finalStatus` valorizzato

Output:
- evento log `AUDIT | {...}`
- riepilogo in `logs/paper-report.json` sotto `shadowAuditSummary`
- riepilogo testo in `logs/paper-report.txt` sotto `Shadow audit summary`

Uso pratico:
- serve per stimare `quanti casi bloccati sarebbero stati profittevoli`
- serve per stimare `quanto pnl teorico abbiamo lasciato sul tavolo` per filtro
- non sostituisce il parser Solscan: Solscan resta strumento di drill-down manuale sui casi piu interessanti

Nota:
- i casi `probation` dei bucket auditati vengono registrati in due modi:
- `source: "probation-observed"` se completano la `paper simulation`
- `source: "probation-blocked-pre-entry"` o `source: "probation-blocked-top10"` se vengono fermati prima

## 2. Durante hold

Questi controlli possono far uscire prima del `AUTO_SELL_DELAY_MS`.

### 2.1 Creator Risk Recheck
Scopo:
- vedere segnali sospetti che emergono solo dopo il buy

Controlli:
- `HOLD_CREATOR_RISK_RECHECK_ENABLED`
- `HOLD_CREATOR_RISK_RECHECK_INTERVAL_MS`

Esito:
- se il creator diventa sospetto dopo il buy: exit immediata

Log:
- `CRISK | ...`
- `RRELAY | ...`
- `CAMM | ...`
- `CREATOR RISK EXIT: ...`

### 2.2 Creator Cashout Risk
Scopo:
- capire se il creator inizia a spostare SOL verso terzi

Non usa una sola soglia secca.
Usa un punteggio basato su:
- cashout totale in SOL
- cashout relativo alla liquidita iniziale
- singolo cashout massimo

Controlli:
- `HOLD_CREATOR_CASHOUT_EXIT_ENABLED`
- `CREATOR_RISK_CASHOUT_ABS_SOL`
- `CREATOR_RISK_CASHOUT_REL_LIQ_PCT`
- `CREATOR_RISK_CASHOUT_WARN_SCORE`
- `CREATOR_RISK_CASHOUT_EXIT_SCORE`

Esito:
- warning se borderline
- exit se il punteggio supera la soglia critica

Log:
- `CCASH | total=... max=... rel=... score=... dest=...`

### 2.3 Short Hold su RRELAY
Scopo:
- ridurre la finestra di esposizione quando c'e relay funding sospetto

Controlli:
- `HOLD_SUSPICIOUS_RELAY_SHORT_HOLD_ENABLED`
- `HOLD_SUSPICIOUS_RELAY_SHORT_HOLD_MS`

Segnale:
- `RRELAY` presente nel creator-risk pre-entry

Esito:
- hold ridotto ma meno aggressivo (es. 15s) invece di `AUTO_SELL_DELAY_MS`

Log:
- `HOLD | suspicious relay root ... -> short hold ...ms`
- `HOLD | probation hold ...ms (paper creator-risk bypass)`

### 2.4 Remove Liquidity Exit (on-chain)
Scopo:
- uscire quando il creator inizia a rimuovere liquidita dal pool

Controlli:
- `HOLD_REMOVE_LIQ_DETECT_ENABLED`
- `HOLD_REMOVE_LIQ_CHECK_INTERVAL_MS`
- `HOLD_REMOVE_LIQ_MIN_WSOL_TO_CREATOR`
- `HOLD_REMOVE_LIQ_MIN_SOL_TO_CREATOR`
- `HOLD_CREATOR_AMM_BURST_DETECT_ENABLED`
- `HOLD_CREATOR_AMM_BURST_WINDOW_SEC`
- `HOLD_CREATOR_AMM_BURST_MIN_TXS`
- `HOLD_CREATOR_OUTBOUND_EXIT_ENABLED`
- `HOLD_CREATOR_OUTBOUND_CHECK_INTERVAL_MS`
- `HOLD_CREATOR_OUTBOUND_MIN_SOL`
- `HOLD_CREATOR_CLOSE_ACCOUNT_BURST_EXIT_ENABLED`
- `HOLD_CREATOR_CLOSE_ACCOUNT_BURST_CHECK_INTERVAL_MS`
- `HOLD_CREATOR_CLOSE_ACCOUNT_BURST_WINDOW_SEC`
- `HOLD_CREATOR_CLOSE_ACCOUNT_BURST_MIN_TXS`
- `HOLD_CREATOR_CLOSE_ACCOUNT_BURST_MIN_CLOSES`
- `HOLD_CREATOR_OUTBOUND_SPRAY_EXIT_ENABLED`
- `HOLD_CREATOR_OUTBOUND_SPRAY_CHECK_INTERVAL_MS`
- `HOLD_CREATOR_OUTBOUND_SPRAY_WINDOW_SEC`
- `HOLD_CREATOR_OUTBOUND_SPRAY_MIN_TRANSFERS`
- `HOLD_CREATOR_OUTBOUND_SPRAY_MIN_DESTINATIONS`
- `HOLD_CREATOR_OUTBOUND_SPRAY_MAX_MEDIAN_SOL`
- `HOLD_CREATOR_OUTBOUND_SPRAY_MAX_REL_STDDEV`
- `HOLD_CREATOR_OUTBOUND_SPRAY_MAX_AMOUNT_RATIO`
- `HOLD_CREATOR_INBOUND_SPRAY_EXIT_ENABLED`
- `HOLD_CREATOR_INBOUND_SPRAY_CHECK_INTERVAL_MS`
- `HOLD_CREATOR_INBOUND_SPRAY_WINDOW_SEC`
- `HOLD_CREATOR_INBOUND_SPRAY_MIN_TRANSFERS`
- `HOLD_CREATOR_INBOUND_SPRAY_MIN_SOURCES`
- `HOLD_CREATOR_INBOUND_SPRAY_MAX_REL_STDDEV`
- `HOLD_CREATOR_INBOUND_SPRAY_MAX_AMOUNT_RATIO`
- `HOLD_POOL_CHURN_DETECT_ENABLED`
- `HOLD_POOL_CHURN_CHECK_INTERVAL_MS`
- `HOLD_POOL_CHURN_SIG_LIMIT`
- `HOLD_POOL_CHURN_WINDOW_SHORT_MS`
- `HOLD_POOL_CHURN_WINDOW_LONG_MS`
- `HOLD_POOL_CHURN_WINDOW_CRITICAL_MS`
- `HOLD_POOL_CHURN_TX_SHORT_MIN`
- `HOLD_POOL_CHURN_TX_LONG_MIN`
- `HOLD_POOL_CHURN_TX_CRITICAL_MIN`
- `HOLD_POOL_CHURN_SELL_DROP_PCT`
- `HOLD_POOL_CHURN_CRITICAL_SELL_DROP_PCT`
- `HOLD_SELL_QUOTE_COLLAPSE_EXIT_ENABLED`
- `HOLD_SELL_QUOTE_COLLAPSE_CHECK_INTERVAL_MS`
- `HOLD_SELL_QUOTE_COLLAPSE_MIN_HOLD_MS`
- `HOLD_SELL_QUOTE_COLLAPSE_DROP_PCT`
- `HOLD_SELL_QUOTE_COLLAPSE_MIN_SOL`
- `HOLD_PROBATION_CASHOUT_DELTA_MIN_SOL`
- `HOLD_PROBATION_INTERVAL_MULTIPLIER`

Segnali:
- tx on-chain che tocca il programma AMM del pool
- ingresso WSOL/SOL significativo verso creator durante la tx
- burst di tx AMM del creator sullo stesso pool in finestra breve
- burst di `closeAccount` firmati/pagati dal creator durante l'hold
- churn anomalo del pool in finestra breve combinato con collasso della `SELL_QUOTE`
- collasso diretto della `SELL_QUOTE` rispetto alla baseline del buy anche senza churn sufficiente

Esito:
- exit anticipata immediata su `remove-liquidity-like`
- exit anticipata immediata su burst outbound piccoli/uniformi del creator durante l'hold
- exit anticipata immediata su burst inbound piccoli/uniformi verso il creator durante l'hold
- exit anticipata immediata su `CREATOR CLOSE ACCOUNT BURST EXIT`
- exit anticipata immediata su `POOL CHURN EXIT` quando il numero di tx recenti e la `SELL_QUOTE` peggiorano insieme
- exit anticipata immediata su `SELL QUOTE COLLAPSE EXIT` quando la quote perde troppo o scende sotto una soglia minima assoluta
- in probation i polling di hold diventano piu aggressivi usando `HOLD_PROBATION_INTERVAL_MULTIPLIER`

Log:
- `REMOVE LIQUIDITY EXIT: ...`
- `CREATOR AMM BURST EXIT: ...`
- `CREATOR OUTBOUND EXIT: ...`
- `CREATOR CLOSE ACCOUNT BURST EXIT: ...`
- `POOL CHURN EXIT: ...`
- `SELL QUOTE COLLAPSE EXIT: ...`
- `CREATOR RISK EXIT: ...`
- `CREATOR RISK EXIT (probation hard): ...`

## 3. Post-trade

### 3.1 Sell Guard
Scopo:
- marcare i casi in cui il sell simulato e di fatto non eseguibile

Regole:
- se `solOut <= 0`: perdita piena `-100%` con stato `PAPER LOSS` (non `SKIP`)
- se perdita oltre guard: `PAPER LOSS`

Log:
- `BUY_SPOT`
- `BUY_QUOTE`
- `SELL_SPOT`
- `SELL_QUOTE`
- `PNL`

Lettura:
- `*_SPOT` = prezzo teorico da riserve del pool
- `*_QUOTE` = output eseguibile usato per il PnL

### 3.2 Dev Holdings Check
Scopo:
- vedere quanta supply resta al creator dopo l'operazione

Controlli:
- wallet creator
- token accounts creator
- percentuale detenuta

Esito:
- warning o blocco in base alla configurazione

Log:
- `DEV | holding ...`
- `DEV | creator wallet token balance is 0 after create_pool (can be normal)`

## 4. File importanti

### Config
- `.env`
- `.env.example`
- `SILENCE_RPC_429_LOGS` (se `true`, nasconde i log rumorosi di retry `429 Too Many Requests`)

### Blacklist
- `blacklists/creators.txt`
- `blacklists/funders.txt`
- `blacklists/micro-burst-sources.txt`
- `blacklists/cashout-relays.txt`
- `blacklists/funder-counts.json`

### Report
- `paper.log`
- `logs/paper-report.json`
- `logs/paper-report.txt`

## 5. Lettura rapida dei log

### Se vedi questo
- `SKIP: token security`
  - token non sicuro a livello mint/freeze

- `SKIP: creator risk`
  - creator / funder / relay / micro-burst sospetti

- `SKIP: pre-buy top10`
  - concentrazione holder esterni troppo alta

- `CREATOR RISK EXIT`
  - creator diventato sospetto durante hold

- `REMOVE LIQUIDITY EXIT`
  - rilevata rimozione liquidita on-chain verso creator durante hold

- `PAPER LOSS` con `exit returned 0 SOL`
  - la pool era di fatto morta per noi al momento dell'uscita, e va in PnL come `-100%`

## 6. Regola pratica

Se un caso passa i controlli ma finisce comunque in `-100%`, di solito manca uno di questi segnali:
1. relay funding recente non ancora blacklistato
2. micro-burst infra non ancora blacklistata
3. cashout path nuovo non ancora blacklistato
4. `Top10` non calcolabile e andato `fail-open`

Quando succede:
- analizza creator, funder, relay e micro-sources
- aggiungi gli indirizzi sospetti nelle blacklist dedicate
- non usare i report come fonte blacklist

Regola operativa restart:
- dopo modifiche importanti ai controlli, fermare i servizi, azzerare log/report e poi riavviare.

## 6.0 Modifiche precedenti (prima del tuning top10)

Correzioni implementate:
- `exit returned 0 SOL` in paper trade ora e `PAPER LOSS` con PnL `-100%` (non `SKIP`)
- in monitor-only il risultato usa `paper.finalStatus` (evita classificazioni ambigue su perdite reali)
- `creator risk` include forzatamente la `create_pool` tx anche quando `getSignaturesForAddress` lagga
- during hold il loop controlla subito (non aspetta il primo sleep) e usa polling capped per ridurre blind window
- report daemon inferisce PnL effettivo `-100%` anche sui record legacy con PnL nullo e `exit returned 0 SOL`

## 6.1 Scoperte operative (forensics rug-loss, 2026-03-09)

Dati emersi su `logs/rug-loss-forensics.{json,txt}`:
- `36` rug-loss analizzati
- `32` casi `exit returned 0 SOL`
- `29/36` con `TOP10 unavailable -> fail-open`
- `24/36` con withdraw creator rapido dopo `create_pool`
- `8/36` con cashout creator rapido dopo withdraw

Conclusioni:
- i casi `exit returned 0 SOL` non vanno trattati come `skip`, ma come perdita reale `-100%`
- il `top10 fail-open` e un punto debole concreto da irrigidire quando il contesto creator/funder e sospetto
- i pattern `create -> withdraw rapido -> cashout rapido` sono segnali dev ad alta priorita

## 7. Grey-Zone Winners

Esistono token che non sono `clean`, ma nemmeno rug immediati.

Caso tipico:
- `RRELAY` presente
- creator/funder/rete di funding con pattern infrastrutturale
- `TOP10` basso
- `DEV holding` a zero
- nessun refund al funder
- nessun drain durante il nostro hold
- trade comunque profittevole

Interpretazione:
- `trade buono`
- `dev non pulito`
- quindi non e un token sicuro, ma un `grey-zone winner`

Regola:
- non classificare come `dev buono` solo perche resta vivo 5-10 minuti
- classificare separatamente:
  1. qualita del trade
  2. pulizia del dev / funder / relay

## 8. Tre leve di tuning

Se vuoi rendere il bot piu severo sui casi grigi, le 3 leve piu utili sono:

1. `RRELAY` come warning forte
- non blocca da solo
- ma va considerato segnale strutturale di funding coordinato

2. soglia micro-burst piu bassa
- oggi il caso passa se i micro-transfer non superano il gate
- abbassare la soglia aumenta gli `SKIP: creator risk`

3. soglia cashout piu bassa
- se `CCASH` resta sotto la soglia critica, il bot continua
- abbassare la soglia rende piu facile uscire dai casi sospetti ma ancora vivi

## 9. Tuning sampling creator

Per ridurre i falsi negativi sui creator molto attivi:
- `CREATOR_RISK_SIG_LIMIT` (default 40)
- `CREATOR_RISK_PARSED_TX_LIMIT` (default 25)

Gate specifico per pattern pre-create (spray quasi uniforme):
- `CREATOR_RISK_PRECREATE_BURST_BLOCK_ENABLED`
- `CREATOR_RISK_PRECREATE_BURST_WINDOW_SEC`
- `CREATOR_RISK_PRECREATE_BURST_SIG_LIMIT`
- `CREATOR_RISK_PRECREATE_BURST_PARSED_TX_LIMIT`
- `CREATOR_RISK_PRECREATE_BURST_MIN_TRANSFERS`
- `CREATOR_RISK_PRECREATE_BURST_MIN_DESTINATIONS`
- `CREATOR_RISK_PRECREATE_BURST_MIN_MEDIAN_SOL`
- `CREATOR_RISK_PRECREATE_BURST_MAX_MEDIAN_SOL`
- `CREATOR_RISK_PRECREATE_BURST_MAX_REL_STDDEV`
- `CREATOR_RISK_PRECREATE_BURST_MAX_AMOUNT_RATIO`
Winner exit shadow audit:
- `winner-management-ambitious`: osserva i winner reali con un profilo di take profit/trailing stop leggermente piu permissivo del live.
- `winner-management-aggressive`: osserva gli stessi winner con un profilo ancora piu offensivo per catturare i runner più forti.
- `winner-management-ultra`: osserva gli stessi winner con un profilo estremo pensato per testare il limite massimo del momentum.
- Tutti e tre sono solo audit: non cambiano il path live, non alterano l'esito buy/sell del report principale e scrivono solo eventi `AUDIT`. Le soglie di trigger (arm), trailing e hard take profit per ciascuno sono configurabili in `src/app/config.ts`.
