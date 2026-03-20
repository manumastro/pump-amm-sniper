# AGENTS

**IMPORTANT**: This file must be kept in sync with `GEMINI.md` and `AGENTS.md`. Any updates to agent instructions must be made to ALL THREE files simultaneously.

## Docs
- Controlli bot: `docs/controls.md`
- Runbook systemd: `docs/systemd-runbook.md`
- Architettura / ownership moduli: `docs/architecture.md`
- Analisi creator/dev: `idea/creator-tx-analysis.md`

## Config
- Esempio env: `.env.example`
- Blacklist: cartella `blacklists/`

## Tools
Preferire:
- shell locale per log, systemd, build, git
- ripgrep per ricerca veloce nel repo

## Solscan Parser (debug mirato)
- Repo locale: `solscan-parser/`
- Script debug: `solscan-parser/src/debug_account_tabs.py`
- Prerequisiti runtime locali:
  - `python3 -m venv solscan-parser/.venv`
  - `solscan-parser/.venv/bin/pip install -r solscan-parser/requirements.txt`
  - `sudo apt-get install -y xvfb`
- Uso previsto:
  - quando si fa studio/debug manuale di un creator o di una pool su Solscan
  - dato `token` + `creator` + finestra temporale, raccogliere tab `Transactions`, `Transfers`, `Activities`
  - output JSON locale per analisi (`last_rugpulls/` o percorso custom)
- Regola di analisi:
  - non limitarsi automaticamente alla finestra `buy -> remove_liquidity`
  - se tra buy e remove il creator sembra inattivo o il rug appare "all'improvviso", estendere l'analisi anche a una finestra ampia prima della `create_pool`
  - il tratto pre-create e spesso quello piu utile per trovare spray outbound, funding chain, dispersione SOL, mint/setup account e pattern wallet operativi
- Nota runtime:
  - su VPS Linux usare `xvfb-run -a` e preferire browser non-headless (non passare `--headless`), perché Cloudflare su Solscan è più restrittivo in headless puro
- Comando tipo:
  - `xvfb-run -a solscan-parser/.venv/bin/python solscan-parser/src/debug_account_tabs.py --creator <CREATOR> --token <TOKEN_MINT> --from-local "YYYY-MM-DD HH:MM:SS" --to-local "YYYY-MM-DD HH:MM:SS" --tz Europe/Berlin --tabs transactions,transfers,activities --output last_rugpulls/solscan_debug.json`
  - `xvfb-run -a solscan-parser/.venv/bin/python solscan-parser/src/debug_account_tabs.py --creator <CREATOR> --token <TOKEN_MINT> --from-local "YYYY-MM-DD HH:MM:SS" --to-local "YYYY-MM-DD HH:MM:SS" --tz Europe/Berlin --tabs transactions,transfers,activities --stdout-only`
- Regola:
  - non usare questo parser nel path decisionale real-time del bot; usarlo solo per investigazione/debug on demand.

## Log e report
- Log runtime: `paper.log`
- Report JSON: `logs/paper-report.json`
- Report testo: `logs/paper-report.txt`

Regola operativa:
- dopo modifiche importanti a logica/controlli del bot, prima del restart dei servizi va sempre fatto reset completo di log e report:
  - `paper.log`
  - `logs/paper-report.json`
  - `logs/paper-report.txt`
  - `logs/paper-worker-1.log`
  - `logs/paper-worker-2.log`
  - `logs/paper-worker-3.log`
  - `logs/paper-report-daemon.log`

Nota:
- se il numero di worker aumenta, il reset deve includere tutti i file `logs/paper-worker-*.log` presenti

## Servizi
- Bot: `pump-sniper.service`
- Reporter: `pump-report.service`

Regola deploy:
- i servizi systemd eseguono il build compilato in `dist/`, non i file `src/`
- dopo modifiche a `src/**`, `systemctl --user restart ...` da solo non basta: prima va eseguito `npm run build`
- sequenza corretta dopo modifiche runtime: build -> stop servizi -> reset log/report -> start/restart servizi

## Anti-Rug Filter Strategy

### Phase 1: Pre-Entry Funding Pattern Detection (ACTIVE)
- **Documentation**: `docs/anti-rug-filter-implementation.md`
- **Historical Coverage**: 81% (21/26 rugs blocked before entry)
- **Implementation**: `src/services/creator-risk/index.ts` (lines ~1293-1311 early check, ~1859-1883 deep check)
- **Patterns Detected**:
  - Micro-transfer pattern: 2+ micro transfers from 2+ sources
  - Relay funding asymmetry: inbound ≤3.0 SOL, outbound ≥10.0 SOL, ratio >10x
- **Status**: Running in production, blocking hostile pools pre-entry

### Phase 2: Post-Entry Creator AMM Buy Detection (ACTIVE - PRODUCTION MONITORING)
- **Documentation**: `docs/phase2-creator-amm-buy-detection.md`
- **Expected Coverage**: 19% additional (5 of 26 remaining rugs)
- **Implementation**: `src/services/paper-trade/creatorAmmBuyDetector.ts`
- **Integration**: `src/services/paper-trade/holdMonitor.ts` (detection loop every 500ms)
- **Pattern**: Creator buying own token during hold = 100% rug indicator
  - Detected via `getSignaturesForAddress(creatorAddress)` looking for "AMM: Buy"
  - Triggers immediate exit with reason: "creator amm buy (rug pump)"
- **Solscan Validation**: 100% consistency across 3 analyzable rugs (evt-000079, evt-000150, evt-000200)
- **Configuration** (`src/app/config.ts` lines 175-177):
  - `HOLD_CREATOR_AMM_BUY_DETECT_ENABLED: true`
  - `HOLD_CREATOR_AMM_BUY_CHECK_INTERVAL_MS: 500`
- **Status**: Running since 2026-03-20 09:18:53 CET, waiting for Phase 1 pass-throughs to validate

## Architettura codice
- Entry runtime attuale: `src/pumpAmmSniper.ts`
- Bootstrap / supervisor / worker lifecycle: `src/app/bootstrap.ts`, `src/app/runtime.ts`, `src/app/worker.ts`
- Config condivisa: `src/app/config.ts`
- Tipi condivisi: `src/domain/types.ts`
- Motore creator risk: `src/services/creator-risk/`
- Paper trade / pre-buy / hold: `src/services/paper-trade/`
  - Phase 2 detector: `src/services/paper-trade/creatorAmmBuyDetector.ts`
- Liquidity controls: `src/services/liquidity/`
- Token security: `src/services/token-security/`
- Top10 concentration: `src/services/top10/`
- Dev holdings: `src/services/dev-holdings/`
- Logging operativo: `src/services/reporting/stageLog.ts`
- Utility pure: `src/utils/`

Regole:
- nuovi controlli non vanno aggiunti direttamente in `src/pumpAmmSniper.ts`
- controlli creator / funder / relay / pattern wallet devono convergere in `src/services/creator-risk/`
- controlli pre-buy / hold / exit devono convergere in `src/services/paper-trade/`
- helper RPC o parsing condivisi non vanno duplicati nei controlli: devono finire in moduli riusabili

Nota transitoria:
- il refactor e in corso, quindi alcune logiche vivono ancora in `src/pumpAmmSniper.ts`
- quando tocchi il comportamento, segui la nuova struttura target descritta in `docs/architecture.md`
- Phase 1 + Phase 2 anti-rug filter sono pienamente integrati e in produzione; vedi `docs/phase2-creator-amm-buy-detection.md` per dettagli
