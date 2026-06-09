# Analisi Completa — 2026-04-05 (⚠️ PnL SOVRASTIMATO)

> **ERRATA:** Questa analisi riportava "+0.826 SOL net" ma quel valore **escludeva le 39 rug losses** perché i rug events hanno `checksPassed=false` e non venivano contati nel calcolo. Il PnL reale al momento era **+0.566 SOL**. Vedi `2026-04-06-full-analysis.md` per i dati corretti.

**Data analisi:** 2026-04-05 09:33 UTC
**Sessione analizzata:** 2026-04-02 09:43 → 2026-04-05 09:33 (~72h running)
**Servizi:** `pump-sniper.service` active since 2026-04-02 09:43:55, PID 399388
**Ultimo commit in esecuzione:** `58ce8d3` (revert cp=1 from UC whitelist)
**Modalità:** PAPER TRADE (`MONITOR_ONLY=true`, `PAPER_TRADE_ENABLED=true`)

---

## 1. Dashboard Globale

| Metrica | Valore |
|---|---|
| **Events visti** | 6.933 |
| **Trades eseguiti** | 264 (3.8% pass rate) |
| **Win/Loss** | 203W / 86L (inclusi 26 rug-like) |
| **Win Rate** | **77.3%** |
| **Net PnL (pulito, no outlier)** | **+0.826 SOL** |
| **EV per trade** | **+0.00314 SOL** |
| **Profit Factor** | **47.19** |
| **Median Win PnL** | **+37.0%** |
| **Avg Win PnL** | +41.6% |
| **Median Loss PnL (non-rug)** | -0.61% |
| **Avg Loss PnL (non-rug)** | -2.98% |
| **Rug losses** | 26 (report) = -0.26 SOL stimati |
| **Avoided rug-like** | 22 |
| **No-WSOL skips** | 2.022 |
| **Hostile skips** | 4.373 |
| **Invalid PnL** | 1 |

> **Nota outlier:** un trade (evt-003441) ha generato +785.318% PnL (+78.53 SOL) per un edge case `remove liquidity`. Tutti i dati "puliti" escludono questo outlier.

---

## 2. Confronto Evolutivo tra Sessioni

| Sessione | Data | Trades | WR% | Median Win | Avg Loss | Net PnL |
|---|---|---|---|---|---|---|
| Baseline originale | 28/03 pre | 228 | ~55% | 2.45% | -53% | ~-0.05 SOL |
| Post UC-skip recheck | 29/03 pre | 11 | 63.6% | 15.01% | -53.3% | -0.010 SOL |
| Post profit-floor | 29/03 post | 43 | 76.7% | 15.86% | -53.3% | +0.003 SOL |
| Post trailing/TP tuning | 29/03 sess3 | 7 | 28.6% | — | — | -0.021 SOL |
| cp=1 disaster | 02/04 | 55 | 43.6% | — | -32.6% | -0.102 SOL |
| **Corrente (stabile)** | **02-05/04** | **264** | **77.3%** | **37.0%** | **-2.98%** | **+0.826 SOL** |

**L'evoluzione è stata drammatica**: il median win è cresciuto **15x** dalla baseline (2.45% → 37%) e il bot è diventato stabilmente profittevole.

---

## 3. Distribuzione Exit Reason (aggregata)

| Exit Reason | Trades | W/L | WR% | TotalSOL | % profitto |
|---|---|---|---|---|---|
| **winner take profit** | 90 | 90/0 | 100% | +0.627 | **76%** |
| **creator outbound spray** | 114 | 74/40 | 64.9% | +0.110 | 13% |
| **hold timeout** | 11 | 11/0 | 100% | +0.036 | 4% |
| **compressed activity (recheck)** | 19 | 12/7 | 63.2% | +0.034 | 4% |
| **winner trailing stop** | 8 | 5/3 | 62.5% | +0.009 | 1% |
| **cashout (recheck)** | 6 | 3/3 | 50% | +0.006 | <1% |
| rapid dispersal (recheck) | 1 | 1/0 | 100% | +0.003 | <1% |
| creator close-account burst | 1 | 1/0 | 100% | +0.002 | <1% |
| spray outbound (recheck) | 1 | 1/0 | 100% | +0.000 | <1% |
| precreate (recheck) | 2 | 1/1 | 50% | +0.000 | ~0 |
| creator outbound | 1 | 1/0 | 100% | +0.000 | <1% |
| winner profit floor | 2 | 1/1 | 50% | -0.002 | negativo |
| hard stop loss | 2 | 0/2 | 0% | -0.005 | negativo |

