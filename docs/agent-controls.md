# Pump AMM Sniper Controls

Questo documento descrive i controlli runtime realmente implementati nel bot, in ordine operativo, per aiutare un agente futuro a capire cosa viene filtrato, cosa causa `SKIP`, e cosa causa `EXIT` durante un hold paper/live.

## Flusso operativo

Per ogni nuovo `create_pool`:

1. Parse transaction
2. Resolve `tokenMint`, `poolAddress`, `creatorAddress`
3. Liquidity check
4. Mint/freeze security
5. Creator risk
6. Pre-buy wait e conferme
7. Pre-buy top10 concentration
8. Paper simulation oppure buy live
9. Durante hold: re-check creator risk + liquidity stop + stability gate
10. Dev holdings check finale in monitor mode

## 1. Liquidity Check

Scopo:
- evitare pool troppo piccoli o poco seri

Controlli:
- `MIN_POOL_LIQUIDITY_SOL`
- il bot oggi si basa di fatto sul floor SOL

Esito:
- se la liquidita e sotto soglia: `SKIP: low liquidity`

Log:
- `LIQ | <n> SOL`

## 2. Mint / Freeze Security

Scopo:
- evitare token ancora controllabili dal dev

Controlli:
- `REQUIRE_RENOUNCED_MINT=true`
- `REQUIRE_NO_FREEZE=true`

Esito:
- se `mintAuthority != null`: `SKIP: token security`
- se `freezeAuthority != null`: `SKIP: token security`

Log:
- `Mint Authority NOT renounced`
- `Freeze Authority ENABLED`
- `Mint/Freeze Security: PASSED`

## 3. Creator Risk

Scopo:
- bloccare creator con pattern anomali anche se il token sembra formalmente sicuro

Input osservati:
- ultime tx del creator
- controparti uniche
- numero transfer in/out
- finestra temporale compressa
- funder del creator
- link a creator storicamente rug
- clustering del funder
- eventuale refund del creator verso il funder

### Controlli attivi

#### 3.1 Historical Rug Blacklist
- se il creator e gia in blacklist storica da rug osservati nel report locale
- esito: `SKIP: creator risk`

#### 3.2 Funder Blacklist
- se il funder del creator coincide con funder/creator gia emersi in rug storici
- esito: `SKIP: creator risk`

#### 3.3 Historical Funder Cluster
- se quel funder compare in almeno `CREATOR_RISK_HISTORICAL_FUNDER_CLUSTER_MIN_RUG_CREATORS` rug creators storici
- esito: `SKIP: creator risk`

#### 3.4 Recent Funder Cluster
- se lo stesso funder compare su piu creator recenti nella finestra `CREATOR_RISK_FUNDER_CLUSTER_WINDOW_SEC`
- soglia: `CREATOR_RISK_FUNDER_CLUSTER_MIN_CREATORS`
- esito: `SKIP: creator risk`

#### 3.5 Link To Historical Rug Creators
- se nelle controparti del creator compare un wallet gia noto come rug creator
- esito: `SKIP: creator risk`

#### 3.6 Too Many Unique Counterparties
- se il creator ha troppe controparti uniche in poche tx recenti
- soglia: `CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES`
- esito: `SKIP: creator risk`

#### 3.7 Compressed Activity
- se l'attivita e molto compressa nel tempo e con troppe controparti
- soglie:
  - `CREATOR_RISK_COMPRESSED_WINDOW_SEC`
  - `CREATOR_RISK_COMPRESSED_MAX_COUNTERPARTIES`
- esito: `SKIP: creator risk`

#### 3.8 Burner Profile
- se il creator ha solo uscite SOL significative e zero inbound recenti
- soglia: `CREATOR_RISK_BURNER_MIN_OUT_SOL`
- esito: `SKIP: creator risk`

#### 3.9 Creator Refunded Funder
- se il creator rimanda SOL al proprio funder
- soglia: `CREATOR_RISK_FUNDER_REFUND_MIN_SOL`
- esito:
  - pre-buy: `SKIP: creator risk`
  - during hold: `CREATOR RISK EXIT`

Log:
- `CRISK | cp=<n> in=<n> out=<n> window=<s> funder=<addr> refund=<sol>`

## 4. Pre-Buy Wait

Scopo:
- non entrare immediatamente alla detection del pool
- aspettare che partano i primi trade reali e che la pool si stabilizzi un minimo

Controlli:
- attesa del primo trade osservato sul pool
- poi attesa ulteriore di `PRE_BUY_WAIT_MS` a partire dal primo trade
- snapshots multipli della liquidita:
  - `PRE_BUY_CONFIRM_SNAPSHOTS`
  - `PRE_BUY_CONFIRM_INTERVAL_MS`

Esito:
- se la liquidita degrada troppo nel pre-buy: `SKIP: pre-entry wait`

Log:
- `WAIT | waiting for first pool trade`
- `WAIT | first trade ... remaining ...`
- `WAIT | pre-entry liquidity ... (min observed ...)`

## 5. Top10 Concentration

Scopo:
- evitare distribuzioni esterne troppo concentrate

