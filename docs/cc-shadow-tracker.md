# CC Shadow Tracker

## Scopo

Traccia in parallelo tutti gli skip con reason `creator risk (unique counterparties N >= 2)` per capire, il giorno dopo, quali bucket `cc=N` avrebbero meritato ingresso e con quali filtri aggiuntivi.

## Flusso

1. Il worker incontra `SKIP: creator risk` con `unique counterparties >= 2`.
2. Scrive un job json in `logs/cc-shadow/queue/`.
3. Il supervisor process legge la coda e apre un job shadow per quel `cc=N`.
4. Il job campiona il token in parallelo fino a:
   - scadenza TTL (`AUTO_SELL_DELAY_MS`)
   - `remove liquidity`

## Sampling

- fase fast: ogni `CC_SHADOW_FAST_INTERVAL_MS`
- durata fase fast: `CC_SHADOW_FAST_PHASE_MS`
- fase slow: ogni `CC_SHADOW_SLOW_INTERVAL_MS`
- TTL job: `AUTO_SELL_DELAY_MS`

## Dati raccolti per snapshot

- identita evento: signature, tokenMint, poolAddress, creatorAddress, cc, skipReason
- timing: sampleAt, ageMs, sampleIndex, phase
- stato on-chain:
  - `hasWsol`
  - `solLiquidity`
  - `spotSolPerToken`
  - `baselineExitQuoteSol`
  - `currentExitQuoteSol`
- delta:
  - `deltaFromPrevPct`
  - `deltaFromBaselinePct`
  - `currentPnlPct`
  - `peakPnlPct`
- stato DexScreener:
  - pair count
  - WSOL pair count
  - pair address
  - dex id
  - price
  - liquidity usd
  - volume 5m / 24h
  - fdv / market cap
- trigger ipotetici hold:
  - `hardStopTriggered`
  - `singleSwapShockTriggered`
  - `sellQuoteCollapseTriggered`
  - `winnerArmed`
  - `winnerTakeProfitTriggered`
  - `winnerTrailingTriggered`
- exit ipotetica sintetica:
  - `wouldExitReason`
- remove liquidity:
  - `removeLiquidityDetected`
  - dettagli tx remove-liq se rilevati

## Output files

Indice globale:

- `logs/cc-shadow/index.json`
- `logs/cc-shadow/manager.log`

Per ogni bucket `cc-N`:

- timeline aggregata: `logs/cc-shadow/cc-N/timeline/events.ndjson`
- summary corrente: `logs/cc-shadow/cc-N/summary/current.json`
- summary per token/evento: `logs/cc-shadow/cc-N/summary/by-token.json`

## Config rilevanti

- `CC_SHADOW_ENABLED`
- `CC_SHADOW_QUEUE_MAX_JOBS`
- `CC_SHADOW_FAST_INTERVAL_MS`
- `CC_SHADOW_FAST_PHASE_MS`
- `CC_SHADOW_SLOW_INTERVAL_MS`
- `CC_SHADOW_DEX_EVERY_N_SNAPSHOTS`

## Lettura dei dati

- `current.json` serve per capire in fretta se un `cc=N` sembra promettente.
- `by-token.json` serve per vedere i migliori e peggiori casi per ogni bucket.
- `events.ndjson` serve per debug dettagliato snapshot-by-snapshot.

## Note operative

- traccia solo gli skip `creator risk (unique counterparties N >= 2)`
- non traccia altri subtype creator-risk (`funder blacklisted`, `cashout`, ecc.)
- non ferma il job per `no quote`, `pool morto` o max samples: solo TTL o remove liquidity
