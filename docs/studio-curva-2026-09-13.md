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
