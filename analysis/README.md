# Analysis Index

Cartella per le analisi periodiche del bot pump-amm-sniper.

## Analisi disponibili

| Data | File | Trades+Rug | WR | Net PnL | Note |
|---|---|---|---|---|---|
| 2026-09-15 | [2026-09-15-gmgn-sei-ore.md](2026-09-15-gmgn-sei-ore.md) | 16.751 giri | 32% | — | **Tutti i token di sei ore su gmgn (160, enumerazione completa), 344 portafogli estratti a caso e ricostruiti.** Meta' dei "vincenti" non guadagna; il vantaggio dell'ingresso rapido e' un artefatto della selezione (corregge la riga sotto); i terminali a pagamento non danno vantaggio. |
| 2026-09-14 | [2026-09-14-gmgn-100-token-nuovi.md](2026-09-14-gmgn-100-token-nuovi.md) | 14.856 giri | 36% | — | **pump.fun + LaunchLab.** I 100 token piu' nuovi su gmgn, 85 portafogli ricostruiti on-chain. Meta' dei "vincenti" non guadagna; la fascia 1-10 secondi e' la piu' redditizia. |
| 2026-09-14 | [2026-09-14-stonk-censimento.md](2026-09-14-stonk-censimento.md) | 30.757 giri | 33% | — | **stonk.fun.** 1.182 curve a caso, 26.581 portafogli. Il pedaggio e' piu' grande del segnale; la bravura sta nell'uscita. |
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
