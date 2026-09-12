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

Campione dal feed `https://gmgn.ai/api/v1/pairs/sol/new_pairs/` (300 pair in 12,2 minuti,
~1.470 nuove pair/ora su Solana). La colonna che conta non e il numero di pair, ma **quante
superano `MIN_POOL_LIQUIDITY_USD = 10.000`**, cioe quante il bot prenderebbe davvero in
considerazione:

| exchange | pair | % | liquidita iniziale mediana | sopra 10k USD | il bot lo vede? |
|---|---|---|---|---|---|
| `pump` (bonding curve) | 207 | 69,0% | 0 | **0** | no |
| `ray_launchpad` | 31 | 10,3% | 3.624 | **0** | no |
| `pump_amm` (PumpSwap) | 25 | 8,3% | 17.333 | **20** | **si** |
| `meteora_virtual_curve` | 21 | 7,0% | 1.675 | **0** | no |
| `meteora_damm_v2` | 10 | 3,3% | 41 | **4** | no |
| `ray_v4` | 4 | 1,3% | 17.369 | **4** | no |
| `fluxbeam` | 1 | 0,3% | 2.038 | 0 | no |
| `orca` | 1 | 0,3% | 0 | 0 | no |

Due letture importanti.

**Il grosso del volume e gia escluso dalla soglia di liquidita, non dalla scelta del program.**
`pump`, `ray_launchpad` e `meteora_virtual_curve` sono 259 pair su 300 (86%) e **nessuna** parte
sopra i 10.000 USD: sono bonding curve o equivalenti, token senza pool vera. Ascoltarli non
aggiungerebbe un solo trade, verrebbero scartati al primo controllo.

**Le uniche fonti che producono pool qualificate sono tre**, e il bot ne ascolta una:
`pump_amm` (20 su 300), `ray_v4` (4) e `meteora_damm_v2` (4).

Verifica incrociata: 20 pool qualificate su 300 pair in 12,2 minuti = **~98 all'ora**. Il bot nella
sessione di aprile ne vedeva **97 all'ora** (6.959 eventi in 72h). I conti tornano: il bot sta gia
catturando praticamente tutto il suo bacino.

**Quanto si guadagna espandendo:** aggiungere `ray_v4` e `meteora_damm_v2` porta da 20 a 28 pool
qualificate ogni 300 pair, cioe da ~98 a ~137 eventi/ora: **+40% di flusso**, a parita di profilo
(liquidita iniziale mediana di `ray_v4` 17.369 USD, praticamente identica a PumpSwap).

## Implicazioni per un'espansione

**Il filtro piu selettivo del bot non e un controllo: e la scelta del program.** Ascoltando solo `pAMMBay...` il bot lavora esclusivamente su token gia diplomati, con liquidita reale e una storia on-chain del creator interrogabile. Tutti i 30 controlli creator-risk presuppongono quel contesto.

Le direzioni possibili, riordinate alla luce dei dati sopra:

1. **`ray_v4` + `meteora_damm_v2`** — le uniche due fonti, oltre a PumpSwap, che producono pool sopra
   la soglia di liquidita. **+40% di flusso** a parita di profilo di rischio: sono AMM
   post-graduation, i token hanno liquidita reale e il creator ha una storia on-chain interrogabile,
   quindi i 30 controlli creator-risk restano validi cosi come sono.
2. **`ray_launchpad` + `meteora_virtual_curve`** — 52 pair su 300, ma **zero** sopra i 10.000 USD:
   aggiungerebbero eventi che vengono scartati al primo controllo. Non vale il lavoro.
3. **Bonding curve Pump.fun** (`6EF8rrec...`) — il 69% del volume, la tentazione ovvia.
   **Profilo di rischio completamente diverso:** nessuna pool, nessuna liquidita, nessuno storico del
   creator al lancio. E esattamente il contesto in cui i controlli attuali sono ciechi: l'esperimento
   `cp=1` del 2026-04-02 (creator senza storia tracciabile) ha prodotto 43,6% WR e 20 rug su 39
   trade, −0,102 SOL. Serve un modello di rischio nuovo, non un'estensione di questo.

## Cosa serve tecnicamente per il punto 1

Il lavoro non e nella subscription — quella e una riga — ma nel **layer di lettura della pool**, oggi
interamente legato all'SDK di Pump:

| Giuntura | File | Cosa fa oggi |
|---|---|---|
| Subscription | `src/app/runtime.ts:749` | un solo `onLogs(programId)`, filtra i log `create_pool` |
| Stato pool | `src/pumpAmmSniper.ts`, ~10 call site | `onlineSdk.swapSolanaState(poolKey, user)` |
| Quote e liquidita | `src/services/paper-trade/quote.ts` | `buyQuoteInput`/`sellBaseInput` dell'SDK Pump, piu accesso diretto a `state.poolBaseAmount`, `state.pool.coinCreator`, `state.feeConfig`, `state.globalConfig` |

Serve un'interfaccia adapter con cinque metodi — `fetchPoolState`, `getOrientation`,
`getSolLiquidity`, `getSpotPrice`, `getExitQuote` — di cui l'implementazione attuale diventa il primo
adapter (`pumpswap`), piu un adapter per DEX nuovo. La subscription diventa una lista di program, e
ogni evento porta con se quale adapter usare.

**Prerequisito non negoziabile:** il refactor tocca il percorso caldo di un file da 3.538 righe
**senza un singolo test in tutto il repo**. Va fatto quando c'e una sessione paper funzionante con cui
verificare che il comportamento su PumpSwap resti identico prima e dopo, non alla cieca.

## Accesso ai dati gmgn

Il feed e raggiungibile senza autenticazione e senza blocco Cloudflare (HTTP 200 con un browser reale). Endpoint utili osservati:

- `GET /api/v1/pairs/sol/new_pairs/1h` — lista nuove pair con `exchange`, `launchpad`, `initial_liquidity`, `open_timestamp`, `base_token_info`
- `GET /api/v1/token_info_brief` — metadati token
- `GET /api/v1/dex_trades_polling` — aggregati di volume per DEX

Richiede un browser headless (i parametri `device_id` / `tab_id` / `client_id` sono generati dal client JS): con `curl` non funziona. Lo script di probe usato e in `scripts/` come riferimento.
