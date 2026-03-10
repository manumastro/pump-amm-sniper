# AGENTS

## Docs
- Controlli bot: `docs/controls.md`
- Runbook systemd: `docs/systemd-runbook.md`
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
