# Analisi Completa — 2026-04-06

**Data analisi:** 2026-04-06 ~03:00 UTC
**Sessione analizzata:** 2026-04-02 09:43 → 2026-04-06 02:52 (~90h running)
**Servizi:** `pump-sniper.service` active since 2026-04-02 09:43:55, PID 399388
**Ultimo commit in esecuzione:** `58ce8d3` (revert cp=1 from UC whitelist)
**Modalità:** PAPER TRADE (`MONITOR_ONLY=true`, `PAPER_TRADE_ENABLED=true`)

> **Errata rispetto all'analisi 2026-04-05:** la precedente analisi riportava "+0.826 SOL" ma quel numero **escludeva le 26 rug losses** (-0.26 SOL) perché il campo `rugLoss` nei trade con `checksPassed=true` era `false` — i rug sono eventi separati con `checksPassed=false`. Il valore reale era **+0.566 SOL**. Questa analisi usa il metodo corretto.

---

## 1. Dashboard Globale

| Metrica | Valore |
|---|---|
| **Events visti** | 8.645 |
| **Trades eseguiti (checksPassed)** | 348 |
| **Rug events (checksPassed=false, rugLoss=true)** | 39 |
| **Total outcome events** | 387 |
| **Wins** | 268 |
| **Losses** | 118 (di cui 39 rug) |
| **Win Rate** | **69.4%** |
| **Net PnL (reale, no outlier)** | **+0.645 SOL** |
| **EV per trade** | **+0.00167 SOL** |
| **Median Win PnL** | **+37.5%** |
| **Avg Win PnL** | +39.6% |
| **Median Loss (non-rug)** | -0.61% |

### Scomposizione PnL

| Componente | SOL |
|---|---|
| Win SOL (268 win, no outlier) | **+1.062** |
| Non-rug loss SOL (79 loss) | **-0.028** |
| Rug loss SOL (39 rug) | **-0.389** |
| **NET** | **+0.645** |

> **Nota outlier:** un trade (evt-003441) ha generato +78.53 SOL per un edge case `remove liquidity`. Escluso da tutti i calcoli.

---

## 2. Confronto Evolutivo

| Sessione | Data | Trades+Rug | WR% | Median Win | Net PnL |
|---|---|---|---|---|---|
| Baseline | 28/03 | 228 | ~55% | 2.45% | ~-0.05 SOL |
| Post UC-skip | 29/03 | 11 | 63.6% | 15.01% | -0.010 SOL |
| Post profit-floor | 29/03 | 43 | 76.7% | 15.86% | +0.003 SOL |
| cp=1 disaster | 02/04 | 55 | 43.6% | — | -0.102 SOL |
| Analisi precedente (corretto) | 02-05/04 | 264+26 | 69.9% | 37.0% | +0.566 SOL |
| **Corrente** | **02-06/04** | **348+39** | **69.4%** | **37.5%** | **+0.645 SOL** |

### Delta ultime 24h (da analisi precedente)

| Metrica | Ultime 24h | Cumulativo |
|---|---|---|
| Nuovi trade | 84 | 348 |
| Nuovi rug | 13 | 39 |
| Nuovi win | 65 | 268 |
| WR periodo | 67.0% | 69.4% |
| PnL trade | +0.208 SOL | +1.034 SOL |
| PnL rug | -0.129 SOL | -0.389 SOL |
| **Net PnL** | **+0.079 SOL** | **+0.645 SOL** |
| Median win | 39.2% | 37.5% |

---

## 3. Tabella Exit Reason Completa (348 trade + 39 rug, no outlier)

| Exit | # | W/L | WR% | AvgPnl | SOL |
|---|---|---|---|---|---|
| **winner take profit** | 119 | 119/0 | 100% | +65.6% | **+0.781** |
| **creator outbound spray** | 147 | 93/54 | 63.3% | +9.6% | **+0.141** |
| recheck: compressed | 26 | 18/8 | 69.2% | +16.2% | +0.042 |
| hold timeout | 13 | 13/0 | 100% | +32.3% | +0.042 |
| winner trailing stop | 12 | 9/3 | 75.0% | +14.9% | +0.018 |
| recheck: cashout | 10 | 6/4 | 60.0% | +11.9% | +0.012 |
| recheck: RPC error | 3 | 2/1 | 66.7% | +14.1% | +0.004 |
| recheck: rapid dispersal | 1 | 1/0 | 100% | +31.8% | +0.003 |
| recheck: burner | 1 | 1/0 | 100% | +29.2% | +0.003 |
| creator close-account burst | 1 | 1/0 | 100% | +14.8% | +0.002 |
| remove liquidity | 4 | 1/3 | 25% | +3.5% | +0.001 |
| recheck: spray outbound | 1 | 1/0 | 100% | +4.0% | +0.000 |
| recheck: precreate | 2 | 1/1 | 50% | +1.6% | +0.000 |
| creator outbound | 1 | 1/0 | 100% | +2.2% | +0.000 |
| hard stop loss | 2 | 0/2 | 0% | -23.7% | -0.005 |
| winner profit floor | 4 | 1/3 | 25% | -26.6% | -0.011 |
| **RUG: single swap shock** | 1 | 0/1 | 0% | -100% | -0.010 |
| **RUG: winner profit floor** | 2 | 0/2 | 0% | -96.7% | -0.019 |
| **RUG: remove liquidity** | 36 | 0/36 | 0% | -100% | **-0.360** |
| **TOTALE** | **386** | | | | **+0.645** |

