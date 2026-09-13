# pump-amm-sniper
Sniper su token appena creati su Solana. TypeScript/Node, ~14.500 righe, Docker (`sniper` + `report`). **Mai andato live:** solo paper trade (`MONITOR_ONLY=true`), size simulata 0,01 SOL. Ultimi numeri validi: `analysis/2026-04-06-full-analysis.md` — 387 outcome, WR 69,4%, **+0,645 SOL**, prodotti su PumpSwap.

**Modello.** Un supervisore ascolta i `create` via websocket e per ogni token avvia **un worker alla volta**: finche' quel ciclo e' vivo gli altri eventi si perdono, ed e' voluto (`ignorate_occupato` nella riga `SERIALE`). Con un processo solo in vita `RPC_MAX_REQUESTS_PER_SEC` e' un tetto globale vero. Il worker fa 7 passi — parse tx, risoluzione pool/creator, liquidita', sicurezza mint, creator risk, pre-entry, hold — e scrive su `logs/paper-worker-N.log`, **non** sullo stdout del container. `scripts/paper-report-daemon.js` legge quei log e ne ricava `logs/paper-report.json`.

**Confini.** Tutta la conoscenza di un DEX sta dietro `DexAdapter` (`src/services/dex/`): fuori da li' non si nomina mai un campo specifico di un DEX. E' la classe di bug piu' ricorrente del progetto — tre volte in due giorni. Oggi si ascolta **solo `pump`**, ma `pumpSwapAdapter` e' *disponibile*: quando la curva risulta gia' completa il worker passa sulla pool PumpSwap derivata dal mint e prosegue li' (`src/services/dex/pumpMigrato.ts`). `meteoraDammV2Adapter` resta implementato e non registrato.

**Stato di oggi.** `FILTERS_MONITOR_ONLY=true`: i filtri d'ingresso girano, registrano in `bypassedFilters` e **non bloccano**; blocca solo `MIN_POOL_LIQUIDITY_SOL`. Serve a misurare quanto vale ogni filtro sugli esiti veri invece che sulle stime dello shadow. Rimettere a `false` prima di qualunque uso non-paper. `PUMP_MIGRATO_ENABLED=true`: la popolazione che ha prodotto **tutti** i vincitori e' la curva che gradua entro un secondo dalla nascita — misura in `docs/studio-curva-2026-09-13.md`, controlli in `docs/controls.md` 48.

**Comandi.** `./scripts/bot` = cruscotto (sinistra la sessione, destra il token in corso) · `live` log in cascata · `analisi` controfattuale · `shadow` token scartati e seguiti · `reset` riparte da zero (fa il backup datato del report per primo) · `veglia` tiene sveglio il Mac (sudo).

**Documenti** — leggere quello di competenza *prima* di agire:
- **`docs/controls.md`** — ogni controllo, soglia e toggle, con la misura che lo giustifica. Obbligatorio prima di toccare qualunque parametro.
- **`docs/verifica-onchain.md`** — come si verifica un numero contro la realta': gmgn, dexscreener e solscan via **MCP Playwright** (`browser_navigate` + `browser_evaluate` su `innerText`, gli screenshot servono a poco), API dexscreener, lettura diretta degli account. Un numero che non convince si verifica, non si spiega.
- **`docs/studio-curva-2026-09-13.md`** — che fine fanno i 255 token che il bot ha visto nascere, quale secchio contiene i vincitori e cosa li separa all'ingresso. E' la misura che giustifica il passaggio su PumpSwap.
- **`docs/mercato-2026-09-13.md`** — dove nascono davvero i token nuovi: filiera Meteora DBC -> PumpSwap, perche' le curve pump appaiono vuote, cosa cambia fra curva e pool AMM.
- `docs/regole.md` — le tre trappole note, modello di esecuzione, stato del passaggio a live. `docs/architecture.md` — struttura del codice.
- `docs/rpc.md` — endpoint e trappole dei provider. `docs/rpc-audit-2026-09-12.md` — costo RPC per controllo e cosa vale tenere.
- `docs/cc-shadow-tracker.md` — lo shadow tracking. `docs/expansion-sources-2026-09-12.md` — i launchpad valutati e perche'.
- `docs/docker-runbook.md` · `docs/systemd-runbook.md` · `docs/DEPLOYMENT-2026-03-28.md` — esecuzione. `docs/profit-roadmap.md` — priorita'.
- `analysis/README.md` indicizza le analisi; `docs/worklog-2026-03-*.md` sono storici.

**Regole.** Ogni modifica a una soglia aggiorna `docs/controls.md` nello stesso ciclo · dopo ogni modifica a `src/**` fare `npm run build` · nuovi controlli nel servizio di competenza, mai in `pumpAmmSniper.ts` · mai rinominare una chiave di env esistente durante un refactor · le credenziali vivono solo nel `.env`, mai nel repo e mai a schermo · prima di azzerare un report farne la copia datata · per controllare un file JS usare `node --check`, mai `node -e require(...)`: sui daemon lo avvia davvero · documentazione e commit in italiano.
