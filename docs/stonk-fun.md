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

Su **71 pool** prese in ore diverse e su entrambe le piattaforme:

```
supply           1.000.000.000     uguale
total_base_sell    793.100.000     uguale  (il resto, 206.900.000, va alla pool nuova)
virtual_base     1.073.025.605,6   uguale
decimali                       6   uguale
bersaglio / virtual_quote = 2,8333  uguale su 71 su 71
```

I **decimali del quote** invece variano molto. Su tutte le 46.144 pool esistenti:

```
4 decimali:      1      8 decimali: 19.083     ← il caso piu' comune
5 decimali:    214      9 decimali: 12.152
6 decimali: 13.721     11 decimali:    537
                       12 decimali:    436
```

Vanno letti dal `pool_state` (offset 19). Darli per scontati a 6 sbaglia il prezzo di ordini di
grandezza sul 70% delle pool.

`virtual_quote` varia di sei ordini di grandezza (1,90 · 266 · 2.222 · 3.031 · 21.072 ·
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
minuti, di cui **4.154 fallite (54%)**. Ma quella corsa riguarda chi vuole entrare al secondo zero:
entrando a curva gia' partita (vedi sotto) non c'e' nessuna gara da vincere.

**Il dev buy non si puo' anticipare**: il creatore compra come prima operazione della pool, dentro
lo stesso bundle Jito atomico, fino al 75% della supply.

**Taglia.** L'impatto di un acquisto e' `((vq+q+d)/(vq+q))^2`. All'inizio della curva, mettere il 2%
del bersaglio sposta il prezzo di circa il 6%. Si entra piccoli.

## La popolazione intera

`getProgramAccounts` sul programma LaunchLab filtrato per i due `platform_config` (offset 173).
**46.030 pool**, cioe' tutto cio' che stonk.fun ha lanciato da quando e' su LaunchLab (~9 giorni,
stimati dalla frequenza di migrazione: 1.146 / 5,3 all'ora).

```
pool totali      46.030      reward 36.390   standard 9.640
migrate           1.146      2,49%
lanci            213 all ora
```

### Quasi nessuna parte

Mediana della raccolta raggiunta: **0,12%**. Il 90esimo percentile sta allo 0,62%. La stragrande
maggioranza dei lanci non si muove di un centimetro.

| soglia di raccolta | quante ci arrivano | su tutti i lanci | x dal fondo |
|---|---|---|---|
| 0,5% | 5.172 | 11,24% | 1,03x |
| 1% | 3.644 | 7,92% | 1,06x |
| 2% | 2.543 | 5,52% | 1,12x |
| 5% | 1.621 | 3,52% | 1,30x |
| 10% | 1.324 | 2,88% | 1,65x |
| 20% | 1.210 | 2,63% | 2,45x |
| 50% | 1.152 | 2,50% | 5,84x |
| 100% | 1.146 | 2,49% | 14,69x |

### Ma chi parte, arriva

La distribuzione e' a due gobbe: o muore subito, o va fino in fondo. La probabilita' **condizionata**
di migrare, sapendo fin dove e' gia' arrivata:

| e' arrivata a | n | probabilita' di migrare |
|---|---|---|
| 0,5% | 5.172 | 22,2% |
| 1% | 3.644 | 31,4% |
| 2% | 2.543 | 45,1% |
| 5% | 1.621 | **70,7%** |
| 10% | 1.324 | **86,6%** |
| 20% | 1.210 | 94,7% |
| 30% | 1.170 | 97,9% |
| 50% | 1.152 | 99,5% |

**Non serve indovinare in anticipo, e non serve correre.** Si aspetta che la curva superi una soglia
e la si compra li': al 5% di raccolta restano 11,27x davanti e sette su dieci ci arrivano.

| entri a | P(migra) | x davanti | netto se va | occasioni all'ora |
|---|---|---|---|---|
| 2% | 45,1% | 13,16x | +1157% | 11,8 |
| 5% | 70,7% | 11,27x | +977% | 7,5 |
| 10% | 86,6% | 8,92x | +752% | 6,1 |
| 20% | 94,7% | 5,99x | +472% | 5,6 |

Il valore atteso e' positivo e largo in tutta la fascia, ma **dipende da quanto si perde sui
fallimenti, che non e' misurato**: ipotizzando -30% su chi non ce la fa, l'attesa va da +505% (entrando
al 2%) a +682% (al 5%). E' l'ipotesi piu' fragile di tutto il documento.

### Il quote quasi mai e' SOL

Su 25 pool migrate campionate: **21 quote diversi**, e nessuno dei 25 e' SOL. Compaiono xStocks
(`Xs3oZwbH…`, `Xsc9qvGR…`), pre-IPO (`Prewe…`), cbBTC, Monero wrappato, JitoSOL, ORE, WEN, LINK,
STONK stesso, token pump. I bersagli vanno da 11,04 a 31.194.712 unita' di quote.

Due conseguenze operative: per comprare serve **prima procurarsi il quote**, e per valutare in
dollari serve il prezzo di 21 asset diversi. La cifra di $40.000 di market cap alla graduation e'
dichiarata dalla piattaforma ed e' verificata sull'unico caso quotato in USDC che ho misurato
(CASHCAT, $41.510); il **rapporto** 14,69x invece e' misurato e vale per tutti.

## Un operatore vero: `FiFawHqxeTVBhv6YbqbLwDVuvokRpPUM1bNwAyxhGc6W`

1.144 transazioni in 29 ore, 25% fallite, 62 SOL a saldo. Opera su stonk (442 tx) e su pump (376),
e usa Orca Whirlpool, Raydium CLMM e Meteora DLMM per procurarsi i quote. Su stonk: **57 pool, 440
scambi, 56 posizioni aperte e chiuse.**

```
                        min      25%    mediana     75%       max
entra alla raccolta    -0,87%    0,84%    1,58%    2,32%     8,87%
esce alla raccolta      1,07%    4,49%    7,73%   12,19%    55,72%
rendimento             -0,70%    4,49%   16,30%   24,91%   112,45%
minuti in posizione        0,0      0,1      0,2    516,5    1672,4
```

**53 posizioni su 56 in guadagno (95%), e la peggiore perde lo 0,70%.** Mediana: un acquisto, due
vendite, dodici secondi. 29 su 56 chiuse entro il minuto. 2,1 posizioni all'ora.

Non prevede niente: delle 57 pool che ha toccato ne sono migrate **3 (5,4%)**, contro il 2,49% della
popolazione — meglio del caso, ma non abbastanza da chiamarlo un segnale. Su quelle tre ha preso
+3,9%, +3,5% e +20,0%, dove tenendo avrebbe fatto 12,03x, 13,95x e 9,38x.

**Raccoglie il primo movimento della curva e se ne va**, dove la perdita e' tappata dai costi.
Rinuncia completamente alla coda. E' la conferma sul campo della riga piu' importante di questo
documento: entrando presto, il margine non e' il problema.

### Dove guadagna: sulle pool che NON migrano

| gruppo | n | in guadagno | rendim. mediano | peggiore | migliore | minuti | entra a | esce a |
|---|---|---|---|---|---|---|---|---|
| tutte | 56 | 95% | +16,3% | -0,7% | +112,5% | 0,2 | 1,58% | 7,73% |
| poi migrate | 3 | 100% | +3,9% | +3,5% | +20,0% | 0,1 | 3,71% | 5,70% |
| **non migrate** | **53** | **94%** | **+16,9%** | -0,7% | +112,5% | 4,1 | 1,58% | 7,80% |

Le non migrate rendono **piu'** delle migrate. Non e' un paradosso: le migrate le ha mollate dopo
pochi secondi, sulle altre ha lasciato correre qualche minuto.

E le 53 pool non migrate, oggi, stanno alla **mediana dello 0,35% di raccolta** (42 sotto l'1%),
mentre lui era uscito al 7,80%. **Ha venduto piu' in alto di dove la pool e' poi rimasta in 52 casi
su 53.**

Questo misura la cosa che mancava: **la curva torna indietro.** Non e' una scala mobile a senso
unico — si riempie, e poi si svuota quando chi e' entrato vende. Tenendo dall'ingresso fino a oggi,
sulle stesse 53 posizioni, avrebbe fatto **-9,6% mediano, peggiore -31,8%, e 47 su 53 in perdita.**

Le stesse curve, quindi, pagano bene chi entra presto e esce presto, e puniscono chi tiene. Il -30%
che avevo ipotizzato sui fallimenti e' vicino al **caso peggiore** misurato, non alla mediana.

Sostituisce anche l'ipotesi del -30% sui fallimenti, **ma solo per questo stile**: uscendo entro
pochi secondi, la perdita peggiore misurata su 56 posizioni e' -0,70%. Per chi tiene, quanto si
perde resta non misurato.

Un costo che questi numeri non contengono: i rendimenti sono in unita' di quote, e riportare il
quote in SOL passa per un altro swap su Whirlpool o CLMM.

### Rimisurato dieci ore dopo (2026-09-14), ed e' da qui che copiamo

Ricostruito di nuovo dalla catena sulle sue ultime dieci ore, per vedere se il quadro sopra regge e
per guardare **come** opera, non solo con che risultati: 146 operazioni su LaunchLab, **55 giri
completi**, ancora attivo mentre scrivevamo. Regge, e il rendimento mediano e' piu' basso di quello
delle 56 posizioni di ieri (+8,8% contro +16,3%) su un campione tutto nuovo.

| | |
|---|---|
| in guadagno | 42 su 55 |
| rendimento mediano | **+8,8%** |
| caso peggiore | **-4,7%** |
| migliore | +125,2% |
| durata mediana | **4 secondi** (prima vendita dopo 2s) |

#### Come lo fa

**Compra prestissimo, e non sgarra.** Su 25 acquisti verificati leggendo il vault del quote prima
della sua transazione: raccolta mediana **0,85%**, massimo **2,33%**, 25 su 25 sotto il 3%.

**Compra grosso.** Ogni suo acquisto muove la curva di **1,75 punti** di raccolta: quasi dieci volte
la taglia che simuliamo noi (0,2% del bersaglio). Compra abbastanza da muovere il prezzo che incassa.

**Una compra sola per token.** Mai una media al ribasso: se va male esce.

**Vende in piu' pezzi e vende tutto.** Mediana 1 vendita, fino a 7 sullo stesso token; i token
rivenduti sono il 100% — non tiene mai niente.

**Risolve il problema dei 21 quote dentro la transazione.** Paga in SOL o USDC e lo scambio nel
quote esotico avviene nella stessa transazione, atomicamente:

```
InitializeAccount3 · SwapV2 (Raydium CLMM) · TransferChecked · BuyExactIn (LaunchLab) · TransferChecked
```

Secondo dove sta la liquidita' di quel quote usa Raydium CLMM (`CAMMCzo5…`), Raydium CPMM
(`675kPX9M…`) o Meteora DLMM (`LBUZKhRx…`). Se lo scambio fallisce fallisce tutto insieme, e non
resta con un asset illiquido in mano. Paga 0,01 SOL di priorita' sugli acquisti.

**Non evita i token tassati**: 21 dei 25 acquisti sono lanci reward con la tassa dell'1-3%.

#### Cosa ce ne viene

Il suo caso peggiore e' -4,7%, il nostro -21%. La differenza non e' la scelta dei token: e' che lui
e' fuori in quattro secondi, mentre noi restiamo dentro finche' uno stop a -10% ci butta fuori a
-15/-21% per lo scivolamento. A quella velocita' lo stop non gli serve.

Da qui le tre regole messe in prova nel paper trade (vedi `docs/controls.md`):

1. `STONK_MAX_INGRESSO` **0,025** — non si compra sopra il 2,5%, era 0,30.
2. `STONK_USCITE_TEMPO` **5, 10, 30 secondi** — uscite a tempo, senza aspettare nessun obiettivo.
3. `STONK_USCITE_META` **+25%, +60%** — si vende meta' all'obiettivo e il resto corre.

Quello che **non** stiamo ancora replicando: la taglia (lui muove 1,75 punti di curva, noi 0,2), il
percorso atomico nel quote, e la priorita' pagata. Tutti e tre cambiano il risultato vero, e nessuno
dei tre e' nella simulazione.

### La matematica, verificata su tutte le pool

`src/services/stonk/curva.ts` implementa il prodotto costante sulle riserve virtuali:

```
base_eff  = virtual_base  - real_base
quote_eff = virtual_quote + real_quote
k         = virtual_base * virtual_quote        (costante)

prezzo          = quote_eff / base_eff
token comprando = base_eff  - k / (quote_eff + quote_in)
quote vendendo  = quote_eff - k / (base_eff  + token_in)
```

`scripts/stonk-verifica-curva.js` lo controlla contro **tutte le 46.144 pool on-chain**, tre
invarianti:

```
prodotto costante sulle riserve virtuali   46.144 / 46.144
bersaglio / virtual_quote = 2,8333         46.144 / 46.144
bersaglio comprato = totale da vendere     46.144 / 46.144
```

Il terzo e' il piu' stringente: comprando dal fondo esattamente il bersaglio si devono consumare
esattamente i 793.100.000 token destinati alla curva. Torna su tutte. La tolleranza e' 1e-4 perche'
la curva on-chain lavora in interi e sui quote a 6 e 8 decimali l'arrotondamento lascia qualche
milionesimo di scarto.

## L'osservatorio live

`scripts/stonk-osservatorio.js` — si iscrive con `programSubscribe` a tutti i `pool_state` di
LaunchLab filtrati per i due `platform_config` di stonk.fun (dataSize 429, memcmp all'offset 173) e
registra il percorso di ogni curva. Non compra niente, non tocca il bot.

```
node scripts/stonk-osservatorio.js          # scrive in logs/, va lasciato girare
node scripts/stonk-analisi.js               # legge i log e misura
```

Volume misurato: **~9 aggiornamenti al secondo**, cioe' ogni singolo acquisto e vendita su ogni
curva stonk viva, spinti dal nodo. Nessun polling.

Scrive due file (in `logs/`, gia' fuori da git):

- `stonk-pools.jsonl` — una riga per pool nuova (mint, quote, decimali, `virtual_quote`, bersaglio,
  la `f` a cui l'abbiamo vista la prima volta) piu' una riga `tipo: "nascita"` con l'istante di
  creazione. La nascita si risolve con una sola chiamata per pool: se `getSignaturesForAddress`
  restituisce meno di 1000 firme, la piu' vecchia **e'** la creazione; altrimenti la pool era gia'
  vecchia quando l'abbiamo incontrata e viene marcata come tale.
- `stonk-curva.jsonl` — un campione ogni volta che la raccolta si muove di almeno
  `STONK_PASSO_MINIMO` (default 0,02% del bersaglio) o cambia stato: `{t, pool, f, real_quote, stato}`.

`scripts/stonk-analisi.js` ne ricava: fin dove arrivano, quanti secondi ci mettono a superare
ciascuna soglia **contando dalla nascita vera**, di quanto ricadono dal massimo, e la simulazione
entra-a/esci-a con i costi.

### Controlli

| variabile | default | cosa fa |
|---|---|---|
| `STONK_PASSO_MINIMO` | 0,0002 | quanto deve muoversi `f` per registrare un campione |
| `STONK_HEARTBEAT_MS` | 60000 | ogni quanto stampa la riga di stato |
| `STONK_NASCITE_AL_SEC` | 2 | quante nascite risolvere al secondo via RPC |
| `STONK_COSTI` | 0,045 | costo andata e ritorno usato nella simulazione |

Usa `SVS_INDEX_RPC` (websocket ricavato dall'URL), con `SVS_UNSTAKED_RPC` come ripiego.

## Il paper trade live

`scripts/stonk-paper.js` — ha preso il posto dell'osservatorio, che e' spento. Non registra piu'
tutto quello che passa: apre posizioni simulate quando la raccolta **attraversa** la soglia
d'ingresso e le chiude quando ne attraversa una d'uscita. Su ogni ingresso apre una posizione per
ciascuna regola d'uscita in prova: costano zero e fanno misurare tutte le uscite sulla stessa
sessione, invece di una per volta. Le regole sono tre famiglie, e i nomi nel report dicono quale:

| | |
|---|---|
| `p10 … p1000` | si esce quando il **prezzo** e' salito del 10, 15, 25, 40, 60, 100, 300, 1000% dall'ingresso |
| `t5 t10 t30` | si esce dopo 5, 10, 30 **secondi**, comunque sia andata |
| `m25 m60` | si vende **meta'** all'obiettivo e il resto corre fino allo stop o alla scadenza |

Su tutte vale lo stesso stop: -10% di prezzo dall'ingresso. E si compra solo fra l'1,5% e il **2,5%**
di raccolta: sopra non si entra affatto.

Quando una posizione scade, la pool **si chiede all'RPC** invece di aspettare che passi qualcuno:
la curva si vede solo sugli scambi altrui, e senza questa chiamata `t10` chiudeva dopo 24 secondi di
mediana e `t30` dopo 59. Resta comunque una differenza dal vero: noi leggiamo un prezzo, un bot vero
manda una transazione e la paga con lo slittamento.

La logica di decisione sta in `src/services/stonk/paper.ts` ed e' pura: lo script e' solo il
daemon che le porta i dati. Le soglie e il perche' di ognuna stanno in `docs/controls.md` §51.

```
./scripts/bot stonk            # cruscotto: una schermata che si ridisegna
./scripts/bot stonk live       # il battito del daemon
./scripts/bot stonk flusso     # ogni ingresso e ogni chiusura appena avvengono
./scripts/bot stonk report     # la misura completa sul jsonl
./scripts/bot stonk su | giu | riavvia | reset
```

Scrive `logs/stonk-paper.jsonl`: una riga `tipo: "ingresso"` per attraversamento (con `f`,
bersaglio, decimali del quote, piattaforma, aliquota della tassa letta dal mint, e se la pool era
seguita dalla nascita) e una riga `tipo: "chiusa"` per ogni posizione (f d'ingresso e d'uscita,
massima e minima toccate, secondi, quote spesa e incassata, rendimento, motivo).

Il cruscotto (`scripts/stonk-cruscotto.js`) legge quel jsonl in modo incrementale e il battito da
`logs/stonk-paper.log`. E' separato da `scripts/dashboard.js` perche' quello legge i log Docker del
container `sniper` e `logs/paper-report.json`, che qui non esistono.

La cosa che mostra e che non si vedeva prima e' **l'imbuto d'ingresso**: quante curve riusciamo a
vedere da sotto la soglia — le uniche che potremmo davvero prendere all'attraversamento — contro
quante ci arrivano quando il punto d'ingresso e' gia' passato. Su `programSubscribe` una pool
compare solo quando qualcuno la scambia, e a quel punto e' quasi sempre gia' oltre.

## Cosa manca

1. **Quanto si perde quando non ce la fa, tenendo.** Misurato solo per lo stile mordi-e-fuggi
   (-0,70% nel caso peggiore su 56 posizioni). Per chi tiene oltre il minuto la tabella del valore
   atteso poggia ancora su un -30% ipotizzato: serve seguire nel tempo curve che superano il 5% e
   poi si fermano.
2. **Il percorso nel tempo**: quanto ci mettono ad andare dal 5% al 100%, e quanto capitale resta
   fermo. E' quello che sta raccogliendo l'osservatorio: servono ore di dati prima di leggerlo.
3. **Come si procura il quote**: 21 asset diversi, spesso illiquidi. Il costo di entrata e uscita
   dal quote non e' nei 4,5% calcolati qui.
4. **Se l'uscita e' davvero raggiungibile**: la simulazione dell'osservatorio guarda il prezzo del
   pool, non il riempimento di un ordine. Slippage, taglia e transazioni fallite (il 54% su CASHCAT)
   non ci sono dentro.

## Fonti

- https://docs.bitquery.io/docs/blockchain/Solana/stonkfun-api/
- https://github.com/krisbuild/Stonkfun-gitbook-
- https://www.theblock.co/news/defi/2026-09-06-stonk-surges-250-to-140-million-market-cap-as-stock-paired-solana-launchpad-stonkfun-pulls-volume-to-raydium-and-jupiter-413621
- https://airdropalert.com/blogs/what-is-stonkfun/
- https://www.stonkfun.xyz/rewards
