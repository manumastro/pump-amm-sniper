# Gemini CLI - Project Instructions

## General Rules
- Always speak in Italian.
- Follow the Research -> Strategy -> Execution lifecycle.
- Never commit or stage changes unless explicitly asked.
- Maintain senior engineering standards: type safety, idiomatic code, documentation.

## Winner Management
- Profiles: Standard (Live), Ambitious, Aggressive, Ultra.
- Goal: Increase profit by holding winners longer based on momentum/PNL.
- Configuration is in `src/app/config.ts`.
- Shadow audits for Ambitious, Aggressive, and Ultra run in parallel after a "winner" exit.

## Operational Procedures
- **Reset Logs:** After significant logic changes, always delete:
  - `paper.log`
  - `logs/*.log`
  - `logs/*.json`
  - `logs/*.txt`
- **Build First:** Run `npm run build` before restarting systemd services.
- **Service Management:**
  - Bot: `pump-sniper.service`
  - Reporter: `pump-report.service`

## Analysis
- Use `logs/paper-report.json` and `logs/paper-report.txt` for performance audit.
- Analyze `shadowAuditSummary` to decide on filter loosening or profile promotion.
