# Last Rug Pulls Status

Classificazione:

- `gia_mitigato`
  Il caso appartiene al cluster `hold exit troppo lento sul collasso del pool`. Il controllo `sell quote collapse exit` dovrebbe intercettarlo direttamente.
- `parzialmente_mitigato`
  Il fix nuovo aiuta, ma il caso non dipende solo dal collasso della sell quote oppure i log non ricostruiscono bene il trigger.
- `ancora_aperto`
  Il problema principale non era il hold exit lento. Serve un fix diverso, soprattutto lato pre-buy o creator-risk.

Divisione attuale:

- `gia_mitigato`
  `evt-000358`, `evt-000362`, `evt-000615`, `evt-001300`, `evt-001325`, `evt-001368`
- `parzialmente_mitigato`
  `evt-000562`, `evt-000896`, `evt-000917`
- `ancora_aperto`
  `evt-000476`

Nota:

`evt-000476` resta aperto perché il problema dominante era `creator-risk troppo permissivo pre-buy`, non il collasso della sell quote durante hold.
