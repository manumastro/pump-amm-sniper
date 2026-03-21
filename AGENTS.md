# AGENTS

Questo file e ridotto al minimo per abilitare un approccio **lazy-load**:
- mantieni qui solo regole essenziali ad alto impatto
- carica i dettagli operativi dai documenti sotto solo quando servono al task

## Regole essenziali
- Non aggiungere nuovi controlli direttamente in `src/pumpAmmSniper.ts`.
- Controlli creator/funder/relay/pattern wallet: `src/services/creator-risk/`.
- Controlli pre-buy/hold/exit: `src/services/paper-trade/`.
- Test corrente: A/B/C sincronizzato su 3 worker (w1 baseline, w2 unique counterparties=50, w3 burner bypass) con report dedicati `logs/paper-worker-*-report.json`.
- Dopo modifiche a `src/**` che impattano runtime: `npm run build` prima del restart systemd.
- I servizi systemd usano `dist/`, non `src/`.
- Parser Solscan (`solscan-parser/`) solo per debug/investigazione, mai nel path realtime.

## Quick links (caricare on-demand)
- Controlli bot: `docs/controls.md`
- Architettura / ownership: `docs/architecture.md`
- Anti-rug (Phase 1 + bypass): `docs/anti-rug-filter-implementation.md`
- Phase 2 creator AMM buy: `docs/phase2-creator-amm-buy-detection.md`
- Worker A/B/C: `docs/worker-ab-testing.md`
- Runbook systemd: `docs/systemd-runbook.md`
- Operazioni recenti: `docs/operations-notes.md`
- Roadmap profit: `docs/profit-roadmap.md`
- Checklist produzione: `PRODUCTION_BOT_CHECKLIST.md`

## Paths utili
- Config esempio: `.env.example`
- Blacklist: `blacklists/`
- Log principali: `paper.log`, `logs/paper-report.json`, `logs/paper-report.txt`
- Servizi: `pump-sniper.service`, `pump-report.service`
