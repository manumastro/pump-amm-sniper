# Controls

Guida breve ai controlli del bot, divisi per fase.

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
- creator che richiama direttamente `pAMMBay...` dopo `create_pool`

Blacklist lette solo da:
- `blacklists/creators.txt`
- `blacklists/funders.txt`
- `blacklists/micro-burst-sources.txt`
- `blacklists/cashout-relays.txt`
- `blacklists/funder-counts.json`

Esito:
- se il rischio e alto: `SKIP: creator risk`

Log principali:
- `CRISK | cp=... in=... out=... window=... funder=... refund=... micro=.../...`
- `RRELAY | root=... funder=... in=... out=... window=...`
- `CAMM | creator direct pAMMBay... re-entry via ...`
- `CCASH | total=... max=... rel=... score=... dest=...`

Lettura pratica:
1. `RRELAY` da solo non significa per forza rug.
2. Su pool standard da creator fresh/relay-funded e molto piu pericoloso.
3. `CAMM` e un segnale duro: il creator ha toccato di nuovo l'AMM dopo il `create_pool`.

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

### 1.6 Top 10 Concentration
Scopo:
- evitare distribuzioni esterne troppo concentrate

Cosa misura:
- quota dei maggiori holder esterni
- opzionalmente esclude il pool dal conteggio

Controlli:
- `PRE_BUY_TOP10_CHECK_ENABLED`
- `PRE_BUY_TOP10_MAX_PCT`
- `PRE_BUY_TOP10_EXCLUDE_POOL`

Comportamento:
- prova il mint estratto
- se serve, prova fallback dal pool
- ritenta alcune volte
- se il dato non e calcolabile per errore tecnico: `fail-open`
- se il dato e calcolabile e supera soglia: blocca

Esito:
- `SKIP: pre-buy top10` solo quando la concentrazione e davvero oltre soglia

Log:
- `TOP10 | <pct>% (max <pct>%)`
- `TOP10 | unavailable (...) -> fail-open`

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

### 2.3 Post-Entry Stability Gate
Scopo:
- uscire se i primi secondi dopo il buy sono troppo instabili

Controlli:
- `POST_ENTRY_STABILITY_GATE_ENABLED`
- `POST_ENTRY_STABILITY_GATE_WINDOW_MS`
- `POST_ENTRY_STABILITY_GATE_DROP_PCT`

Segnali:
- calo spot
- calo liquidita

Esito:
- exit veloce nei primi secondi

Log:
- `STABILITY GATE: early exit ...`

### 2.4 Liquidity Stop
Scopo:
- uscire se spot o liquidita collassano durante hold

Controlli:
- `LIQUIDITY_STOP_ENABLED`
- `LIQUIDITY_STOP_DROP_PCT`
- `LIQUIDITY_STOP_CHECK_INTERVAL_MS`

Segnali:
- spot rispetto all'entry
- liquidita rispetto all'entry

Esito:
- exit anticipata

Log:
- `LIQUIDITY STOP: trigger early exit ...`

## 3. Post-trade

### 3.1 Sell Guard
Scopo:
- marcare i casi in cui il sell simulato e di fatto non eseguibile

Regole:
- se `solOut <= 0`: `SKIP: paper simulation guard (exit returned 0 SOL)`
- se perdita oltre guard: `SKIP: paper simulation guard`

Log:
- `SELL_SPOT`
- `PNL`

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

- `LIQUIDITY STOP`
  - pool o spot collassati rispetto all'entry

- `SKIP: paper simulation guard (exit returned 0 SOL)`
  - la pool era di fatto gia morta al momento dell'uscita

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