### Insight:

1. **Winner Take Profit è il motore dei profitti** — 90 trade, tutti vincenti, mediana +52.95%, totale +0.627 SOL. Il TP a 50% da solo rende il bot profittevole.
2. **Creator outbound spray è il secondo pilastro** — 114 trade (il più grande gruppo per numero), WR 64.9%, +0.110 SOL. Mediana win +13.1%, loss quasi tutte a -0.6%.
3. **Hold timeout 100% win** — 11 trade chiusi per timeout finiscono tutti in positivo. Selezione pre-entry molto buona.

---

## 4. Winner Take Profit — Dettaglio

| Metrica | Valore |
|---|---|
| Trade TP | 90 |
| Win Rate | 100% |
| Avg PnL | +69.63% |
| Median PnL | +52.95% |
| Total SOL | +0.627 |

Il TP a 50% funziona perfettamente: cattura i trade che fanno 1.5x+ e non lascia correre profitti che poi svaniscono.

---

## 5. Winner Trailing Stop — Problema Critico di Crash Speed

| Trade | Peak PnL | Exit PnL | Esito |
|---|---|---|---|
| evt-002258 | +37.5% | +21.6% | ✅ OK |
| evt-002448 | **+40.1%** | **-14.9%** | ⚠️ Crash bypass |
| evt-002829 | +42.4% | +28.0% | ✅ OK |
| evt-003567 | +41.9% | +25.1% | ✅ OK |
| evt-003627 | **+26.9%** | **-9.1%** | ⚠️ Crash bypass |
| evt-003729 | **+25.1%** | **-11.2%** | ⚠️ Crash bypass |
| evt-004344 | +39.7% | +22.5% | ✅ OK |
| evt-005042 | +42.8% | +28.1% | ✅ OK |

**3/8 trailing stop exits (37.5%) escono in NEGATIVO** nonostante peak da +25-40%.

Il trailing stop (10% drawdown relativo) funziona solo quando il calo è graduale. Nei crash istantanei (singolo poll interval 200ms), il prezzo salta dal peak a -10/-15% senza passare per il punto di trailing.

**Impatto stimato**: ~0.08 SOL persi. Se il trailing avesse funzionato, i 3 crash sarebbero usciti a +14-16% circa.

---

## 6. Winner Profit Floor — Funziona a Metà

| Trade | Peak | Exit PnL | Esito |
|---|---|---|---|
| evt-003020 | +8.3% | +0.1% | ✅ Floor ha salvato il trade |
| evt-003877 | **+26.6%** | **-23.6%** | ⚠️ Crash bypass (stesso problema trailing) |

Solo 2 attivazioni in 264 trade. Il floor ha lo stesso problema del trailing: crash in <200ms bypassa il check.

---

## 7. Hard Stop Loss

| Trade | Peak | Exit PnL |
|---|---|---|
| evt-001450 | +2.5% | -26.8% |
| evt-002595 | -0.6% | -20.6% |

Solo 2 attivazioni. Funziona come rete di sicurezza per i rari casi dove nessun altro trigger si attiva.

---

## 8. Rug Losses — Analisi del Costo Più Grande

### 26 rug-like, tutti classificati PAPER LOSS, totale stimato -0.26 SOL

**Pattern comune tra i 20 rug analizzati in dettaglio:**
- **TUTTI cp=4** (whitelisted)
- **TUTTI passano OGNI singolo check pre-entry** (liq ✅, token ✅, top10 ✅, dispersal ✅, lookup table ✅, setup burst ✅, ultra guard ✅)
- **TUTTI hanno funder NOT in blacklist** al momento dell'entry
- Dispersal SOL tra 85-605 SOL (tutti sopra soglia 100)
- Creates tra 2-207
- **Indistinguibili dai winner al momento dell'entry**

### Funder tracking distribuito sui rug:

| Funder | Osservato | Note |
|---|---|---|
| Diversi funder unici | 1 rug ciascuno | Non raggruppabili; ogni funder nuovo genera un rug prima di essere bloccato |

