# Pump AMM Sniper - Checklist Bot Effettivo

## Obiettivo
Passare da `monitor-only/paper-trade` a esecuzione reale in modo robusto e coerente con le skill Helius.

## 1) Transaction submission (obbligatorio)
- Usare **Helius Sender** per ogni submit tx.
- Non usare `sendTransaction/sendRawTransaction` su RPC standard per il path critico.
- Impostare `skipPreflight: true`.
- Includere sempre **Jito tip** (minimo 0.0002 SOL).
- Implementare retry applicativo (con backoff), non affidarsi solo a `maxRetries`.

Riferimento: `.agents/skills/helius/references/sender.md`

## 2) Priority fee e compute budget (obbligatorio)
- Ottenere fee dinamica via `getPriorityFeeEstimate` (mai hardcoded).
- Aggiungere `ComputeBudgetProgram.setComputeUnitPrice`.
- Stimare/simulare CU e impostare `ComputeBudgetProgram.setComputeUnitLimit` con margine.

Riferimento: `.agents/skills/helius/references/priority-fees.md`

## 3) Real-time monitoring resiliente
- Continuare con monitoraggio realtime via WS/LaserStream.
- Mantenere heartbeat/ping e auto-reconnect con exponential backoff.
- Deduplicare signature/eventi e gestire stream stale/resubscribe.

Riferimento: `.agents/skills/helius/references/websockets.md`

## 4) Error handling e regole anti-footgun
- Applicare le regole del core skill (Sender + tip + priority fee sempre).
- Gestire in modo esplicito: timeout RPC, tx non indicizzata, blockhash expired, slippage failure.
- Aggiungere logging strutturato per decisione di skip/entry/exit/retry.

Riferimento: `.agents/skills/helius/SKILL.md`

## 5) (Opzionale) Aggregazione swap con DFlow
- Se si passa ad aggregazione swap: `DFlow /order -> Helius Sender -> conferma`.
- Mantenere monitor fill/confirm e fallback retry su stato ordine.

Riferimento: `.agents/skills/helius-dflow/references/integration-patterns.md`

## Ordine di implementazione consigliato
1. Sender path + retry robusto
2. Priority fee dinamica + CU limit
3. Logging/metriche + alerting
4. Feature flag `TRADING_ENABLED=true` per rollout graduale
5. (Opzionale) integrazione DFlow
