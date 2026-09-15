# I programmi che si incontrano su una transazione di memecoin

Identificati **empiricamente**, non copiati da un elenco. Prima passata il 2026-09-14 su 83.578
transazioni di 100 portafogli; **rifatti il 2026-09-15 su 90.914 transazioni di 344 portafogli
estratti a caso** (`analysis/2026-09-15-gmgn-sei-ore.md`), che hanno confermato le due
identificazioni forti e corretto due errori. Il metodo: si legge
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
| `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` | Meteora DLMM — **letto per errore come router** nella prima passata |
| `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | Meteora CP-AMM (DAMM v2) — stesso errore |

## Chi lo ordina (il router)

Il router e' il programma che il portafoglio chiama; il DEX lo invoca lui. E' l'attrezzo con cui
la persona lavora, ed e' la cosa che conta per capire **come** opera.

| indirizzo | cos'e' | prova |
|---|---|---|
| `FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9` | **Axiom** | 160 portafogli, **160** etichettati axiom |
| `term9YPb9mzAsABaqN71A4xdbxHmpBNZavpBiQKZzN3` | **Padre** | 46 portafogli, **46** etichettati padre |
| `GMGNreQcJFufBiCTLDBgKhYEfEe9B454UjpDr5CaSLA1` | **gmgn** | 27 portafogli, 27 etichettati gmgn |
| `GMgnVFR8Jb39LoXsEVzb3DvBy3ywCmdmJquHUy1Lrkqb` | **gmgn** (secondo programma) | 19 portafogli, 19 etichettati gmgn |
| `troyXT7Ty3s2rjJe4bqWaroUrS4Fjd8rbHHNHxcACF4` | **Trojan** | 7 portafogli, 7 etichettati trojan |
| `TroYL71c8P2XNtDxHs98VtVLuiASJ7Ao5FvUoKyp3Bk` | **Trojan** (secondo programma) | 4 portafogli, 4 etichettati trojan |
| `DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH` | DFlow (dietro bullx) | 85 portafogli, etichette miste: ci passa sotto |
| `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | Jupiter | noto |
| `b1oomGGqPKGD6errbyfbVMBuzSC8WtAAYo8MwNafWW1` | Bloom (dal prefisso dell'indirizzo, non confermato da etichette) | 9 portafogli |
| `CLEANALo6FtS6quqTTEXDGFFTuSKMkeKGgcweeiPRJzK` | CLEAN | 23 portafogli, etichette miste |

**Correzione del 2026-09-15.** Sul campione piccolo `6Vo3245eszAb…` e `proVF4pMXVaY…`
comparivano con un portafoglio ciascuno e li avevo chiamati "codice privato": sul campione
grande li usano **45 e 76 conti**. Non erano privati, era piccolo il campione. Restano non
identificati `L2TExMFKdjpN9…` (13 conti), `99vQwtBwYtrqq…` (54), `68kTkdQsd9Wh…` (21),
`Dsug6JqUcLJa…` (13), `4DvQwk6W2k…` (3), `AKbotMAGJm…` (3).

**Nessun attrezzo compra un vantaggio.** Misurato sul libro dei 344 portafogli **tolti i token
per cui gmgn li aveva eletti** (altrimenti si misura la selezione, non l'attrezzo): Axiom 149
conti, 6.151 giri, **−797 SOL, −8,6% pesato**; Padre −91 SOL, −5,8%; Jupiter −101, −5,9%; gmgn
−32, −5,4%; DFlow/bullx −14, −13,0%. L'unica riga non negativa e' **andare dritti sul DEX**
(52 conti, +25 SOL, +1,2%).

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

Queste tre guardie scartano 6.222 posizioni su 21.579 (29%) sul campione del 2026-09-14 e 5.297
su 22.927 (23%) su quello del 2026-09-15. L'effetto
della seconda, misurato mentre lo scarico era a 40 portafogli: prima della correzione risultavano
**33 in guadagno e 6 in perdita**, dopo **21 e 21**. Meta' dei vincitori erano token regalati.
