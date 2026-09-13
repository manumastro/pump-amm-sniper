# Che fine fanno i token che il bot vede nascere (2026-09-13)

255 token pump visti nascere dal bot fra le 09:00 e le 10:25 UTC, ripresi da dexscreener 5-90 minuti
dopo. Tutti e 255 indicizzati: nessuno sparisce nel nulla.

## Esito del bot contro esito reale

| il bot ha detto | n | graduati su PumpSwap | vivi (liq >= $1000) | **mc massima raggiunta** |
|---|---|---|---|---|
| SKIP: low liquidity | 137 | 4 (3%) | 0 | $182.352 |
| **SKIP: no WSOL side** | **61** | **13 (21%)** | **13** | **$13.540.107** |
| COMPLETED (comprati) | 28 | 2 (7%) | 1 | $15.131 |
| SKIP: creator risk | 7 | 0 | 0 | $3.209 |
| SKIP: paper simulation guard | 10 | 0 | 0 | $3.132 |
| MONITOR_ONLY | 4 | 0 | 0 | $3.004 |
| PAPER LOSS | 5 | 0 | 0 | $2.792 |
| SKIP: pre-entry guard | 2 | 0 | 0 | $2.799 |

**Tutti i vincitori stanno in un solo secchio, ed e' quello che scartiamo per un motivo tecnico.**

I sei migliori, tutti `SKIP: no WSOL side`:

```
k91ZFNe2tN   mc $13.540.107   liq $307.074   +32.532%
J52CTiCT6i   mc $10.153.909   liq $265.413   +24.393%
aEXwZerTRj   mc  $6.144.025   liq $206.142   +14.707%
Hp25GPMpRa   mc  $6.111.070   liq $205.583   +14.628%
NwffF1pPD7   mc  $2.406.267   liq $128.282    +5.706%
cfCH3kDrmf   mc  $1.192.228    liq $89.881       +39%
```

Il meglio che il bot abbia **comprato** nello stesso periodo: mc $15.131.

## Cos'e' un `no WSOL side`

Il messaggio completo lo dice: `pool has no WSOL side (curve=... quote=SOL (migrata su PumpSwap))`.
Il bot legge la curva, la trova **gia' completa**, e si ferma perche' sa scambiare solo la bonding
curve.

Verificato on-chain quando nasce quella curva:

```
k91ZFNe2tN   curva creata 10:19:36 UTC   bot la vede 10:19:37   differenza  1 s
J52CTiCT6i   curva creata 10:22:29 UTC   bot la vede 10:22:31   differenza  2 s
```

**La curva si completa entro un secondo dalla creazione.** Non e' una migrazione dopo mezz'ora di
scambi: e' un lancio che compra tutta la curva nella transazione di creazione o in quella subito
dopo, gradua all'istante e apre una pool PumpSwap. Sono il **24% di tutto cio' che nasce** (61 su
255).

Il bot li vede un secondo dopo la nascita, ha gia' in mano l'indirizzo della pool, e li butta via.

## Il secchio non e' tutto oro

Dei 13 graduati: 6 fanno da +39% a +32.532%, gli altri 7 stanno a -95%/-99% con $1.800-$2.500 di
liquidita' residua. E' una lotteria a coda lunga: ~10% di colpi enormi su 61 valutazioni, contro
**zero** vincitori sui 194 restanti.

## Due conseguenze

**1. `MIN_POOL_LIQUIDITY_SOL=1` non e' il problema.** Una pool graduata nasce con la SOL della curva:
passa la soglia senza sforzo. Il problema e' che non abbiamo l'adapter registrato per leggerla.

**2. La gestione dell'uscita attuale butterebbe via l'edge.** `HOLD_WINNER_HARD_TP_PCT = 50` chiude a
+50%: su un token che fa +32.532% significa prendere lo 0,15% del movimento. Su questa popolazione il
take profit fisso e' il controllo sbagliato — serve il trailing, o niente.

---

# Correzione e secondo giro: si riconoscono prima?

## Il secchio `no WSOL side` sono due cose diverse

Detto sopra che i 61 `no WSOL side` erano graduazioni istantanee. **Non e' vero: solo 13 lo sono.**
Il motivo esatto e' gia' scritto nel nostro `skipReason`, e separa i due gruppi in modo perfetto:

| motivo nel messaggio | n | vivi | mc max |
|---|---|---|---|
| `quote=SOL (migrata su PumpSwap)` | **13** | **13 (100%)** | $13.540.107 |
| `quote=<altro mint>` (USDC, token vari) | 48 | **0** | $5.902 |