Controlli:
- `PRE_BUY_TOP10_CHECK_ENABLED`
- `PRE_BUY_TOP10_MAX_PCT`
- `PRE_BUY_TOP10_EXCLUDE_POOL`

Note implementative importanti:
- il mint da controllare viene risolto con fallback dal pool state se il `tokenMint` estratto non basta
- `getTokenLargestAccounts` viene ritentato piu volte
- se il dato non e calcolabile per errore tecnico, il controllo e `fail-open`
- se il dato e calcolabile e supera soglia, il controllo e `fail-close`

Esito:
- `SKIP: pre-buy top10` solo se la concentrazione e realmente sopra soglia

Log:
- `TOP10 | <pct>% (max <pct>%)`
- `TOP10 | unavailable (...) -> fail-open`
- `TOP10 | using fallback mint ...`

## 6. Paper Simulation / Buy

In monitor mode:
- simula acquisto con `TRADE_AMOUNT_SOL`

In live mode:
- esegue buy reale

Log:
- `BUY_SPOT | ~.../token`

## 7. During Hold Controls

Questi controlli possono far uscire prima del timer `AUTO_SELL_DELAY_MS`.

### 7.1 Hold Creator Risk Recheck

Scopo:
- intercettare pattern sospetti che emergono solo dopo l'ingresso
- esempio tipico: creator che rimanda SOL al funder dopo pochi secondi

Controlli:
- `HOLD_CREATOR_RISK_RECHECK_ENABLED`
- `HOLD_CREATOR_RISK_RECHECK_INTERVAL_MS`

Esito:
- `CREATOR RISK EXIT`

Log:
- `CRISK | ...`
- `CREATOR RISK EXIT: ...`

### 7.2 Post-Entry Stability Gate

Scopo:
- uscire subito se nei primi secondi post-entry il token si rompe troppo rapidamente

Controlli:
- `POST_ENTRY_STABILITY_GATE_ENABLED`
- `POST_ENTRY_STABILITY_GATE_WINDOW_MS`
- `POST_ENTRY_STABILITY_GATE_DROP_PCT`

Segnali osservati:
- spot price
- liquidita SOL

Esito:
- early exit

Log:
- `STABILITY GATE: early exit ...`

### 7.3 Liquidity Stop

Scopo:
- uscire se spot o liquidita scendono sotto la soglia di sicurezza

Controlli:
- `LIQUIDITY_STOP_ENABLED`
- `LIQUIDITY_STOP_DROP_PCT`
- `LIQUIDITY_STOP_CHECK_INTERVAL_MS`

Segnali osservati:
- spot price rispetto all'entry
- liquidita SOL rispetto all'entry

Esito:
- early exit

Log:
- `LIQUIDITY STOP: trigger early exit ...`

## 8. Sell / Exit Guard

Dopo il calcolo sell:
- se `solOut <= 0`: `SKIP: paper simulation guard (exit returned 0 SOL)`
- se `pnlPct <= -PAPER_TRADE_MAX_LOSS_PCT`: `SKIP: paper simulation guard`

Log:
- `SELL_SPOT | ~.../token`
- `PNL | +/-... SOL (...%)`

## 9. Dev Holdings Check

Scopo:
- verificare quanto del token e ancora in mano al creator

Controlli:
- `MAX_DEV_HOLDINGS_PCT`
- query su token accounts creator con retry

Esito:
- in monitor mode puo essere fail-open
- in enforcement mode puo bloccare

Log:
- `DEV | holding ... (...%)`
- `DEV | creator wallet token balance is 0 after create_pool (can be normal)`
- `DEV | check duration ...ms`

## 10. Cosa un agente futuro deve sapere

1. `TOP10=0%` non implica sicurezza
- puo succedere se il supply e nel pool o la concentrazione non emerge nei largest holders esterni

2. Il pattern creator/funder e spesso piu utile del top10
- creator fresh
- funder hub
- refund creator -> funder
- cluster di creator sullo stesso funder

3. I controlli during hold sono necessari
- molti pattern sospetti emergono solo dopo il buy

4. `fail-open` e usato solo per errori tecnici dove bloccare sarebbe troppo rumoroso
- esempio: `TOP10 unavailable`

5. `creator risk` e pensato per essere estensibile
- nuovi segnali vanno aggiunti qui prima di inventare altri gate paralleli

## Parametri piu sensibili

Quelli che spostano di piu il comportamento:
- `PRE_BUY_TOP10_MAX_PCT`
- `PRE_BUY_WAIT_MS`
- `CREATOR_RISK_FUNDER_CLUSTER_MIN_CREATORS`
- `CREATOR_RISK_FUNDER_REFUND_MIN_SOL`
- `LIQUIDITY_STOP_DROP_PCT`
- `POST_ENTRY_STABILITY_GATE_DROP_PCT`
- `AUTO_SELL_DELAY_MS`

## Stato attuale del bot

Il bot oggi privilegia difesa e triage rispetto a coverage massima:
- molto aggressivo su `token security`
- abbastanza aggressivo su `creator risk`
- entra solo quando passa piu gate successivi
