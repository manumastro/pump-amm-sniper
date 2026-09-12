# Fonti di eventi: cosa ascolta il bot e cosa no

**Data:** 2026-09-12
**Motivo:** capire perche su gmgn.ai si vedono migliaia di nuove creazioni mentre il bot ne processa una frazione.

## Cosa ascolta il bot oggi

Un solo program, in `src/pumpAmmSniper.ts:39`:

```
PUMPFUN_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
```

La subscription e in `src/app/runtime.ts:749` (`subscribeToPoolLogs`): `connection.onLogs(programId, ..., "confirmed")`, e tiene solo i log che contengono `create_pool` / `createpool`. Tutto il resto viene scartato prima di arrivare al worker.

`pAMMBay...` e **PumpSwap, l'AMM di Pump.fun**: le pool nascono quando un token *si diploma* dalla bonding curve. Il bot quindi non vede mai i lanci sulla bonding curve (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`), ne alcun altro launchpad.

## Cosa mostra gmgn

Campione dal feed `https://gmgn.ai/api/v1/pairs/sol/new_pairs/1h` (100 pair, finestra 4.5 minuti, ~1.300 nuove pair/ora su Solana):

| exchange | quota | il bot lo vede? |
|---|---|---|
| `pump` (bonding curve) | 65% | no |
| `pump_amm` (PumpSwap) | **14%** | **si** |
| `ray_launchpad` | 10% | no |
| `meteora_virtual_curve` | 4% | no |
| `meteora_damm_v2` | 3% | no |
| `orca` / `ray_v4` / `fluxbeam` | 4% | no |

Quindi le "tantissime nuove creazioni" sono per **due terzi lanci su bonding curve**, cioe token che non hanno ancora una pool: `initial_liquidity` mediana = 0. Solo 16 pair su 100 partono sopra i 10.000 USD di `MIN_POOL_LIQUIDITY_USD`, e sono quasi tutte `pump_amm` (~17.300 USD, la liquidita tipica di un diploma).

Ordine di grandezza coerente: ~1.300 pair/ora totali, ~185/ora su `pump_amm`; il bot nella sessione di aprile vedeva ~97 eventi/ora (6.959 in 72h), la differenza sta nel dedup delle signature e nelle pool senza lato WSOL.

## Implicazioni per un'espansione

**Il filtro piu selettivo del bot non e un controllo: e la scelta del program.** Ascoltando solo `pAMMBay...` il bot lavora esclusivamente su token gia diplomati, con liquidita reale e una storia on-chain del creator interrogabile. Tutti i 30 controlli creator-risk presuppongono quel contesto.

Le tre direzioni possibili, in ordine di rischio:

1. **Altri AMM post-graduation** (`meteora_damm_v2`, `ray_v4`, `orca`) — ~8% di volume aggiuntivo. E l'estensione piu naturale: stesso profilo di rischio, stessi controlli, cambia solo il modo di leggere lo stato della pool e di calcolare il quote. Richiede un adattatore per pool state / quote per ogni DEX.
2. **Altri launchpad post-graduation** (`ray_launchpad`, `meteora_virtual_curve`) — ~14%. I controlli creator-risk restano validi in linea di principio, ma le soglie sono tarate su Pump.fun e andrebbero ri-validate da zero.
3. **Bonding curve Pump.fun** (`6EF8rrec...`) — il 65% del volume, e la tentazione ovvia. **Profilo di rischio completamente diverso:** nessuna pool, nessuna liquidita, nessuno storico del creator al momento del lancio. E esattamente il contesto in cui i controlli attuali sono ciechi: l'esperimento `cp=1` del 2026-04-02 (creator senza storia tracciabile) ha prodotto 43,6% WR e 20 rug su 39 trade, −0,102 SOL. Da non affrontare senza un modello di rischio nuovo.

**Raccomandazione:** nessuna espansione prima di avere il price path (sezione 19 di `controls.md`) e un replay offline funzionante. Allargare le fonti moltiplica gli eventi, non l'edge; e con 39 rug che gia costano il 37,6% del profitto lordo, il collo di bottiglia oggi e la selezione, non il flusso.

## Accesso ai dati gmgn

Il feed e raggiungibile senza autenticazione e senza blocco Cloudflare (HTTP 200 con un browser reale). Endpoint utili osservati:

- `GET /api/v1/pairs/sol/new_pairs/1h` — lista nuove pair con `exchange`, `launchpad`, `initial_liquidity`, `open_timestamp`, `base_token_info`
- `GET /api/v1/token_info_brief` — metadati token
- `GET /api/v1/dex_trades_polling` — aggregati di volume per DEX

Richiede un browser headless (i parametri `device_id` / `tab_id` / `client_id` sono generati dal client JS): con `curl` non funziona. Lo script di probe usato e in `scripts/` come riferimento.
