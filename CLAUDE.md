# pump-amm-sniper
Sniper su pump.fun, TypeScript/Node ~14.500 righe. **Mai andato live:** gira solo in paper trade (`MONITOR_ONLY=true`), size simulata 0,01 SOL.
Ultimi numeri validi: `analysis/2026-04-06-full-analysis.md` — 387 outcome, WR 69,4%, **+0,645 SOL**. Tutto cio' che e' stato misurato dopo sta in `docs/controls.md` sezioni 34+.

**Com'e' fatto oggi** (branch `arch/seriale-pump`). Solo la curva `pump`: PumpSwap e' fuori dal registry, per cercare edge su un mercato solo invece che su due a meta'. Un supervisore ascolta i `create` e per ogni token avvia **un worker alla volta** — finche' quel ciclo e' vivo gli altri eventi si perdono, ed e' voluto (`ignorate_occupato` nella riga `SERIALE`). Con un processo solo in vita `RPC_MAX_REQUESTS_PER_SEC` diventa un tetto globale vero, non per-processo. La conoscenza di ogni DEX sta dietro `DexAdapter` (`src/services/dex/`): fuori da li' non si parla il vocabolario di un DEX specifico — e' la classe di bug piu' ricorrente del progetto, gia' comparsa tre volte.

**Cosa misura adesso.** 330-460 valutazioni/ora, ~8.000 richieste RPC/ora, zero 429. Entra sul ~2% delle valutazioni. Gli scarti: `low liquidity` 56%, `creator risk` 19%, `no WSOL side` 17%. Il dominio della bassa liquidita' e' strutturale, non un filtro da tarare: una bonding curve nasce vuota e si riempie, quindi la soglia misura uno stock dove il segnale e' un flusso (vedi `LIQPATH` e `slopeSolPerSec`).

**Comandi.** `./scripts/bot` apre il cruscotto: a sinistra la sessione finora (esiti, operazioni eseguite, RPC, token seguiti in ombra), a destra il token in valutazione adesso tappa per tappa. Poi `live` per i log in cascata — supervisore **e** worker, perche' i worker scrivono su `logs/paper-worker-N.log` e non sullo stdout del container —, `analisi` per il controfattuale, `shadow` per i token scartati e poi seguiti, `veglia` per tenere sveglio il Mac (chiede sudo). Prima di azzerare un report: `cp logs/paper-report.json logs/paper-report-YYYY-MM-DD.json`.

- **`docs/controls.md`** — i controlli del bot. Leggerlo *prima* di toccare qualunque soglia, filtro o toggle.
- `docs/regole.md` — le tre trappole note, modello di esecuzione, architettura, stato del passaggio a live.
- `docs/rpc.md` — endpoint e trappole dei provider. `docs/rpc-audit-2026-09-12.md` — costo RPC per controllo e cosa vale.
- **`docs/verifica-onchain.md`** — un numero che non convince si verifica, non si spiega: gmgn/dexscreener/solscan via MCP Playwright e lettura diretta dell'account.
- `docs/docker-runbook.md` · `docs/architecture.md` · `docs/profit-roadmap.md` · `analysis/`

**Regole.** Ogni modifica a una soglia aggiorna `docs/controls.md` nello stesso ciclo · dopo ogni modifica a `src/**` fare `npm run build` · nuovi controlli nel servizio di competenza, mai in `pumpAmmSniper.ts` · mai rinominare una chiave di env esistente durante un refactor · le credenziali vivono solo nel `.env`, mai nel repo e mai a schermo · documentazione e commit in italiano.