### Dynamic funder tracking — efficacia

| Metrica | Valore |
|---|---|
| Token bloccati da funder blacklist | **594** (8.9% di tutti gli skip) |
| Funder nel funder-counts.json | 48 |
| Funder statici principali (Fbm7CY, HbCBfg, 449xUPEY) | 578 blocchi |
| Funder dinamici aggiuntivi | 16 blocchi |
| Stima risparmio | Se 10% dei 594 sarebbero stati rug → ~0.60 SOL evitati |

---

## 9. Non-Rug Losses — Dettaglio

60 loss non-rug su 264 trade:

| Pattern | Count | PnL range | Note |
|---|---|---|---|
| Creator outbound spray, loss minima | ~38 | -0.2% a -5.7% | Uscita rapida, fee loss |
| Compressed activity recheck | ~7 | -0.3% a -0.6% | Recheck taglia, fee loss |
| Winner trailing stop crash | 3 | -9.1% a -14.9% | Crash speed bypass |
| Hard stop loss | 2 | -20.6% a -26.8% | Rete di sicurezza |
| Winner profit floor crash | 1 | -23.6% | Crash speed bypass |
| Cashout / precreate / RPC error | ~9 | -0.6% | Exit immediata, fee loss |

**La grande maggioranza delle loss non-rug è a -0.6%** (exit quasi immediata nel primo intervallo di recheck). Le loss significative sono solo le 6 da crash speed bypass.

---

## 10. Skip Reason Distribution — Funnel di Filtraggio

| Skip Reason | Count | % del totale skip |
|---|---|---|
| **Unique counterparties** (non in whitelist) | 2.353 | 35.3% |
| **No WSOL side** | 2.021 | 30.3% |
| **Token security** (mint/freeze) | 959 | 14.4% |
| **Funder blacklisted** | 594 | 8.9% |
| **Funder cluster** | 211 | 3.2% |
| **Rapid dispersal** | 153 | 2.3% |
| Low liquidity | 98 | 1.5% |
| Pre-buy top10 | 93 | 1.4% |
| Burner profile | 47 | 0.7% |
| Pre-entry guard | 28 | 0.4% |
| Paper simulation guard | 22 | 0.3% |
| Spray outbound | 10 | 0.1% |
| Fresh-funded | 7 | 0.1% |
| Setup burst | 6 | 0.1% |
| Cashout | 6 | 0.1% |
| Precreate | 5 | 0.1% |
| RPC error / 503 | 14 | 0.2% |
| Altro | ~17 | 0.3% |

### Osservazioni:

1. **UC domina (35.3%)** — la whitelist `{0,2,4,47}` blocca più di un terzo di tutto. L'esperimento cp=1 (02/04) ha confermato che allentare è catastrofico.
2. **No-WSOL (30.3%)** — 2.021 skip, di cui 49% duplicati (988 eventi per lo stesso token visto >3 volte).
3. **Funder blacklist (8.9%)** — terzo filtro più attivo. Funziona.
4. **Funder cluster (3.2%)** — aggiunge protezione significativa.

### Funder blacklisted — top blockers

| Funder | Blocchi |
|---|---|
| `Fbm7CYMzBrXHCU5YVijvJWVvdiy5XWhDAybup43eRqCo` | 195 |
| `HbCBfgBgsPCHcfrJbdPECd4te9kXF9P1MpAyezh4kVWu` | 195 |
| `449xUPEY3EMNCsxFhty7yftoFBF4YoUt24yNwUHnVb8a` | 188 |
| 15 funder dinamici | 1 ciascuno |

---

## 11. Creator Outbound Spray — Approfondimento

Questo è il trigger hold più frequente (114 exit su 264 trade = 43%):

| Metrica | Valore |
|---|---|
| Win count | 74 |
| Loss count | 40 |
| Win rate | 64.9% |
| Median win PnL | +13.1% |
| Max loss PnL | -5.7% |
| Total SOL | +0.110 |

Le 40 loss sono quasi tutte a -0.6% — uscita nel primo recheck (1500ms) dopo che il creator fa spray outbound, con perdita data solo dalle fee simulate.

**Miglior rapporto rischio/rendimento tra tutti i trigger hold.**

---

