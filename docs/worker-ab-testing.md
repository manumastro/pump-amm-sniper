# Worker A/B/C Testing Setup

## Overview

This document describes the multi-worker configuration system for testing different filter settings.

## Architecture

- **Worker 1 (Baseline)**: Uses default settings
- **Worker 2 (High Threshold)**: `unique_counterparties` threshold increased to 50
- **Worker 3 (Burner Bypass)**: `burner-profile` bypass enabled for high liquidity pools

## Synchronized Dispatch

For fair A/B/C comparison, all 3 workers process the **same pool at the same time**:

1. Pool arrives → waits for ALL workers to be idle
2. When all idle → dispatches same pool to all 3 workers simultaneously
3. Each worker applies its own filter config
4. Results are linked by `poolSignature` for direct comparison

```
DISPATCH | all 3 workers idle, dispatching to all
DISPATCH | worker-1 4b6F2s...cFLmXF
DISPATCH | worker-2 4b6F2s...cFLmXF  
DISPATCH | worker-3 4b6F2s...cFLmXF
```

This ensures identical timing conditions across workers for accurate comparison.

## Configuration

Each worker's config is overridden via environment variables with the prefix `WORKER_{N}_`.

### Environment Variables

| Variable | Description | Worker 1 | Worker 2 | Worker 3 |
|----------|-------------|----------|----------|-----------|
| `WORKER_2_CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES` | Max counterparties before block | 25 | **50** | 25 |
| `WORKER_3_CREATOR_RISK_BURNER_LIQUIDITY_BYPASS_ENABLED` | Enable burner bypass | false | false | **true** |
| `WORKER_3_CREATOR_RISK_BURNER_LIQUIDITY_BYPASS_MIN_SOL` | Min liquidity for bypass | - | - | **50000** |

## Running the Bot

### Single Worker (Default)
```bash
npm run build
systemctl --user restart pump-sniper
```

### 3 Worker A/B/C Testing

The system uses `MAX_CONCURRENT_OPERATIONS=3` for 3 workers.

```bash
# Set environment variables before starting
export WORKER_2_CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES=50
export WORKER_3_CREATOR_RISK_BURNER_LIQUIDITY_BYPASS_ENABLED=true
export WORKER_3_CREATOR_RISK_BURNER_LIQUIDITY_BYPASS_MIN_SOL=50000

npm run build
systemctl --user restart pump-sniper
```

## Monitoring

Each worker writes to a separate log file:
- `logs/paper-worker-1.log` - Worker 1 (baseline)
- `logs/paper-worker-2.log` - Worker 2 (unique_counterparties=50)
- `logs/paper-worker-3.log` - Worker 3 (burner bypass)

## Per-Worker Reports

The paper-report-daemon generates separate reports for each worker:

- `logs/paper-report.json` - Aggregated report (all workers)
- `logs/paper-worker-1-report.json` - Worker 1 specific report
- `logs/paper-worker-2-report.json` - Worker 2 specific report
- `logs/paper-worker-3-report.json` - Worker 3 specific report

Each worker report contains:
- Worker slot number
- Events seen/finished by that worker
- Checks passed/skipped
- Hostile skips and rug losses specific to that worker
- PnL stats (total, average, wins/losses, win rate)
- All operations performed by that worker

## Report Analysis

```bash
# Check Worker 1 logs
grep "CRISK" logs/paper-worker-1.log | tail -20

# Check Worker 2 unique counterparty bypasses
grep "unique counterparties" logs/paper-worker-2.log | tail -20

# Check Worker 3 burner bypasses
grep "burner profile bypass" logs/paper-worker-3.log | tail -20

# Compare worker reports
cat logs/paper-worker-1-report.json
cat logs/paper-worker-2-report.json
cat logs/paper-worker-3-report.json
```

## Expected Results

| Worker | Setting | Expected Effect |
|--------|---------|----------------|
| Worker 1 | Baseline | Current behavior, 25 counterparties max |
| Worker 2 | 50 counterparties | More trades allowed, potential for more wins but also more rugs |
| Worker 3 | Burner bypass | Burner profiles with high liquidity (>~50k SOL) will pass |

## Analysis Script

Run the skipped tokens analysis to compare workers:

```bash
python3 scripts/analyze_skipped_tokens.py
```

This will show liquidity of skipped tokens by category, helping identify which filters are too strict.

## Implementation Details

The config override system is in `src/app/config.ts`:

```typescript
export function getWorkerConfig(workerSlot: number): typeof CONFIG {
    if (workerSlot <= 1) {
        return CONFIG;
    }
    const overrides = getWorkerConfigOverrides(workerSlot);
    return { ...CONFIG, ...overrides };
}

function getWorkerConfigOverrides(workerSlot: number): Partial<typeof CONFIG> {
    const overrides: Partial<typeof CONFIG> = {};
    const prefix = `WORKER_${workerSlot}_`;
    
    for (const key of Object.keys(CONFIG) as ConfigKey[]) {
        const envKey = prefix + key;
        const envValue = process.env[envKey];
        if (envValue !== undefined) {
            // Apply override
        }
    }
    return overrides;
}
```

Services use `getWorkerConfigKey('CONFIG_KEY')` to get worker-specific config values.
