# Architecture

## Current Direction

Il bot sta migrando da un unico file orchestratore a una struttura a servizi.

Obiettivo:
- `src/pumpAmmSniper.ts` come entrypoint / orchestratore sottile
- logica dei controlli in servizi dedicati
- helper RPC, logging e filesystem separati

## Target Ownership

- `src/app/`: bootstrap, config, runtime, worker lifecycle
- `src/domain/`: tipi condivisi del dominio bot
- `src/services/creator-risk/`: tutti i controlli creator, funder, relay, re-entry, burst, cashout
- `src/services/paper-trade/`: pre-buy validation, hold monitor, quote/exit simulation
- `src/services/liquidity/`: lettura liquidity, recheck, cooldown
- `src/services/token-security/`: mint/freeze checks
- `src/services/top10/`: holder concentration checks
- `src/services/dev-holdings/`: holdings creator/dev
- `src/services/dex/`: adapter per DEX (lettura pool, orientamento, liquidita, quote entry/exit)
- `src/services/reporting/`: stage log e logging operativo
- `src/infra/solana/`: RPC, parsed tx, pool state helpers
- `src/infra/storage/`: file-backed state e cache locali
- `src/utils/`: formatter e helper puri

## Rules

- Nuovi controlli non vanno aggiunti direttamente in `src/pumpAmmSniper.ts`.
- Se un controllo riguarda `creator`, `funder`, `relay` o pattern di wallet, va sotto `src/services/creator-risk/`.
- Se un controllo riguarda pre-buy, hold o exit simulato/live, va sotto `src/services/paper-trade/`.
- Gli accessi RPC condivisi non vanno duplicati nei servizi: devono convergere in helper riusabili.
- I nomi delle env esistenti non vanno cambiati durante il refactor.

## Transitional Note

Finché il refactor non è completato:
- `src/pumpAmmSniper.ts` resta l’entrypoint usato da systemd
- l’estrazione in moduli deve preservare comportamento e log operativi
- il motore `creator-risk` ora vive in `src/services/creator-risk/index.ts`, mentre parte degli helper RPC/storici è ancora transitoria in `src/pumpAmmSniper.ts`
- `paper-trade`, `liquidity`, `token-security`, `top10` e `dev-holdings` hanno ora servizi dedicati; l’orchestratore conserva ancora alcuni helper runtime e subscription flow
- `bootstrap`, `supervisor runtime` e `worker task` vivono ora in `src/app/bootstrap.ts`, `src/app/runtime.ts` e `src/app/worker.ts`

## DEX Layer

`src/services/dex/` isola la conoscenza del singolo DEX dietro l'interfaccia `DexAdapter`
(`types.ts`). Il resto del bot ragiona solo in termini di:

- quanti SOL ci sono nel pool (`getSolLiquidity`)
- quanti token ottengo con N lamport (`getEntryTokenOut`)
- quanti SOL ricavo vendendo la posizione (`getExitQuoteSol`)
- orientamento e presenza del lato WSOL (`getOrientation`)

`pumpswap.ts` e la prima implementazione e incapsula l'SDK `@pump-fun/pump-swap-sdk`.
`index.ts` e il registro programId -> adapter.

`src/services/paper-trade/quote.ts` e rimasto come facciata: instrada sull'adapter di default,
cosi i call site esistenti non cambiano.

**Stato:** l'interpretazione dello stato pool e completamente dietro l'adapter (zero accessi a
`poolBaseAmount`, `coinCreator`, `feeConfig` fuori da `dex/`, escluso il path di trading live).
Restano da instradare le ~9 `swapSolanaState()` di **fetch**: richiedono che l'evento porti con
se il program di provenienza attraverso il dispatch al worker. E il prossimo incremento.

**Il path di trading live** (`executeBuy`/`executeSell`) resta legato all'SDK Pump di proposito:
costruire le istruzioni di swap e specifico per DEX ed e una preoccupazione separata dal quoting
in paper. Vedi `PRODUCTION_BOT_CHECKLIST.md`.

### Aggiungere un DEX

1. implementare `DexAdapter` in `src/services/dex/<nome>.ts`
2. aggiungerlo all'array `ADAPTERS` in `src/services/dex/index.ts`
3. completare la propagazione del program per evento (subscription + dispatch worker)

Quali DEX valga la pena aggiungere, con i numeri: `docs/expansion-sources-2026-09-12.md`.