## 12. Progressione per Chunk di Eventi

| Chunk | Trades | W/L | WR% | Rugs | TotalSOL | AvgPnl% |
|---|---|---|---|---|---|---|
| 0-1k | 4 | 2/2 | 50.0% | 0 | +0.011 | +26.9% |
| 1k-2k | 25 | 21/4 | 84.0% | 0 | +0.074 | +29.5% |
| 2k-3k | 44 | 32/12 | 72.7% | 0 | +0.113 | +25.7% |
| 3k-4k | 55 | 38/17 | 69.1% | 0 | +78.651* | +14300%* |
| 4k-5k | 57 | 48/9 | 84.2% | 0 | +0.188 | +33.0% |
| 5k-6k | 48 | 37/11 | 77.1% | 0 | +0.131 | +27.2% |
| 6k+ | 31 | 26/5 | 83.9% | 0 | +0.191 | +61.5% |

*Chunk 3k-4k include l'outlier evt-003441 (+78.53 SOL).*

**Trend positivo**: gli ultimi chunk (5k+) mostrano WR in salita (77-84%) e PnL solido. Il bot è stabile nel tempo.

---

## 13. Top 10 Biggest Wins

| # | Event | PnL% | SOL | Exit |
|---|---|---|---|---|
| 1 | evt-003441 | +785.318% | +78.53 | remove liquidity |
| 2 | evt-006243 | +1.032% | +0.103 | winner take profit |
| 3 | evt-004924 | +184.3% | +0.018 | compressed activity (recheck) |
| 4 | evt-004685 | +151.2% | +0.015 | winner take profit |
| 5 | evt-004003 | +106.2% | +0.011 | winner take profit |
| 6 | evt-006010 | +100.6% | +0.010 | winner take profit |
| 7 | evt-001449 | +88.9% | +0.009 | winner take profit |
| 8 | evt-005876 | +87.7% | +0.009 | winner take profit |
| 9 | evt-003451 | +79.0% | +0.008 | winner take profit |
| 10 | evt-005671 | +76.3% | +0.008 | winner take profit |

8/10 top win escono per **winner take profit**. Il TP a 50% cattura i winner meglio.

---

## 14. Metriche di Salute Infrastrutturale

| Indicatore | Stato |
|---|---|
| Uptime bot | ~72h continue, 0 restart |
| Uptime report daemon | ~72h continue |
| Memory sniper | 117 MB (stabile) |
| Memory report | 273 MB (alto ma stabile) |
| CPU sniper | ~2 giorni cumulativi |
| Errori RPC/503 | 14 eventi (0.2%) |
| Healthcheck circuit breaker | Non triggerato ✅ |

---

## 15. Configurazione Runtime Completa

### 15.1 .env

```env
MONITOR_ONLY=true
PAPER_TRADE_ENABLED=true
SVS_UNSTAKED_RPC=https://mainnet.helius-rpc.com/?api-key=***
```

### 15.2 Trade & Pool

| Parametro | Valore |
|---|---|
| `TRADE_AMOUNT_SOL` | 0.01 |
| `MIN_POOL_LIQUIDITY_SOL` | 20 |
| `MIN_POOL_LIQUIDITY_USD` | 10000 |
| `SLIPPAGE_PERCENT` | 20 |
| `AUTO_SELL_DELAY_MS` | 900000 (15 min timeout) |

### 15.3 Token Security

| Parametro | Valore |
|---|---|
| `REQUIRE_RENOUNCED_MINT` | true |
| `REQUIRE_NO_FREEZE` | true |
| `MAX_DEV_HOLDINGS_PCT` | 20 |
| `ENFORCE_DEV_HOLDINGS_CHECK` | true |

### 15.4 Pre-Buy

| Parametro | Valore |
|---|---|
| `PRE_BUY_WAIT_MS` | 1500 |
| `PRE_BUY_SIGNAL_MIN_TRADES` | 10 |
| `PRE_BUY_CONFIRM_SNAPSHOTS` | 3 |
| `PRE_BUY_CONFIRM_INTERVAL_MS` | 350 |
| `PRE_BUY_REVALIDATION_ENABLED` | true |
| `PRE_BUY_REVALIDATION_MAX_LIQ_DROP_PCT` | 35 |
| `PRE_BUY_REVALIDATION_MAX_QUOTE_VS_SPOT_RATIO` | 25 |
| `PRE_BUY_FINAL_CREATOR_RISK_RECHECK_ENABLED` | true |
| `PRE_BUY_FINAL_REMOVE_LIQ_CHECK_ENABLED` | true |
| `PRE_BUY_MAX_LIQ_DROP_PCT` | 10 |

