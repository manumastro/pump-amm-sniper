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
| `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` | Raydium LaunchLab — **anche stonk.fun e letsbonk**, che ne sono piattaforme (`PlatformConfig.name`) |
| `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` | Raydium v4 |
| `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | Raydium CPMM |
| `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | Raydium CLMM |
| `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | Orca Whirlpool |
| `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | Meteora DBC (virtual curve) — **anche BAGS, Jupiter Studio** e decine di config di altri siti |
| `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` | Meteora DLMM — **letto per errore come router** nella prima passata |
| `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | Meteora CP-AMM (DAMM v2) — stesso errore |

### Le curve di bonding e le loro piattaforme (`scripts/fomo/curve.js`, verificato il 2026-10-04)

| indirizzo | cos'e' |
|---|---|
| `MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG` | Moonit (ex Moonshot), curva `['token', mint]`; stesse riserve virtuali di pump.fun (1.073M token, 30 SOL) |
| `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf` | pump.fun Global: riserve iniziali (1.073M / 30 SOL / 793,1M reali) |
| `FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1` | LaunchLab PlatformConfig "letsbonk.fun" |
| `6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt`, `CUqSiwPs6C4WyntMgaFazLp7wYQfaLp5URbjUP9V7SNi`, `4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7` | LaunchLab PlatformConfig "StonkFun" (quote: ONDO e azioni tokenizzate, non SOL) |
| `4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4` | LaunchLab PlatformConfig "Raydium" |
| `Guw2pGYsgodSqe5kJ8btj5YHTo8SDXUdsWaaW3N1TtzG`, `5XGPr4pA7KxT6Xk3ruwYv6DcMHXDfzyox8CHaUXr9vD5`, `Br99jXhVzdnZokafc5aVhXW5C7ZkxENpdL4oehvpP6Pf` | LaunchLab "xstok 1pct", "payper", "Dare Market" |
| `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE` | Orca Whirlpool SOL/USDC: prezzo del SOL da `sqrt_price` (un conto, nessuna transazione) |

**BAGS e Jupiter Studio non hanno un programma proprio: sono config di Meteora DBC.** fomo li etichetta dal
suffisso del mint (`...BAGS`, `...jups`), non dalla config: le stesse config DBC ospitano mint `...pump`,
`...bonk`, `...jups`, `...BAGS`. Il nome del sito di una config DBC starebbe nel `PartnerMetadata`
(`['partner_metadata', fee_claimer]`), ma nessuna delle 85 config viste lo ha. DBC ha conti piu' nuovi del suo
IDL sulla catena (v0.1.10): pool e config "con transfer hook" hanno un altro discriminatore
(`eddbb8172abda923`, `28dcc2fb29c77bfd`) e la stessa disposizione. Dettagli e tabelle in `dati/fomo/curve/curve.md`.

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

**Identificati il 2026-10-03** dalle etichette di solscan, guardando le transazioni di fomo:
`proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u` e' **OKX: DEX Router**, `99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2`
e' **Relay: Depository** (il ponte verso le altre catene: l'USDC parte da Solana e il token
arriva su Robinhood Chain, BSC, Base o Ethereum).

**Nessun attrezzo compra un vantaggio.** Misurato sul libro dei 344 portafogli **tolti i token
per cui gmgn li aveva eletti** (altrimenti si misura la selezione, non l'attrezzo): Axiom 149
conti, 6.151 giri, **−797 SOL, −8,6% pesato**; Padre −91 SOL, −5,8%; Jupiter −101, −5,9%; gmgn
−32, −5,4%; DFlow/bullx −14, −13,0%. L'unica riga non negativa e' **andare dritti sul DEX**
(52 conti, +25 SOL, +1,2%).

## Chi firma (le app custodiali e gasless)

Alcune app non hanno un programma proprio: passano da un aggregatore (DFlow, Jupiter, OKX) e si
riconoscono da **chi paga la transazione**.

| indirizzo | cos'e' | prova |
|---|---|---|
| `AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51` | **fomo** ("Fomo Co-signer" su solscan) | 162 wallet di utenti fomo su 165 agganciati; co-firma col wallet dell'utente e paga il gas; ~526 tx/min il 2026-10-03 |
| `R4rNJHaffSUotNmqSKNEfDcJE8A7zJUkaoM5Jkd7cYX` | **Fomo Fees Vault** (solscan), multisig | riceve la commissione di ogni swap fomo in USDC sul conto `HrTf9CzXR1dRH4Sof5QrpmGWwpwAf3qZzwCsEjQpXcSq`; 1,25M USDC il 2026-10-03 |

Il co-firmatario finanzia anche la creazione dei wallet degli utenti (solscan: "Funded by Fomo
Co-signer"). Una transazione fomo ha sempre due firmatari, co-firmatario per primo (paga) e
utente; il router e' DFlow (72% su 300 transazioni), Relay (13%), OKX (11%), Jupiter (2%).
Gli indirizzi che fomo mostra nei profili non sono questi wallet e non hanno storia on-chain;
come si risale a quello vero e' in `docs/analisi-wallet.md` §4.

## I pool EVM per prezzi e liquidita' (`scripts/fomo/prezzi_evm.js`)

Verificati on-chain il 2026-10-04 (`token0()`/`token1()`, `PositionManager.poolManager()`, le
factory restituiscono il pool di riferimento per WETH/USDC o WBNB/USDT).

| rete | Uniswap v4 PoolManager | PositionManager | pool di riferimento del nativo | factory |
|---|---|---|---|---|
| Ethereum | `0x000000000004444c5dc75cb358380d2e3de08a90` | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` | Uniswap v3 USDC/WETH 0,05% `0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640` | Uniswap v2 `0x5c69bee7…`, Uniswap v3 `0x1f98431c…`, Pancake v3 `0x0bfbcf9f…` |
| Base | `0x498581ff718922c3f8e6a244956af099b2652b2b` | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` | Uniswap v3 WETH/USDC 0,05% `0xd0b53d9277642d899df5c87a3966a349a798f224` | Uniswap v2 `0x8909dc15…`, Aerodrome `0x420dd381…`, Uniswap v3 `0x33128a8f…`, Pancake v3 |
| BSC | `0x28e2ea090877bf75740558f6bfb36a5ffee9e9df` | `0x7a4a5c919ae2541aed11041a1aeee68f1287f95b` | PancakeSwap v3 USDT/WBNB 0,05% `0x36696169c63e42cd08ce11f5deebbcebae652050` | Pancake v2 `0xca143ce3…`, Uniswap v2 `0x8909dc15…`, Pancake v3, Uniswap v3 `0xdb1d1001…` |
| Robinhood | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | (le valute dall'evento `Initialize`) | pool ETH/USDG `0xee04c687…` (log Swap) | — |

Robinhood: WETH `0x0bd7d308f8e1639fab988df18a8011f41eacad73`, USDG `0x5fc5360d0400a0fd4f2af552add042d716f1d168`
(6 decimali). Molte pool v4 di Robinhood non sono contro ETH: USDG, SPCX o altri token dei lanciatori.

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
