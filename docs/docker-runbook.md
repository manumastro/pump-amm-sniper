# Deploy con Docker

Sostituisce `docs/systemd-runbook.md`, che descrive una macchina (`/home/manu`, systemd --user)
che non esiste piu.

## Perche due container

Il bot e un **processo supervisore** che fa spawn di processi figli, uno per pool da analizzare
(`src/app/runtime.ts:369`, `MAX_CONCURRENT_OPERATIONS=2` slot). I worker scrivono
`logs/paper-worker-N.log`; un secondo processo, il report daemon, li segue in coda e produce
`logs/paper-report.json`. Sono due cicli di vita indipendenti, quindi due servizi.

`init: true` in compose serve proprio per i figli: senza un init i worker orfani restano zombie.

## Avvio

```bash
cp .env.example .env        # riempire SVS_UNSTAKED_RPC e SVS_UNSTAKED_WS
docker compose up -d --build
docker compose logs -f sniper
```

## Comandi operativi

```bash
docker compose ps                       # stato
docker compose logs -f sniper           # log supervisore
docker compose logs -f report           # log daemon
docker compose restart sniper           # restart
docker compose down                     # stop
docker compose up -d --build            # rebuild dopo modifiche a src/
```

Il `npm run build` avviene **dentro l'immagine** (stage `build` del Dockerfile), quindi
`docker compose up -d --build` copre da solo la regola "dopo ogni modifica a src/ serve un build".

## Stato persistente

Due bind mount, entrambi necessari:

| Path | Perche |
|---|---|
| `./blacklists` | il **dynamic funder rug tracking riscrive questi file a runtime** (`funder-counts.json`, `creators.txt`). Se non persiste, a ogni restart il bot dimentica i funder che hanno ruggato. |
| `./logs` | i worker log che il report daemon deve leggere, e il report stesso. `paper.log` e un symlink a `logs/paper.log` dentro l'immagine. |

## Restart policy

`restart: unless-stopped` sostituisce `Restart=always` di systemd.

Il circuit breaker in `startLogHealthcheck()` fa `process.exit(1)` dopo 5 resubscribe consecutivi
senza log ricevuti: Docker riavvia il container. E la protezione contro la WebSocket death spiral del
2026-03-29 (444 resubscribe in 10 ore, chiave Helius bruciata, supervisore vivo ma zombie).

## Reset di una sessione

```bash
docker compose stop
cp logs/paper-report.json logs/paper-report-$(date +%F).json   # BACKUP PRIMA, sempre
rm -f logs/paper-report.json logs/paper-report.txt logs/paper-report-daemon.log \
      logs/paper-worker-*.log logs/paper.log
docker compose up -d
```

## Note

- L'immagine e `node:22-bookworm-slim`, multi-stage: le devDependencies restano nello stage di build.
- `bigint: Failed to load bindings, pure JS will be used` all'avvio e atteso e innocuo.
- Il container gira come utente `node`? No: gira come root. Se il deploy e su una macchina condivisa,
  aggiungere `user: node` in compose e sistemare i permessi dei bind mount.
- Per una VPS: `docker compose up -d` e sufficiente, non serve altro orchestratore.


## Endpoint RPC: HTTP e WebSocket vanno separati

`.env` ha due variabili invece di una:

```bash
SVS_UNSTAKED_RPC=https://solana-rpc.publicnode.com                  # letture HTTP
SVS_UNSTAKED_WS=wss://solana-mainnet.core.chainstack.com/<node-id>  # subscription
```

Omettere `SVS_UNSTAKED_WS` e lecito: il WebSocket viene derivato da `SVS_UNSTAKED_RPC`, che e il
comportamento precedente.

**Ma per questa configurazione servono entrambe.** Il bot ascolta tre program e publicnode, pur
reggendo 71 req/s in HTTP, **accetta la subscription su Meteora DAMM v2 e non consegna mai niente**:
0 eventi in 45s, contro 6.026 su `api.mainnet-beta.solana.com` nella stessa finestra e con pumpswap
e ray_v4 che arrivavano normalmente sulla stessa connessione. Non produce errori: quel DEX
sparirebbe in silenzio. Al contrario mainnet-beta consegna tutto ma regge ~1,1 req/s in HTTP, che
non basta nemmeno ai poll di hold.

Il verso opposto vale per Chainstack: il suo WebSocket consegna tutti e tre i program, col primo
log in ~500ms, ma il piano free **blocca i metodi archive** (`getSignaturesForAddress`,
`getParsedTransaction`, `403 -32002`). Le letture di account passano, quindi i poll di hold
girerebbero e il problema non si vedrebbe subito — ma i 30 controlli creator-risk sono costruiti
sulla storia delle transazioni e non funzionerebbero affatto.

Da qui la divisione: Chainstack per il WebSocket, publicnode per le letture. `api.mainnet-beta.solana.com`
resta un ripiego valido per il WS se il nodo Chainstack non e disponibile.

Prima di cambiare provider, verificare **entrambi**:

```bash
SVS_UNSTAKED_RPC="https://..." SVS_UNSTAKED_WS="wss://..." node scripts/rpc-smoke-test.js
```

La fase 2 sottoscrive tutti i program registrati e segnala quelli che restano a zero log.

## Verificare gli adapter DEX prima di una sessione

```bash
node scripts/dex-adapter-live-check.js 240            # tutti gli adapter
node scripts/dex-adapter-live-check.js 900 ray_v4     # uno solo, per i DEX a bassa frequenza
```

Per ogni pool creata sulla rete esegue il percorso completo che userebbe il bot e stampa mint,
orientamento, liquidita e un round trip di 0,01 SOL. **Lo scarto del round trip deve essere circa il
doppio della fee di swap.** Un pool quasi vuoto dara scarti enormi (−80%, −99%) ed e corretto che sia
cosi: e il price impact reale, ed e la ragione per cui la soglia di liquidita esiste.
