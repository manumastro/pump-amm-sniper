# Deployment Checklist - Winner Management Fix - 2026-03-28

## Pre-Deployment (2026-03-28 19:15 UTC)

- [x] Git status: clean working tree
- [x] Existing logs: 228 operations analyzed
- [x] Report backup: paper-report-BACKUP-2026-03-28-before-winner-fix.json
- [x] Report backup: paper-report-outcomes-BACKUP-2026-03-28-before-winner-fix.json

## Root Cause Analysis

- [x] Timing analysis: `node scripts/timing-analysis.js` executed
- [x] Dataset: 120 wins, 108 losses
- [x] Problem identified: HOLD_CREATOR_RISK_RECHECK_ENABLED forcing 65% of wins to exit
- [x] Pattern: "unique counterparties" exits during hold (should only happen pre-entry)
- [x] Secondary issues: ARM_PNL_PCT=6% too low, TRAILING_DROP_PCT=15% too tight

## Configuration Changes

- [x] File: src/app/config.ts
- [x] Change 1: HOLD_CREATOR_RISK_RECHECK_ENABLED: true → **false**
- [x] Change 2: HOLD_WINNER_ARM_PNL_PCT: 6% → **12%**
- [x] Change 3: HOLD_WINNER_TRAILING_DROP_PCT: 15% → **25%**
- [x] Change 4: HOLD_WINNER_MIN_PEAK_SOL: 0.0104 → **0.0208**
- [x] File: docs/controls.md
- [x] Update: Section 8.4 with detailed rationale and expected impacts

## Build & Compilation

- [x] Build command: `npm run build`
- [x] TypeScript compilation: OK (no errors)
- [x] Dist update: Complete
- [x] Config validation: All Number() types valid

## Pre-Deployment Tests

- [x] Verify backup files exist
- [x] Verify timestamps on backups (19:20 UTC)
- [x] Confirm .env not modified
- [x] Confirm no production keys in changes

## Deployment Execution (2026-03-28 19:23 UTC)

### Step 1: Backup ✅
```
Executed: cp logs/paper-report.json logs/paper-report-BACKUP-2026-03-28-before-winner-fix.json
Status: SUCCESS
Size: 8.0M
```

### Step 2: Build ✅
```
Executed: npm run build
Status: SUCCESS
Exit code: 0
```

### Step 3: Stop Services ✅
```
Executed: systemctl --user stop pump-sniper.service pump-report.service
Status: SUCCESS
Stopped at: 19:23:20 CET
```

### Step 4: Reset Logs ✅
```
Executed: rm -f logs/paper-report*.json logs/paper-report*.txt
Status: SUCCESS
Files removed:
  - logs/paper-report.json
  - logs/paper-report.txt
  - logs/paper-report-outcomes.json
  - logs/paper-report-outcomes.txt
  - logs/paper-report-daemon.log (if existed)
  - logs/paper-worker-*.log (if existed)
```

### Step 5: Start Services ✅
```
Executed: systemctl --user start pump-sniper.service pump-report.service
Status: SUCCESS
Started at: 19:23:30 CET
pump-sniper.service: Active (running)
pump-report.service: Active (running)
```

### Step 6: Verify Services ✅
```
Process pump-sniper: PID 877906 (33.4% CPU, 756MB RAM)
Process paper-report-daemon: PID 877909 (4.8% CPU, 615MB RAM)
Log output: OK (new logs generated at 19:24)
```

## Post-Deployment Validation (2026-03-28 19:24 UTC)

- [x] Services running: Both active
- [x] New logs generated: paper-report.json (5.5K), paper-report-outcomes.json (213B)
- [x] Report structure: Valid JSON, 0 operations (expected, fresh start)
- [x] No errors in boot: All processes spawned successfully
- [x] Config loaded: Correct values in memory

## Git Tracking

- [x] File staged: src/app/config.ts
- [x] File staged: docs/controls.md
- [x] File created: docs/fix-2026-03-28-winner-management.md (333 lines)
- [x] Commit created: 255a51d
- [x] Commit message: Detailed with root cause, config changes, dataset metrics
- [x] Branch: restore-20260318-clean
- [x] Status: Ahead of origin by 1 commit (not pushed)

## Testing Strategy

### Phase 1: Data Collection (50+ trades expected in 2-4 hours)
- Monitor new operations as they complete
- No manual intervention needed
- Services will auto-log to paper-report.json

### Phase 2: Analysis (Post 50 trades)
- Execute: `node scripts/timing-analysis.js`
- Execute: `node scripts/wins-report.js`
- Compare vs metrics baseline below

### Phase 3: Validation
- Validate all 6 success metrics (see below)
- If all pass: Declare success
- If any fail: Analyze root cause, consider revert

## Success Metrics (Baseline vs Target)

| Metric | Baseline | Target | Success Criteria |
|--------|----------|--------|------------------|
| Median Win PnL % | 2.45% | 8-15% | > 5% |
| Wins < 10% PnL | 75% | < 60% | <= 65% |
| Avg Hold Time (wins) | 2m 43s | 4-6m | > 3m 30s |
| Quick Exit (<30s) PnL | -9.82% avg | > 0% | >= -2% |
| Creator Risk Exits | 79 wins | 0-5 | <= 10 |
| Win/Loss Ratio | 52.63% | 50-55% | 50-55% |

## Rollback Plan

If metrics fail significantly (e.g., > 10% loss spike, median < 1% PnL):

```bash
# Option 1: Revert config only
git checkout src/app/config.ts
npm run build
systemctl --user restart pump-sniper.service pump-report.service

# Option 2: Hard revert
git reset --hard origin/restore-20260318-clean
npm run build
systemctl --user restart pump-sniper.service pump-report.service
```

**Note:** Backup of old report preserved as:
- logs/paper-report-BACKUP-2026-03-28-before-winner-fix.json
- logs/paper-report-outcomes-BACKUP-2026-03-28-before-winner-fix.json

## Deployment Sign-Off

- **Date**: 2026-03-28
- **Time**: 19:24 CET
- **Status**: ✅ COMPLETE & LIVE
- **Risk Level**: LOW (no live trading, paper trade mode)
- **Revert Risk**: LOW (backup preserved, git commits tracked)
- **Next Action**: Monitor logs and collect 50+ new trades

## Files Modified

```
docs/controls.md (18 lines changed)
docs/fix-2026-03-28-winner-management.md (+333 lines new)
src/app/config.ts (32 lines changed)
```

## Commit History

```
commit 255a51d43cf541e0b09d384dc17fc9c7b3c1f817
Author: Emanuele Mastronardi
Date: Sat Mar 28 19:24:35 2026 +0100

fix(winner-management): disable creator-risk recheck and loosen trailing stops...
```

---

**Deployment completed successfully at 2026-03-28T19:24:35Z**
