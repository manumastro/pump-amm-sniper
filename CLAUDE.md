# pump-amm-sniper
Sniper pump.fun (curva `pump` + AMM `pumpswap`), TypeScript/Node ~14.500 righe. **Mai andato live:** paper trade (`MONITOR_ONLY=true`), size 0,01 SOL.
Ultimi numeri validi: `analysis/2026-04-06-full-analysis.md` — 387 outcome, WR 69,4%, **+0,645 SOL**.
- **`docs/controls.md`** — i controlli del bot. Leggerlo *prima* di toccare qualunque soglia, filtro o toggle.
- `docs/regole.md` — le tre trappole note, modello di esecuzione, architettura, stato del passaggio a live.
- `docs/rpc.md` — endpoint e trappole dei provider. `docs/rpc-audit-2026-09-12.md` — costo RPC per controllo e cosa vale.
- **`docs/verifica-onchain.md`** — un numero che non convince si verifica, non si spiega: gmgn/dexscreener/solscan via MCP Playwright e lettura diretta dell'account.
- `docs/docker-runbook.md` · `docs/architecture.md` · `docs/profit-roadmap.md` · `analysis/`
**Regole:** ogni modifica a una soglia aggiorna `docs/controls.md` nello stesso ciclo · dopo ogni modifica a `src/**` fare `npm run build` · nuovi controlli nel servizio di competenza, mai in `pumpAmmSniper.ts` · documentazione e commit in italiano.
