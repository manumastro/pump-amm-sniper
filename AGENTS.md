# AGENTS (lazy-load)

Questo file e volutamente minimale: usa i documenti sotto solo quando servono.

## Indice rapido
- Controlli bot: `docs/controls.md`
- Runbook deploy/systemd: `docs/systemd-runbook.md`
- Architettura e ownership moduli: `docs/architecture.md`
- Roadmap tuning profit: `docs/profit-roadmap.md`
- Worklog ultimo ciclo: `docs/worklog-2026-03-21.md`
- Analisi creator/dev: `idea/creator-tx-analysis.md`
- **Analisi rug:** `node scripts/rug-analysis.js` — mostra tabella completa pre-entry (tutti i 18+ controlli) e post-entry (triggers, guards, exit reason) per ogni rug loss.

## Regole operative non negoziabili
- **DOPO OGNI MODIFICA A `src/**`:** `npm run build` → stop servizi → reset log/report → start servizi. Senza build, il bot esegue il codice vecchio in `dist/`.
- Sequenza deploy runtime: build -> stop servizi -> reset log/report -> start/restart servizi.
- File da resettare dopo modifiche importanti: `paper.log`, `logs/paper-report.json`, `logs/paper-report.txt`, `logs/paper-report-daemon.log`, tutti i `logs/paper-worker-*.log`.
- **PRIMA di resettare il report:** fare sempre backup: `cp logs/paper-report.json logs/paper-report-YYYY-MM-DD.json` per preservare lo storico trade/wins/rug.
- Nuovi controlli non in `src/pumpAmmSniper.ts`: usare i moduli target (`src/services/creator-risk/`, `src/services/paper-trade/`, ecc.) secondo `docs/architecture.md`.
- Solscan parser solo per debug investigativo manuale, mai nel path decisionale realtime del bot.

## Riferimenti rapidi
- Config esempio: `.env.example`
- Config runtime centralizzata: `src/app/config.ts`
- Blacklist: `blacklists/`