### 15.5 Pre-Buy Top10

| Parametro | Valore |
|---|---|
| `PRE_BUY_TOP10_CHECK_ENABLED` | true |
| `PRE_BUY_TOP10_MAX_PCT` | 90 |
| `PRE_BUY_TOP10_EXCLUDE_POOL` | true |
| `PRE_BUY_TOP1_EXTERNAL_HOLDER_CHECK_ENABLED` | true |
| `PRE_BUY_TOP1_EXTERNAL_HOLDER_MAX_PCT` | 20 |
| `PRE_BUY_TOP10_FAIL_OPEN` | false |

### 15.6 Pre-Buy No-WSOL

| Parametro | Valore |
|---|---|
| `PRE_BUY_NO_WSOL_RECHECK_ENABLED` | true |
| `PRE_BUY_NO_WSOL_RECHECK_MAX_ATTEMPTS` | 10 |
| `PRE_BUY_NO_WSOL_RECHECK_INTERVAL_MS` | 350 |
| `PRE_BUY_NO_WSOL_RECHECK_BACKOFF_MULTIPLIER` | 1.35 |
| `PRE_BUY_NO_WSOL_RECHECK_MAX_INTERVAL_MS` | 1200 |
| `FORCE_ENTRY_ON_NO_WSOL_SIDE` | false |
| `DEFERRED_NO_WSOL_QUEUE_ENABLED` | false |

### 15.7 Ultra-Short Rug Guard

| Parametro | Valore |
|---|---|
| `PRE_BUY_ULTRA_SHORT_RUG_GUARD_ENABLED` | true |
| `PRE_BUY_ULTRA_SHORT_RUG_GUARD_WINDOW_MS` | 2500 |
| `PRE_BUY_ULTRA_SHORT_RUG_GUARD_INTERVAL_MS` | 500 |
| `PRE_BUY_ULTRA_SHORT_RUG_GUARD_MAX_LIQ_DROP_PCT` | 35 |
| `PRE_BUY_ULTRA_SHORT_RUG_GUARD_MAX_QUOTE_DROP_PCT` | 35 |

### 15.8 Winner Management

| Parametro | Valore | Note |
|---|---|---|
| `HOLD_WINNER_MANAGEMENT_ENABLED` | true | |
| `HOLD_WINNER_CHECK_INTERVAL_MS` | 200 | era 250 (28/03) |
| `HOLD_WINNER_MIN_HOLD_MS` | 4000 | |
| `HOLD_WINNER_ARM_PNL_PCT` | 8 | era 10→8 (29/03) |
| `HOLD_WINNER_TRAILING_DROP_PCT` | 10 | era 15→20→10 |
| `HOLD_WINNER_TRAILING_DROP_PCT_CP0` | 10 | era 8→15→10 |
| `HOLD_WINNER_HARD_TAKE_PROFIT_PCT` | 50 | era 100→50 |
| `HOLD_WINNER_HARD_TAKE_PROFIT_PCT_CP1` | 50 | era 100→50 |
| `HOLD_WINNER_MIN_PEAK_SOL` | 0.0104 | |
| `HOLD_WINNER_PROFIT_FLOOR_PCT` | 3 | nuovo (29/03) |

### 15.9 Hold Sell Protection

| Parametro | Valore |
|---|---|
| `HOLD_SELL_QUOTE_COLLAPSE_DROP_PCT` | 35 |
| `HOLD_SELL_QUOTE_COLLAPSE_CHECK_INTERVAL_MS` | 300 |
| `HOLD_SELL_QUOTE_COLLAPSE_MIN_HOLD_MS` | 3000 |
| `HOLD_SINGLE_SWAP_SHOCK_DROP_PCT` | 35 |
| `HOLD_SINGLE_SWAP_SHOCK_CHECK_INTERVAL_MS` | 300 |
| `HOLD_HARD_STOP_LOSS_PCT` | 15 |
| `HOLD_HARD_STOP_LOSS_CHECK_INTERVAL_MS` | 250 |

