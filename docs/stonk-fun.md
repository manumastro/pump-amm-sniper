# stonk.fun — come funziona, e cosa si puo' fare (2026-09-13)

Documento di riferimento della piattaforma. Tutti i numeri on-chain sono ricostruiti secondo
`docs/verifica-onchain.md`; le fonti pubbliche sono citate in fondo.

## Cos'e'

Launchpad su Solana che quota i token nuovi **contro qualcosa che non e' SOL**: azioni tokenizzate
(SPYx, NVDAx, QQQx di xStocks), token pre-IPO (OPENAI, ANTHROPIC), cripto (ZEC, WBTC, HYPE),
stablecoin, o altri token stonk. Il quote deve avere almeno $50k di liquidita' su Raydium ed essere
approvato dal team.

Dal 6 settembre 2026 i lanci nuovi passano per **Raydium LaunchLab** e migrano su **Raydium CPMM**;
prima aprivano pool CLMM dirette. Il token della piattaforma, STONK, e' salito del 250% il giorno
dell'annuncio.

## Gli indirizzi

```
curva                  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj   Raydium LaunchLab
pool dopo la migrazione CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C  Raydium CPMM
pool dei lanci vecchi   CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK  Raydium CLMM
autorita' di migrazione RAYpQbFNq9i3mu6cKpTKKRwwHFDeK5AuZz8xvxUrCgw
wallet fee di stonk.fun 5CEbueQnq1Ym2uSSx2xXds3jQAqT1BDnkA59RZobSPAG
platform_config reward  6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt
platform_config standard 4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7
```

Il `platform_config` e' il modo per riconoscere un token stonk.fun in una transazione LaunchLab.

## Due modi di lanciare

| | standard | reward |
|---|---|---|
| standard del token | SPL Token | Token-2022 |
| tassa sui trasferimenti | nessuna | **1% o 3%, fissata per sempre al lancio** |
| chi incassa la tassa | — | i possessori, pagati nel quote |
| fee al creatore | 0,5% del trading | nessuna |

La tassa reward si accumula fino a una soglia legata al market cap (sotto $50k MC: $50; fino a
$125k: $200-250; poi 0,1% del MC; oltre $50M: tetto $50k), poi un wallet di stonk.fun la raccoglie,
la converte nel quote e la distribuisce ai possessori a lotti.

**Sulle 290 migrazioni vere delle ultime 55 ore: 266 reward (92%), 19 standard (7%), 5 di altre
piattaforme LaunchLab.** Il reward e' la norma.

### Verifica on-chain della tassa

Sul mint `8vMacYWU…` (CASHCAT, reward):

```
transferFeeBasisPoints 100        -> 1%
maximumFee             1e15       -> nessun tetto utile
transferFeeConfigAuthority  5KXDF6Qn…   NON nulla
withdrawWithheldAuthority   5KXDF6Qn…   e' il wallet che raccoglie e distribuisce
mintAuthority / freezeAuthority  nulle
```

La piattaforma dichiara che l'aliquota e' fissata per sempre; **on-chain l'autorita' che potrebbe
cambiarla esiste comunque**. Un controllo che guarda solo mint e freeze authority dice "pulito":
`src/services/token-security/index.ts` non legge le estensioni Token-2022.

## La curva

`pool_state`, 429 byte, discriminatore `f7ede3f5d7c3de46`. Offset verificati confrontando i Pubkey:

```
16 auth_bump  17 status  18 base_dec  19 quote_dec  20 migrate_type
21 supply          29 total_base_sell   37 virtual_base   45 virtual_quote
53 real_base       61 real_quote        69 total_quote_fund_raising
77 quote_protocol_fee  85 platform_fee  93 migrate_fee   101..133 vesting
141 global_config  173 platform_config  205 base_mint  237 quote_mint
269 base_vault     301 quote_vault
```

`status` 2 = migrata.

Su **14 pool** prese in ore diverse e su entrambe le piattaforme:

```
supply           1.000.000.000     uguale
total_base_sell    793.100.000     uguale  (il resto, 206.900.000, va alla pool nuova)
virtual_base     1.073.025.605,6   uguale
decimali                       6   uguale
bersaglio / virtual_quote = 2,8333  uguale su 14 su 14
```

`virtual_quote` invece varia di sei ordini di grandezza (1,90 · 266 · 2.222 · 3.031 · 21.072 ·
5.660.281): e' solo la scala del quote. Il **rapporto** e' fisso, quindi la forma della curva e'
identica per ogni token.

Prodotto costante con riserve virtuali:

```
prezzo(q) = (virtual_quote + q)^2 / (virtual_base * virtual_quote)
```

Con `f = q / bersaglio`, il prezzo vale `(1 + 2,8333 f)^2` volte quello di partenza. Quindi:

> **Ogni token stonk.fun percorre sempre la stessa salita: 14,69x dal primo token alla migrazione.**
> Non dipende dal token, dal creatore, dal quote o dall'interesse. E' aritmetica.

Il bersaglio e' dimensionato in dollari (la piattaforma dichiara la graduation a $40.000 di market
cap), per cui la curva va **sempre da circa $2.800 a circa $41.500 di market cap**, qualunque sia il
quote.

