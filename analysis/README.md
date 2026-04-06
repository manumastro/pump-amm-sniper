# Analysis Index

Cartella per le analisi periodiche del bot pump-amm-sniper.

## Analisi disponibili

| Data | File | Trades+Rug | WR | Net PnL | Note |
|---|---|---|---|---|---|
| 2026-04-06 | [2026-04-06-full-analysis.md](2026-04-06-full-analysis.md) | 348+39 | 69.4% | **+0.645 SOL** | Analisi corretta. Metodologia definitiva. |
| 2026-04-05 | [2026-04-05-full-analysis.md](2026-04-05-full-analysis.md) | 264+26 | 77.3%* | +0.826 SOL* | ⚠️ PnL sovrastimato (escludeva rug). Reale: +0.566 SOL |

*\* WR e PnL della 04-05 erano calcolati solo sui trade con `checksPassed=true`, escludendo i rug events. La metodologia 04-06 include correttamente entrambi.*

## Metodologia

**Outcome events** = trade (`checksPassed=true`) + rug events (`checksPassed=false, rugLoss=true`)

Il report daemon conta i rug come loss aggiuntive. Il `totalPnlSol` nel header del report include già le rug losses. Per verificare:
```
Net PnL = Σ(trade pnlSol, no outlier) + Σ(rug pnlSol) = totalPnlSol (approx)
```

## Fase corrente

**Fase operativa stabile (dal 2026-04-02).** WR 69.4%, mediana win +37.5%, EV +0.00167 SOL/trade. Raccolta dati verso 500+ trade per validare stabilità.
