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
cp .env.example .env        # riempire almeno SVS_UNSTAKED_RPC
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
