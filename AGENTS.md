# AGENTS (lazy-load)

Questo file e volutamente minimale: usa i documenti sotto solo quando servono.

## Indice rapido
- Controlli bot: `docs/controls.md`
- Runbook deploy/systemd: `docs/systemd-runbook.md`
- Architettura e ownership moduli: `docs/architecture.md`
- Roadmap tuning profit: `docs/profit-roadmap.md`
- Worklog ultimo ciclo: `docs/worklog-2026-03-21.md`
- Analisi creator/dev: `idea/creator-tx-analysis.md`

## Regole operative non negoziabili
- I servizi systemd eseguono `dist/`, non `src/`: dopo modifiche runtime fare sempre `npm run build`.
- Sequenza deploy runtime: build -> stop servizi -> reset log/report -> start/restart servizi.
- File da resettare dopo modifiche importanti: `paper.log`, `logs/paper-report.json`, `logs/paper-report.txt`, `logs/paper-report-daemon.log`, tutti i `logs/paper-worker-*.log`.
- Nuovi controlli non in `src/pumpAmmSniper.ts`: usare i moduli target (`src/services/creator-risk/`, `src/services/paper-trade/`, ecc.) secondo `docs/architecture.md`.
- Solscan parser solo per debug investigativo manuale, mai nel path decisionale realtime del bot.

## Riferimenti rapidi
- Config esempio: `.env.example`
- Config runtime centralizzata: `src/app/config.ts`
- Blacklist: `blacklists/`
