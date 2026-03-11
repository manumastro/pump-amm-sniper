# AGENTS

## Docs
- Controlli bot: `docs/controls.md`
- Runbook systemd: `docs/systemd-runbook.md`
- Architettura / ownership moduli: `docs/architecture.md`
- Analisi creator/dev: `idea/creator-tx-analysis.md`

## Config
- Esempio env: `.env.example`
- Blacklist: cartella `blacklists/`

## Skills
Leggere solo se serve:
- Helius: `.agents/skills/helius/SKILL.md`
- Helius + trading: `.agents/skills/helius-dflow/SKILL.md`
- SVM / architettura Solana: `.agents/skills/svm/SKILL.md`
- Solana dev generale: `/home/manu/.codex/skills/solana-dev-skill/SKILL.md`

## MCP / Tools
Preferire:
- Helius MCP per wallet, funding, tx history, parsed tx, asset data
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

## Architettura codice
- Entry runtime attuale: `src/pumpAmmSniper.ts`
- Bootstrap / supervisor / worker lifecycle: `src/app/bootstrap.ts`, `src/app/runtime.ts`, `src/app/worker.ts`
- Config condivisa: `src/app/config.ts`
- Tipi condivisi: `src/domain/types.ts`
- Motore creator risk: `src/services/creator-risk/`
- Paper trade / pre-buy / hold: `src/services/paper-trade/`
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
