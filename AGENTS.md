# AGENTS 

## Indice rapido
- Controlli bot: `docs/controls.md`
- Runbook deploy/systemd: `docs/systemd-runbook.md`
- Architettura e ownership moduli: `docs/architecture.md`
- Roadmap tuning profit: `docs/profit-roadmap.md`
- Worklog ultimo ciclo: `docs/worklog-2026-03-29.md`
- Worklog ciclo precedente: `docs/worklog-2026-03-28.md`
- Analisi creator/dev: `idea/creator-tx-analysis.md`
- **Analisi periodiche:** `analysis/` — contiene snapshot analitici completi con metriche, config e raccomandazioni
- **Analisi rug:** `node scripts/rug-analysis.js` — mostra tabella completa pre-entry (tutti i 18+ controlli) e post-entry (triggers, guards, exit reason) per ogni rug loss.

## Fase operativa corrente

**FASE: RACCOLTA DATI STABILE (dal 2026-04-02)**

Il bot ha raggiunto una configurazione semi-ottimale:
- WR 77.3%, median win +37%, EV +0.00314 SOL/trade
- 18+ controlli pre-entry attivi, winner management con TP 50%, trailing 10%, profit floor 3%
- Dynamic funder rug tracking operativo

Siamo in attesa di raccogliere 500+ trade per validare la stabilità prima di intervenire.
**Non modificare filtri pre-entry o soglie hold senza prima consultare l'ultima analisi in `analysis/`.**

Ultima analisi: `analysis/2026-04-05-full-analysis.md` (264 trade, +0.826 SOL)

## Regole operative non negoziabili
- **I controlli sono la parte piu importante del bot.** Prima di modificare logiche di entry, hold, creator-risk, report o analisi rug, consultare sempre `docs/controls.md`.
- **Ogni modifica ai controlli deve aggiornare anche la documentazione.** Se cambia una soglia, un toggle, una regola di blocco, una guardia hold o il significato dei report/log, aggiornare subito `docs/controls.md` nello stesso ciclo di lavoro.
- **DOPO OGNI MODIFICA A `src/**`:** `npm run build` → stop servizi → reset log/report → start servizi. Senza build, il bot esegue il codice vecchio in `dist/`.
- Sequenza deploy runtime: build -> stop servizi -> reset log/report -> start/restart servizi.
- File da resettare dopo modifiche importanti: `paper.log`, `logs/paper-report.json`, `logs/paper-report.txt`, `logs/paper-report-daemon.log`, tutti i `logs/paper-worker-*.log`.
- **PRIMA di resettare il report:** fare sempre backup: `cp logs/paper-report.json logs/paper-report-YYYY-MM-DD.json` per preservare lo storico trade/wins/rug.
- Nuovi controlli non in `src/pumpAmmSniper.ts`: usare i moduli target (`src/services/creator-risk/`, `src/services/paper-trade/`, ecc.) secondo `docs/architecture.md`.
- Per debug investigativo manuale, utilizzare il solscan-parser.

## Riferimenti rapidi
- Config esempio: `.env.example`
- Config runtime centralizzata: `src/app/config.ts`
- Blacklist: `blacklists/`
