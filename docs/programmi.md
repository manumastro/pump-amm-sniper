# I programmi che si incontrano su una transazione di memecoin

Identificati **empiricamente** il 2026-09-14 su 83.578 transazioni di 100 portafogli attivi
(`analysis/2026-09-14-gmgn-100-token-nuovi.md`), non copiati da un elenco. Il metodo: si legge
quale programma viene invocato al primo livello (`Program <id> invoke [1]` nel log) e lo si
incrocia con l'etichetta che gmgn attribuisce al portafoglio. Quando **tutti** i portafogli che
usano un programma portano la stessa etichetta, l'identificazione e' certa.

## Dove avviene lo scambio (il DEX)

| indirizzo | cos'e' |
|---|---|
| `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | pump.fun, la curva |
| `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | PumpSwap (dove finiscono le curve pump graduate) |
| `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` | Raydium LaunchLab — **anche stonk.fun**, che ne e' solo una delle piattaforme |
| `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` | Raydium v4 |
| `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | Raydium CPMM |
| `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | Raydium CLMM |
| `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | Orca Whirlpool |
| `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | Meteora DBC (virtual curve) |

## Chi lo ordina (il router)

Il router e' il programma che il portafoglio chiama; il DEX lo invoca lui. E' l'attrezzo con cui
la persona lavora, ed e' la cosa che conta per capire **come** opera.

| indirizzo | cos'e' | prova |
|---|---|---|
| `FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9` | **Axiom** | 32 portafogli, 32 etichettati axiom |
| `term9YPb9mzAsABaqN71A4xdbxHmpBNZavpBiQKZzN3` | **Padre** | 8 portafogli, 8 etichettati padre |
| `GMGNreQcJFufBiCTLDBgKhYEfEe9B4`, `GMgnVFR8Jb…` | gmgn | etichetta gmgn |
| `DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH` | DFlow (dietro bullx) | etichetta bullx |
| `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | Jupiter | noto |

Otto altri programmi compaiono con **un solo portafoglio ciascuno** (`DDDDUigGhUBq…`,
`GsaJ3CwKWKHF…`, `6Vo3245eszAb…`, `5kSXmrbPRw…`, `4ATjTXLe6o…`, `AKbotMAGJm…`, `AURAsuSzLv…`,
`proVF4pMXVaY…`): codice scritto da chi lo usa. **Sono quelli che guadagnano in modo consistente**
— i terminali a pagamento non danno vantaggio (Axiom −78 SOL sui giri chiusi, Padre −107, diretto
sul DEX +48, router privati +200 circa).

## Rumore di fondo, da ignorare

`ComputeBudget111…`, `11111111…` (System), `TokenkegQfeZ…` e `TokenzQdBNbLqP5…` (SPL Token e
Token-2022), `ATokenGPvbdGVxr…` (Associated Token Account), `AddressLookupTab1e1…`, `MemoSq4gqABAXKb…`.

## Come leggere una transazione senza sapere nulla del DEX

Serve a misurare portafogli che lavorano su piattaforme diverse, senza scrivere un decoder per
ognuna. Vedi `scratchpad/portafogli.js`:

- **quanto SOL e' entrato o uscito davvero**: `postBalances[i] − preBalances[i]` con `i` l'indice
  del portafoglio (che e' 0 quando firma), piu' la differenza del suo conto WSOL se ne tiene uno
  aperto. Comprende commissioni, priority fee e rent: e' il profitto vero.
- **quale token e quanto**: differenza fra `preTokenBalances` e `postTokenBalances` filtrati per
  `owner`. WSOL, USDC e USDT non sono token: sono quote.
- **su quale programma**: le righe `Program <id> invoke [1]` del log, in ordine. La prima e' il
  router, le successive i DEX che lui chiama.

**Tre guardie obbligatorie**, imparate a caro prezzo:

1. chi risulta con base molto **negativa** ha venduto token che in quella finestra non aveva
   comprato: il suo rendimento e' inventato;
2. un token **arrivato per trasferimento** (nessun SOL uscito in quella transazione) non e' un
   token comprato: contarlo come acquisto a costo zero fa sembrare infinito il rendimento della
   rivendita (0,0017 SOL "messi" e 7,50 "presi");
3. una compra dentro una transazione che tocca **piu' token** non e' attribuibile: il SOL speso
   non si puo' dividere fra i token senza sapere i prezzi, e la posizione va scartata.

Sul campione del 2026-09-14 queste tre guardie scartano 6.222 posizioni su 21.579 (29%). L'effetto
della seconda, misurato mentre lo scarico era a 40 portafogli: prima della correzione risultavano
**33 in guadagno e 6 in perdita**, dopo **21 e 21**. Meta' dei vincitori erano token regalati.