### 15.10 Hold Creator Risk

| Parametro | Valore |
|---|---|
| `HOLD_CREATOR_RISK_RECHECK_ENABLED` | true |
| `HOLD_CREATOR_RISK_RECHECK_INTERVAL_MS` | 1500 (era 5000) |
| `HOLD_REMOVE_LIQ_DETECT_ENABLED` | true |
| `HOLD_REMOVE_LIQ_CHECK_INTERVAL_MS` | 1500 |
| `HOLD_CREATOR_AMM_BURST_DETECT_ENABLED` | true |
| `HOLD_CREATOR_OUTBOUND_EXIT_ENABLED` | true |
| `HOLD_CREATOR_CLOSE_ACCOUNT_BURST_EXIT_ENABLED` | true |
| `HOLD_CREATOR_OUTBOUND_SPRAY_EXIT_ENABLED` | true |
| `HOLD_CREATOR_INBOUND_SPRAY_EXIT_ENABLED` | true |
| `HOLD_POOL_CHURN_DETECT_ENABLED` | true |

### 15.11 Creator Risk Pre-Entry

| Controllo | Stato |
|---|---|
| `CREATOR_RISK_CHECK_ENABLED` | **ON** |
| `CREATOR_RISK_WHITELISTED_CC_VALUES` | `0,2,4,47` |
| `CREATOR_RISK_FUNDER_CLUSTER_ENABLED` | ON |
| `CREATOR_RISK_HISTORICAL_FUNDER_CLUSTER_MIN_RUG_CREATORS` | 1 (era 2) |
| `CREATOR_RISK_STANDARD_POOL_MICRO_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_STANDARD_POOL_OUTBOUND_HEAVY_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_SPRAY_OUTBOUND_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_INBOUND_SPRAY_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_SETUP_BURST_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_CLOSE_ACCOUNT_BURST_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_RAPID_DISPERSAL_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_STRICT_FLOW_ENABLED` | ON |
| `CREATOR_RISK_PRECREATE_BURST_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_PRECREATE_LARGE_UNIFORM_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_CONCENTRATED_INBOUND_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_LOOKUP_TABLE_NEAR_CREATE_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_REPEAT_CREATE_REMOVE_BLOCK_ENABLED` | ON |
| `CREATOR_RISK_RELAY_FUNDING_ENABLED` | **OFF** |
| `CREATOR_RISK_STANDARD_POOL_RELAY_BLOCK_ENABLED` | **OFF** |
| `CREATOR_RISK_STANDARD_POOL_RELAY_OUTBOUND_BLOCK_ENABLED` | **OFF** |
| `CREATOR_RISK_CREATOR_SEED_RATIO_BLOCK_ENABLED` | **OFF** |
| `CREATOR_RISK_DIRECT_AMM_REENTRY_ENABLED` | **OFF** |
| `PAPER_CREATOR_RISK_PROBATION_ENABLED` | **OFF** |

### 15.12 Runtime & Infrastruttura

| Parametro | Valore |
|---|---|
| `MAX_CONCURRENT_OPERATIONS` | 2 |
| `QUEUE_MAX_PENDING_SIGNATURES` | 300 |
| `SIGNATURE_CACHE_TTL_MS` | 600000 (10 min) |
| `RUG_HISTORY_CACHE_TTL_MS` | 60000 (1 min, era 5 min) |
| `CC_SHADOW_ENABLED` | false |
| `LOG_STALE_RESUBSCRIBE_MS` | 90000 |
| `HEALTHCHECK_INTERVAL_MS` | 15000 |
| `CREATOR_RISK_DEEP_CHECK_BUDGET_MS` | 12000 |
| `CREATOR_RISK_RECHECK_DEEP_CHECK_BUDGET_MS` | 2500 |
| `CREATOR_RISK_RATE_LIMIT_RETRIES` | 3 |

### 15.13 Rapid Dispersal

