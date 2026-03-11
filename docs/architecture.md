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