I 48 sono curve pump quotate in un token che non e' SOL: scartarle e' giusto, sono morte tutte.
I 13 sono graduazioni istantanee: **vive tutte e 13**. La separazione e' gia' nel log, a costo zero,
un secondo dopo la nascita. Basta leggere il campo `quote` invece di trattare tutto il secchio uguale.

## Dentro i 13: alla nascita sono identici

Da dexscreener, la pool PumpSwap dei 13 nasce **nello stesso secondo** della curva, e la curva resta
a mc $41.000 esatti per tutti. A `t+1s` non c'e' nulla che li distingua: stesso template, stesso
istante, stesso mc.

## Cio' che li distingue: quanta SOL arriva nel primo secondo

> **Correzione (stessa giornata).** La prima versione di questa sezione diceva "la SOL nella pool
> alla nascita: sopra 1.500 SOL 4 su 4". Era una lettura sbagliata: le firme venivano ordinate per
> `blockTime`, ma decine di transazioni condividono lo stesso secondo di creazione e il sort stabile
> di JS le lascia dal piu' recente. Si leggeva l'**ultima** transazione di quel secondo credendola la
> prima. Rimisurato con l'ordine vero (ordine API ribaltato, mai `blockTime`).

**Il seed di graduazione non e' un segnale: e' 67,4 SOL per tutti**, 22 letture su 22. E' un
parametro fisso di pump.

I 1.505 SOL erano la pool **dopo circa un secondo di vita**: ~1.438 SOL di acquisti entrati nello
stesso secondo della graduazione. E' una cosa diversa, e piu' utile — non e' un parametro del
template, e' domanda vera. Ed e' esattamente cio' che il worker legge quando arriva sulla pool.

Rimisurato su **28 pool graduate in quattro ore diverse** (07, 08, 09, 10 UTC), vivo = mc >= $100.000:

| SOL nella pool dopo ~1s | n | vivi | mc max |
|---|---|---|---|
| oltre 1.500 | 5 | 4 (80%) | $14.382.579 |
| 300 - 800 | 12 | 4 (33%) | $2.422.147 |
| sotto 150 (nessun acquisto) | 9 | 1 (11%) | $121.093 |
| non leggibile | 2 | 0 | $2.532 |

I nove vivi:

```
Hp25GPMp  10:21  1506 SOL  $14.382.579      cfCH3kDr  09:26   367 SOL   $1.423.309
k91ZFNe2  10:19  1506 SOL  $13.709.210      VyoGPmnQ  10:27   366 SOL   $1.108.563
aEXwZerT  10:18  1506 SOL  $13.244.365      J1NzhQmU  10:51    73 SOL     $121.093
J52CTiCT  10:22  1505 SOL  $12.451.922
NwffF1pP  09:50   615 SOL   $2.422.147
V5HAV6jt  08:37   546 SOL   $1.948.110
```

### Cosa regge e cosa no

**Non regge la soglia a 1.500.** I quattro vivi di quella fascia nascono in quattro minuti e almeno
due condividono il payer: un campione solo travestito da quattro. E l'unico caso indipendente della
fascia, `43VfGSS9` con **3.027 SOL** — il primo secondo piu' forte dell'intero campione — e' morto a
$456. Piu' SOL non e' automaticamente meglio.

**Regge il taglio grezzo:** c'e' stato un acquisto nel primo secondo, si' o no.

```
  >= 300 SOL   8 vivi su 17   47%
  <  150 SOL   1 vivo  su  9  11%
```

Quattro volte meglio. Ma sono 17 e 9 campioni, e il 47% resta una lotteria: il segnale non dice
"questo vince", dice "qui vale la pena giocare". Per questo `PUMP_MIGRATO_MIN_SOL_1S` resta a 0 e il
numero si registra soltanto (`SOL1S` nel log, `solPrimoSecondo` nel report).

## Sull'uscita: il TP fisso qui non funziona

Sulla popolazione dei 13, con 6 vincitori da +39% a +32.532% e 7 a -95%, il profitto viene tutto
dalla coda. `HOLD_WINNER_HARD_TP_PCT = 50` tronca l'unica fonte di guadagno e lascia intatte le
perdite: e' la forma d'uscita sbagliata per definizione.

Ma l'ordine delle cose e' questo: **non serve holdare piu' a lungo su 13 token, serve entrare sui 4.**
Se la soglia di seed regge, il secchio passa da 6 vincitori su 13 a 4 su 4, e solo a quel punto il
trailing stop ha qualcosa da proteggere. Cambiare l'uscita prima dell'ingresso significa tenere piu'
a lungo anche i sette che vanno a -95%.

Ordine proposto: (1) registrare `pumpSwapAdapter`, (2) leggere il vault della pool all'ingresso e
misurarlo su una sessione senza bloccare, (3) solo dopo sostituire il TP fisso con un trailing.