### Insight chiave:

1. **Winner TP è il motore** — 119 trade, 100% WR, +0.781 SOL = **121%** del net PnL (i rug mangiano il 21% del profitto lordo).
2. **Creator outbound spray** — 147 trade, 63.3% WR, +0.141 SOL. Secondo contribuente.
3. **RUG: remove liquidity è il costo dominante** — 36 eventi, -0.360 SOL = **56% dei costi totali**.
4. **Winner profit floor ha problemi** — 4 trade normali (1W/3L, -0.011 SOL) + 2 rug (-0.019 SOL). I crash speed lo bypassano.
5. **Winner trailing stop migliorato** — 12 trade, 9W/3L (75% WR, era 62.5%), +0.018 SOL. Ora nettamente positivo.

---

## 4. Rug Losses — 39 eventi, -0.389 SOL

### Exit reason dei rug

| Exit | Count | SOL |
|---|---|---|
| remove liquidity | 36 | -0.360 |
| winner profit floor | 2 | -0.019 |
| single swap shock | 1 | -0.010 |

### Nuovi 13 rug delle ultime 24h

| Event | Exit | PnL | Funder |
|---|---|---|---|
| evt-007033 | remove liquidity | -100% | CHNsgP...MW1gPC |
| evt-007111 | winner profit floor | -100% | N/A |
| evt-007429 | remove liquidity | -100% | DEV7cE...EZ4kSR |
| evt-007462 | remove liquidity | -100% | HCe7qG...iuqwCc |
| evt-007507 | remove liquidity | -100% | 2F2FAU...bfiyu1 |
| evt-007627 | remove liquidity | -100% | 6dzf2c...mtxsS1 |
| evt-007945 | remove liquidity | -99.8% | GWTx7Y...Z1zDRg |
| evt-007968 | winner profit floor | -93.4% | N/A |
| evt-008016 | remove liquidity | -100% | CLkfeh...UjKu44 |
| evt-008217 | remove liquidity | -100% | CT1xaw...BMBzLF |
| evt-008479 | remove liquidity | -100% | 71mjrZ...nVUbCd |
| evt-008544 | remove liquidity | -100% | E23to2...XhnBzB |
| evt-008614 | remove liquidity | -100% | 8zhkZN...Ysmmm6 |

**Pattern**: 11/13 nuovi rug hanno funder unico (non ripetuto) → il dynamic tracking li blocca DOPO il primo rug, ma ogni funder nuovo genera una loss. 2/13 hanno funder N/A (non tracciabile).

### Costo rug vs profitto

| Metrica | SOL | % del lordo |
|---|---|---|
| Profitto lordo (win + non-rug loss) | +1.034 | 100% |
| Costo rug | -0.389 | **37.6%** |
| Net | +0.645 | 62.4% |

**I rug mangiano il 37.6% del profitto lordo.** Questo è il singolo problema più grande.

---

## 5. Winner Trailing Stop — Migliorato

12 trailing stop totali (era 8):

| Trade | Peak | Exit PnL | Esito |
|---|---|---|---|
| evt-002258 | +37.5% | +21.6% | ✅ OK |
| evt-002448 | +40.1% | -14.9% | ⚠️ Crash |
| evt-002829 | +42.4% | +28.0% | ✅ OK |
| evt-003567 | +41.9% | +25.1% | ✅ OK |
| evt-003627 | +26.9% | -9.1% | ⚠️ Crash |
| evt-003729 | +25.1% | -11.2% | ⚠️ Crash |
| evt-004344 | +39.7% | +22.5% | ✅ OK |
| evt-005042 | +42.8% | +28.1% | ✅ OK |
| 4 nuovi | — | tutti positivi | ✅ OK |

Crash rate sceso da 37.5% (3/8) a 25% (3/12). I 4 nuovi trailing sono tutti positivi.
Net: +0.018 SOL (era +0.009).

---

## 6. Winner Profit Floor — Problematico

6 attivazioni totali (4 trade + 2 rug):

