---
name: creator-risk-parsed-tx-limit
description: CREATOR_RISK_PARSED_TX_LIMIT resta a 50 — abbassarlo non è un risparmio RPC ma un allentamento del filtro che blocca di più
metadata: 
  node_type: memory
  type: project
  originSessionId: 5810d719-2c8d-4a2b-b5a7-fe3c34512b37
  modified: 2026-09-12T20:32:44.138Z
---

`CREATOR_RISK_PARSED_TX_LIMIT` (50) è la voce di spesa RPC più grossa dopo l'hold: il 27,7% delle
chiamate, ~30 `getParsedTransaction` per valutazione. Deciso il 2026-09-12 di **lasciarlo a 50**
durante l'audit RPC, pur essendo il candidato ovvio al taglio.

**Why:** abbassarlo non è un'ottimizzazione, è un allentamento. Le transazioni lette alimentano il
conteggio delle unique counterparties, confrontato con `CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES=3`.
Meno transazioni → meno counterparties contate → più creator sotto soglia → **meno blocchi**. È la
stessa direzione dell'esperimento `cp=1` del 2026-04-01, che su 39 trade fece 43,6% WR e −0,102 SOL.
Il filtro unique-counterparties è anche l'unico che lavora davvero: 136 dei 172 blocchi (79%) su
1.482 valutazioni, mentre 26 delle 30 regole creator-risk non hanno bloccato nulla.

**How to apply:** se si torna sul tema, la mossa corretta non è abbassare il limite ma **uscire
prima dal parsing** appena le counterparties hanno già superato la soglia — il conteggio è monotono,
quindi la decisione di blocco è già certa e le transazioni restanti sono sprecate. È a costo zero
sul comportamento, ma vale solo sul ~9% delle valutazioni che bloccano, quindi ha senso solo dopo
che il risparmio sull'hold è rientrato. Richiede di leggere `src/services/creator-risk/index.ts`
intorno a `fetchParsedTransactionsForSignatures` (batch unico da spezzare in chunk, attenzione
all'ordine cronologico che serve a identificare il funder).

Contesto in `docs/rpc-audit-2026-09-12.md` e `docs/controls.md` sezioni 34-37.
Vedi anche [[env-ignorato-da-config-ts]].
