---
name: env-ignorato-da-config-ts
description: "34 chiavi del .env restano commentate perché i valori validati (+0,645 SOL) sono quelli di config.ts, non quelli del .env"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5810d719-2c8d-4a2b-b5a7-fe3c34512b37
  modified: 2026-09-12T20:32:55.551Z
---

Fino al 2026-09-12 `src/app/config.ts` definiva quasi tutti i controlli come letterali, quindi 246
delle ~285 chiavi del `.env` venivano caricate nel processo e **ignorate in silenzio**. Ora tutte le
328 chiavi di `CONFIG` accettano un override da env, ma **34 righe del `.env` restano commentate**,
ciascuna con il valore leggibile accanto.

**Why:** quelle 34 avevano un valore diverso da quello realmente attivo, quindi non sono mai state
in esecuzione: sono intenzioni mai validate. I +0,645 SOL di aprile sono stati prodotti dai valori
di `config.ts`, che sono perciò l'unica configurazione con una misura dietro. Accenderle tutte
insieme significherebbe applicare 34 modifiche non validate in un colpo solo — fra cui portare
`CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES` da 3 a 25, cioè allentare di 8× l'unico filtro che lavora
(vedi [[creator-risk-parsed-tx-limit]]).

**How to apply:** riattivarle una alla volta, togliendo il `#` e misurando una sessione. Le prime
due sono già state riattivate il 2026-09-12 (`AUTO_SELL_DELAY_MS` 900s→90s e
`HOLD_WINNER_CHECK_INTERVAL_MS` 200→1000, `docs/controls.md` §37). Attenzione: `pollIntervalMs`
dell'hold è il **minimo** fra tutti gli intervalli dei controlli di prezzo, quindi alzarne uno solo
non produce quasi nessun risparmio.

Elenco completo e misure in `docs/controls.md` sezione 36.
