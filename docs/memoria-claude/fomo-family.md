---
name: fomo-family
description: "fomo.family — come rientrare: pipeline scripts/fomo, dati in dati/fomo, chiavi in .env.fomo, documento di studio su Claude Docs"
metadata:
  node_type: memory
  type: reference
  originSessionId: aaec7737-03b5-47cc-aed9-8e1cbfc18d41
  modified: 2026-10-04T07:20:26.667Z
---

Dal 2026-10-04 il branch `analisi/fomo` contiene solo gli studi (lo sniper e' su `main`). Pipeline permanente in `scripts/fomo/` (giro quotidiano nel suo README: prepara_scarico → browser → importa → wallet → prezzi → saldi → classifiche; storia.js in background), dati in `dati/fomo/` fuori da git (~1,5 GB, 1.966 utenti, wallet e storie on-chain).

Chiavi: la persona vuole che le chiavi siano usate **solo dagli studi**. Stanno in `.env.fomo` (`FOMO_ALCHEMY_KEY`, `FOMO_HELIUS_KEY`, Helius gratuito creato il 2026-10-04), mai nel `.env` dello sniper ne' sotto nomi `SVS_*` (lo sniper legge `SVS_INDEX_RPC`). Il `.env` contiene anche la `PRIVATE_KEY` dello sniper: non toccarla.

Login fomo: lo fa la persona nel browser Playwright; l'header si cattura dentro la pagina e non si stampa mai. Alchemy gratuito: il limite che morde e' 300 CU/s per tutte le reti (non i 30M CU al mese): un solo script Alchemy alla volta. In zsh una lista di id in una variabile non si divide in argomenti: usare `storia.js tutte classifica`.

Documento di studio per la persona, a schede (Claude Docs "Studio fomo.family"): https://claude.ai/artifact/LdmzFNS3nqzfyiXqjWqx8G — va aggiornato quando cambiano i risultati; la persona lo vuole corto.

Lo stash `stash@{0}` su analisi/fomo contiene le modifiche non committate a log e blacklist dello sniper (da riapplicare su main se servono).

Vedi anche [[daemon-avviato-a-mano]].