| raccolta | market cap | token gia' venduti | x che resta |
|---|---|---|---|
| 0% | $2.825 | 0,0% | 14,69x |
| 2% | $3.154 | 7,3% | 13,16x |
| 5% | $3.682 | 16,8% | 11,27x |
| 10% | $4.652 | 29,9% | 8,92x |
| 20% | $6.934 | 48,9% | 5,99x |
| 30% | $9.668 | 62,2% | 4,29x |
| 50% | $16.498 | 79,3% | 2,52x |
| 70% | $25.142 | 89,9% | 1,65x |
| 90% | $35.601 | 97,2% | 1,17x |
| 100% | $41.510 | 100% | 1,00x |

**I token si esauriscono molto prima dei soldi**: a meta' raccolta e' gia' venduto il 79% dei token.
Tutta la parte ripida sta all'inizio.

## Non serve la migrazione

La salita e' una funzione della **posizione sulla curva**, non del tempo e non dell'esito. Un token
che arriva al 30% della raccolta e poi si ferma ha comunque fatto 3,42x dal fondo. Il tempo non
entra nella formula: entrare presto e uscire piu' avanti paga uguale che ci metta dieci secondi o
dieci ore.

Rendimento netto, entrando alla riga e uscendo alla colonna (reward 1%: 1,25% di trading + 1% di
tassa per lato):

| entri \ esci | 5% | 10% | 20% | 30% | 50% | 70% | 100% |
|---|---|---|---|---|---|---|---|
| **0%** | +24% | +57% | +134% | +227% | +458% | +750% | +1303% |
| **2%** | +11% | +41% | +110% | +193% | +400% | +661% | +1157% |
| **5%** | — | +21% | +80% | +151% | +328% | +552% | +977% |
| **10%** | — | — | +42% | +98% | +239% | +416% | +752% |
| **20%** | — | — | — | +33% | +127% | +246% | +472% |
| **30%** | — | — | — | — | +63% | +148% | +310% |
| **50%** | — | — | — | — | — | +46% | +140% |

In modalita' standard (nessuna tassa) i numeri sono ~3 punti piu' alti; con la tassa al 3%, ~5 piu'
bassi.

### Il pareggio

```
standard    da 0% a 0,4%    da 10% a 10,6%    da 50% a 51,1%
reward 1%   da 0% a 0,8%    da 10% a 11,1%    da 50% a 52,0%
reward 3%   da 0% a 1,6%    da 10% a 12,1%    da 50% a 53,9%
```

Basta che la raccolta avanzi di meno di un punto percentuale perche' il giro sia in pari. **Il
margine non e' il problema.**

## I costi

```
trading            1,25% per lato   (Raydium 0,25% + stonk.fun 1%)
tassa reward       1% o 3% per lato, solo in modalita' reward
fee al creatore    0,5% del trading, solo in modalita' standard
migrate_fee        0
```

## Cosa succede dopo la migrazione

La meccanica finisce. La pool CPMM nasce al prezzo di fine curva e da li' si muove solo per domanda
vera. Su CASHCAT: prezzo alla migrazione `4,1929e-5`, adesso `3,2660e-6`, **-92,2%**; liquidita' da
8.588 a 2.451 USDC. La LP della migrazione e' bloccata (`LockCpLiquidity`).

## Ritmo e competizione

```
migrazioni LaunchLab       290 vere in 55 ore   ~5,3 all ora
di cui stonk.fun           285 su 290
```

Su CASHCAT, dal lancio alla migrazione sono passati **13 secondi**; 7.687 transazioni sul mint in 8
minuti, di cui **4.154 fallite (54%)**. Ma 13 secondi e' il caso veloce: il tempo non e' garantito,
ed e' irrilevante per il rendimento.

**Il dev buy non si puo' anticipare**: il creatore compra come prima operazione della pool, dentro
lo stesso bundle Jito atomico, fino al 75% della supply.

**Taglia.** L'impatto di un acquisto e' `((vq+q+d)/(vq+q))^2`. All'inizio della curva, mettere il 2%
del bersaglio sposta il prezzo di circa il 6%. Si entra piccoli.

## Cosa manca

1. **Il denominatore**: quante curve non arrivano mai in fondo, e fin dove arrivano. Serve
   `getProgramAccounts` sul programma LaunchLab filtrato per `platform_config` (offset 173).
   publicnode lo rifiuta ("Indexed requests require a personal token"), Alchemy supera i compute
   unit, dRPC free non serve Solana, Chainstack ha la quota mensile esaurita.
2. **Il percorso nel tempo**: quanto ci mettono le curve ad avanzare, e quante tornano indietro.
3. **Come si legge un lancio in diretta**: `initialize_with_token_2022` / `initialize_v2` su
   LaunchLab con un `platform_config` di stonk.fun fra i conti.

## Fonti

- https://docs.bitquery.io/docs/blockchain/Solana/stonkfun-api/
- https://github.com/krisbuild/Stonkfun-gitbook-
- https://www.theblock.co/news/defi/2026-09-06-stonk-surges-250-to-140-million-market-cap-as-stock-paired-solana-launchpad-stonkfun-pulls-volume-to-raydium-and-jupiter-413621
- https://airdropalert.com/blogs/what-is-stonkfun/
- https://www.stonkfun.xyz/rewards