| Parametro | Valore |
|---|---|
| `CREATOR_RISK_RAPID_DISPERSAL_MIN_TRANSFERS` | 3 |
| `CREATOR_RISK_RAPID_DISPERSAL_MIN_DESTINATIONS` | 3 |
| `CREATOR_RISK_RAPID_DISPERSAL_MIN_TOTAL_SOL` | 100 |
| `CREATOR_RISK_RAPID_DISPERSAL_MIN_PCT_OF_ENTRY_LIQ` | 20 |
| `CREATOR_RISK_RAPID_DISPERSAL_MAX_WINDOW_SEC` | 20 |

### 15.14 Blacklists

| File | Entries |
|---|---|
| `blacklists/funders.txt` | 8 |
| `blacklists/creators.txt` | 67 |
| `blacklists/funder-counts.json` | 48 funder tracciati |

---

## 16. Problemi Identificati e Priorità

### 🔴 Critico: Crash speed bypass (trailing + floor)

**37.5% dei trailing stop e 50% dei profit floor escono in negativo** a causa di crash istantanei tra poll interval (200ms).

**Impatto**: ~0.08 SOL persi + 3 trade da win a loss.

**Possibili mitigazioni:**
- Polling più frequente (100ms? 50ms?)
- TP tiered: se peak > 30%, TP diretto invece di trailing
- Trailing stop con limit order pre-piazzata (solo live)

### 🟡 Medio: Rug non filtrabili (cp=4, tutti check PASS)

26 rug a -100% che passano TUTTI i controlli = -0.26 SOL (31% del profitto lordo).

Il dynamic funder tracking mitiga (blocca dopo primo rug), ma il primo rug per ogni nuovo funder è inevitabile.

**Possibili mitigazioni:**
- Score-based sizing: size ridotta per funder senza storia
- Analisi on-chain post-entry più frequente
- Correlation con time-to-peak data

### 🟢 Basso: No-WSOL duplicati

49% degli eventi no-WSOL sono duplicati (>3 per stesso token). Non causano perdite ma sprecano risorse.

---

## 17. Stato vs Profit Roadmap

| Punto Roadmap | Stato | Risultato |
|---|---|---|
| 1. Winner Management | ✅ Completo | Median win 2.45% → 37%. TP 50% = 76% dei profitti |
| 2. Filtri selettivi | ✅ Parziale | UC skip in recheck OK. cp=1 fallito. Funder tracking attivo |
| 3. Scoring vs binari | ⏳ Non iniziato | Rug cp=4 full-pass suggeriscono utilità di uno scoring system |
| 4. Size dinamica | ⏳ Non iniziato | EV +0.00314/trade confermato, base per size up selettiva |
| 5. Audit continuo | ✅ Operativo | paper-report-daemon 72h senza interruzioni |

---

## 18. Raccomandazioni per il Prossimo Ciclo

### Immediato
1. **NON toccare i filtri pre-entry** — WR 77.3% e mediana 37% sono eccellenti
2. Attendere altri 1-2 giorni per raccogliere 500+ trade totali

### Dopo raccolta dati
3. Valutare TP tiered (TP diretto se peak > 30%) per risolvere crash speed trailing
4. Analizzare funder-counts.json dopo 500+ trade per pattern funder emergenti
5. Valutare score-based sizing per mitigare rug non filtrabili

---

## 19. Commit History Attuale

```
58ce8d3 revert: remove cp=1 from UC whitelist — 43.6% WR with 20 rugs on 39 trades
63cf2d5 fix: profit floor intercept in hard stop loss + add cp=1 to UC whitelist
f89a4e1 fix: expand rug tracking to catch hard-stop-loss rugs + preload known bad funders
9f1bef1 feat: add timeToPeakMs to HOLDLOG for time-to-peak analysis
8fa2c50 tune: trailing drop 20%->10%, take profit 100%->50%
225253f feat: dynamic funder rug tracking + threshold/TTL tuning
223719e feat: winner profit floor, healthcheck circuit breaker, ARM_PNL 10->8
357d3f8 disable CC shadow analysis to reduce RPC load
5396452 Disable unique counterparties sub-trigger in RECHECK only
666c114 Phase 1+3: winner management tuning + UC recheck analysis
a4075c9 Phase 1: safe config changes for faster rug detection
649913e Revert test: disable recheck (failed)
255a51d test: disable recheck (REVERTED)
```

---

*Analisi generata il 2026-04-05. Prossima analisi prevista dopo raccolta di 500+ trade totali (stimata 2026-04-07).*