| Tipo | Count | Net SOL |
|---|---|---|
| Trade normali | 4 (1W/3L) | -0.011 |
| Rug events | 2 | -0.019 |
| **Totale** | **6** | **-0.030** |

**Il profit floor genera più perdite che profitti.** I 3 loss su trade normali e i 2 rug sono tutti crash speed che bypassano il floor.

---

## 7. Skip Distribution

| Skip Reason | Count | % |
|---|---|---|
| Unique counterparties | 2.958 | 35.5% |
| No WSOL side | 2.386 | 28.6% |
| Token security | 1.213 | 14.6% |
| Funder blacklisted | 770 | 9.2% |
| Funder cluster | 282 | 3.4% |
| Rapid dispersal | 184 | 2.2% |
| Low liquidity | 127 | 1.5% |
| Pre-buy top10 | 123 | 1.5% |
| Burner profile | 62 | 0.7% |
| Altro | ~168 | 2.0% |

**Funder blacklist cresciuto**: 594 → 770 blocchi (+176 nelle ultime 24h). Il tracking dinamico sta accumulando efficacia.

---

## 8. Configurazione Runtime Completa

### 8.1 Ambiente

```env
MONITOR_ONLY=true
PAPER_TRADE_ENABLED=true
```

### 8.2 Trade & Pool

| Parametro | Valore |
|---|---|
| `TRADE_AMOUNT_SOL` | 0.01 |
| `MIN_POOL_LIQUIDITY_SOL` | 20 |
| `MIN_POOL_LIQUIDITY_USD` | 10000 |
| `SLIPPAGE_PERCENT` | 20 |
| `AUTO_SELL_DELAY_MS` | 900000 (15 min) |

### 8.3 Token Security & Dev

| Parametro | Valore |
|---|---|
| `REQUIRE_RENOUNCED_MINT` | true |
| `REQUIRE_NO_FREEZE` | true |
| `MAX_DEV_HOLDINGS_PCT` | 20 |
| `ENFORCE_DEV_HOLDINGS_CHECK` | true |

### 8.4 Pre-Buy

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
| `PRE_BUY_TOP10_CHECK_ENABLED` | true |
| `PRE_BUY_TOP10_MAX_PCT` | 90 |
| `PRE_BUY_TOP1_EXTERNAL_HOLDER_MAX_PCT` | 20 |
| `PRE_BUY_TOP10_FAIL_OPEN` | false |

### 8.5 Ultra-Short Rug Guard

| Parametro | Valore |
|---|---|
| `PRE_BUY_ULTRA_SHORT_RUG_GUARD_ENABLED` | true |
| `PRE_BUY_ULTRA_SHORT_RUG_GUARD_WINDOW_MS` | 2500 |
| `PRE_BUY_ULTRA_SHORT_RUG_GUARD_MAX_LIQ_DROP_PCT` | 35 |
| `PRE_BUY_ULTRA_SHORT_RUG_GUARD_MAX_QUOTE_DROP_PCT` | 35 |

### 8.6 No-WSOL

| Parametro | Valore |
|---|---|
| `PRE_BUY_NO_WSOL_RECHECK_ENABLED` | true |
| `PRE_BUY_NO_WSOL_RECHECK_MAX_ATTEMPTS` | 10 |
| `FORCE_ENTRY_ON_NO_WSOL_SIDE` | false |
| `DEFERRED_NO_WSOL_QUEUE_ENABLED` | false |

### 8.7 Winner Management

| Parametro | Valore | History |
|---|---|---|
| `HOLD_WINNER_MANAGEMENT_ENABLED` | true | |
| `HOLD_WINNER_CHECK_INTERVAL_MS` | 200 | era 250 |
| `HOLD_WINNER_MIN_HOLD_MS` | 4000 | |
| `HOLD_WINNER_ARM_PNL_PCT` | 8 | era 10→8 |
| `HOLD_WINNER_TRAILING_DROP_PCT` | 10 | era 15→20→10 |
| `HOLD_WINNER_TRAILING_DROP_PCT_CP0` | 10 | era 8→15→10 |
| `HOLD_WINNER_HARD_TAKE_PROFIT_PCT` | 50 | era 100→50 |
| `HOLD_WINNER_HARD_TAKE_PROFIT_PCT_CP1` | 50 | era 100→50 |
| `HOLD_WINNER_MIN_PEAK_SOL` | 0.0104 | |
| `HOLD_WINNER_PROFIT_FLOOR_PCT` | 3 | nuovo 29/03 |

### 8.8 Hold Sell Protection

