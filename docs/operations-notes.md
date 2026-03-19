# Operations Notes (Recent Changes)

Date range: 2026-03-14 to 2026-03-19 (CET)

## Summary
- Codebase was fully rolled back to the 2026-03-14 baseline commit and then cleaned of audit logic.
- Audit management (shadow/winner audits) was removed from runtime and reporting.
- Creator-risk RPC pressure was reduced to avoid 429/IP throttling.
- Default runtime concurrency was reduced to 1 worker.
- Services were stopped on 2026-03-18 due to rate limits; plan is to update Helius key before restart.

## Rollback Baseline
- Baseline commit restored: `7d6d3cd` (2026-03-14 08:49 CET).
- Safety backup branch created before rollback:
  - `backup/pre-rollback-20260318_223600`

## Audit Removal (Code + Reporting)
All audit paths were removed:
- Config keys and profiles removed from `src/app/config.ts`.
- `auditMode` removed from `src/domain/types.ts`.
- Shadow audit flows removed from `src/pumpAmmSniper.ts`.
- Winner shadow audit flows removed from `src/services/paper-trade/index.ts`.
- Audit parsing/summary removed from `scripts/paper-report-daemon.js`.

Commit:
- `d8fd241` "refactor: remove audit management paths from runtime and reporting"

## Creator-Risk RPC Pressure Reduction
Goal: reduce 429 and avoid IP throttle.

Config defaults changed in `src/app/config.ts`:
- `MAX_CONCURRENT_OPERATIONS`: `2 -> 1`
- `CREATOR_RISK_SIG_LIMIT`: `80 -> 40`
- `CREATOR_RISK_PARSED_TX_LIMIT`: `50 -> 20`
- `CREATOR_RISK_PARSED_TX_CONCURRENCY`: new, default `4`
- `CREATOR_RISK_RELAY_SIG_LIMIT`: `8 -> 4`
- `CREATOR_RISK_RELAY_PARSED_TX_LIMIT`: `6 -> 3`
- `CREATOR_RISK_DIRECT_AMM_REENTRY_SIG_LIMIT`: `8 -> 4`
- `CREATOR_RISK_PRECREATE_BURST_SIG_LIMIT`: `180 -> 60`
- `CREATOR_RISK_PRECREATE_BURST_PARSED_TX_LIMIT`: `120 -> 25`
- `CREATOR_RISK_RATE_LIMIT_RETRIES`: `3 -> 1`
- `CREATOR_RISK_RATE_LIMIT_RETRY_BASE_MS`: `350ms -> 600ms`

Runtime changes:
- Parsed transaction fetches are now batched instead of full `Promise.all`:
  - `fetchParsedTransactionsForSignatures` in `src/pumpAmmSniper.ts`
  - Batch size controlled by `CREATOR_RISK_PARSED_TX_CONCURRENCY`
- Retry loop short-circuits on "Too many requests from your IP":
  - `runCheckWithRetry` in `src/services/creator-risk/index.ts`

Commit:
- `90925df` "perf: reduce creator-risk RPC pressure and limit parsed-tx concurrency"

## Service Status
- Services were stopped at user request (rate limit/IP throttle).
  - `pump-sniper.service`: inactive
  - `pump-report.service`: inactive
- Restart only after updating the Helius API key.

## Deploy/Restart Runbook (current)
Use the standard sequence:
1. `npm run build`
2. `systemctl --user stop pump-sniper.service pump-report.service`
3. Backup reports:
   - `cp logs/paper-report.json logs/archive/paper-report-$(date +%Y%m%d_%H%M%S).json`
   - `cp logs/paper-report.txt logs/archive/paper-report-$(date +%Y%m%d_%H%M%S).txt`
4. Reset logs:
   - `paper.log`, `logs/paper-report.json`, `logs/paper-report.txt`,
     and all `logs/paper-worker-*.log`, `logs/paper-report-daemon.log`
5. `systemctl --user start pump-sniper.service pump-report.service`

## Remote State
- `origin/main` was force-updated to the rollback+cleanup state.
- Current head: `90925df`.