| Parametro | Valore |
|---|---|
| `HOLD_SELL_QUOTE_COLLAPSE_DROP_PCT` | 35 |
| `HOLD_SELL_QUOTE_COLLAPSE_CHECK_INTERVAL_MS` | 300 |
| `HOLD_SINGLE_SWAP_SHOCK_DROP_PCT` | 35 |
| `HOLD_SINGLE_SWAP_SHOCK_CHECK_INTERVAL_MS` | 300 |
| `HOLD_HARD_STOP_LOSS_PCT` | 15 |
| `HOLD_HARD_STOP_LOSS_CHECK_INTERVAL_MS` | 250 |

### 8.9 Hold Creator Risk Recheck

| Parametro | Valore |
|---|---|
| `HOLD_CREATOR_RISK_RECHECK_ENABLED` | true |
| `HOLD_CREATOR_RISK_RECHECK_INTERVAL_MS` | 1500 |
| `HOLD_REMOVE_LIQ_DETECT_ENABLED` | true |
| `HOLD_CREATOR_AMM_BURST_DETECT_ENABLED` | true |
| `HOLD_CREATOR_OUTBOUND_EXIT_ENABLED` | true |
| `HOLD_CREATOR_OUTBOUND_SPRAY_EXIT_ENABLED` | true |
| `HOLD_CREATOR_INBOUND_SPRAY_EXIT_ENABLED` | true |
| `HOLD_CREATOR_CLOSE_ACCOUNT_BURST_EXIT_ENABLED` | true |
| `HOLD_POOL_CHURN_DETECT_ENABLED` | true |

### 8.10 Creator Risk Pre-Entry (ON)

`CREATOR_RISK_WHITELISTED_CC_VALUES`: `0,2,4,47`

Tutti ON: funder cluster (min 1 rug), standard pool micro, standard pool outbound-heavy, suspicious root, spray outbound, inbound spray, setup burst, close-account burst, rapid dispersal (min 3 transfers, 100 SOL, 20% liq), fresh-funded high-seed, precreate burst, precreate large uniform, precreate dispersal+setup, concentrated inbound, lookup-table+create, repeat create-remove.

### 8.11 Creator Risk Pre-Entry (OFF)

relay funding, standard pool relay, standard pool relay outbound, creator seed ratio, direct AMM re-entry, probation.

### 8.12 Blacklists

| File | Entries |
|---|---|
| `blacklists/funders.txt` | 8 (statici) |
| `blacklists/creators.txt` | 67+ (dinamici) |
| `blacklists/funder-counts.json` | 48 funder tracciati |

### 8.13 Runtime

| Parametro | Valore |
|---|---|
| `MAX_CONCURRENT_OPERATIONS` | 2 |
| `QUEUE_MAX_PENDING_SIGNATURES` | 300 |
| `RUG_HISTORY_CACHE_TTL_MS` | 60000 (1 min) |
| `CREATOR_RISK_DEEP_CHECK_BUDGET_MS` | 12000 |
| `CREATOR_RISK_RECHECK_DEEP_CHECK_BUDGET_MS` | 2500 |
| `CC_SHADOW_ENABLED` | false |

---

## 9. Problemi Identificati

### 🔴 RUG: 39 eventi, -0.389 SOL (37.6% del profitto lordo)

Il problema più grande. 36/39 escono per `remove liquidity`, tutti con funder unico → il dynamic tracking li blocca solo DOPO il primo rug.

### 🟡 Winner profit floor: net negativo (-0.030 SOL)

Il floor non protegge nei crash istantanei. 3/4 trade normali e 2/2 rug escono in forte negativo.

### 🟢 Trailing crash: migliorato (25% crash rate vs 37.5%)

I 4 nuovi trailing sono tutti positivi. Il trailing sta funzionando meglio con più dati.

---

## 10. Raccomandazioni

1. **NON toccare filtri pre-entry** — WR 69.4% con mediana win 37.5% sono solidi.
2. **Valutare rimozione/revisione profit floor** — net negativo, potrebbe essere meglio lasciare che il trailing stop gestisca tutto.
3. **Investigare rug mitigation** — 37.6% del profitto perso in rug è troppo. Possibili direzioni: score-based sizing, hold time analysis, early exit su remove liquidity detection.
4. Continuare raccolta dati fino a 500+ trade.

---

## 11. Commit History

```
f7bd634 analysis: add full analysis 2026-04-05 (264 trades, WR 77.3%, +0.826 SOL) [NOTA: PnL era sovrastimato]
58ce8d3 revert: remove cp=1 from UC whitelist
63cf2d5 fix: profit floor intercept in hard stop loss + cp=1
f89a4e1 fix: expand rug tracking to all exit reasons
8fa2c50 tune: trailing 20%->10%, TP 100%->50%
225253f feat: dynamic funder rug tracking
223719e feat: winner profit floor, healthcheck, ARM 10->8
357d3f8 disable CC shadow
5396452 disable UC sub-trigger in RECHECK only
```

---

*Analisi generata il 2026-04-06. Prossima analisi dopo 500+ trade totali.*
