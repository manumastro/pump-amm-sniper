# fomo.family: come funziona, chi sono i migliori, come operano

**3 ottobre 2026.** fomo.family e' un'app di trading "social" (2,5M utenti dichiarati): wallet
dentro l'app, niente gas, ricarica con Apple Pay, classifica dei trader, notifiche su "cosa
compra chi e' in cima". Le domande: **come funziona on-chain, chi sono davvero i migliori, e
come operano.**

Materiale, tutto degli ultimi 30 giorni:

    classifiche fomo 24h / 7g / 30g / sempre          372 utenti distinti
    positivi su sempre, 30g e 7g (il campione)        170
    swap e trasferimenti dall'API                     89.975 swap · 116.772 trasferimenti
    wallet on-chain veri ritrovati                    165 su 170
    ricostruiti dalla catena, transazione per tx      165 wallet · 175.149 transazioni (Solana)
    token Solana con nascita e supply on-chain        4.333
    transazioni fomo scomposte una per una            300 (flusso generale, non solo i big)
    acquisti dei big seguiti minuto per minuto        271 (tutte le tx del token da -5 a +15 min)

Il metodo, riusabile per qualunque trader, e' in `docs/analisi-wallet.md`.

---

## 1. Come funziona fomo on-chain

**Il wallet.** Ogni utente ha un wallet Solana suo, creato e finanziato dal **co-firmatario di
fomo** `AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51` (solscan: "Fomo Co-signer"; sui wallet
"Funded by Fomo Co-signer"). L'indirizzo che fomo mostra nel profilo e negli swap **non e'
quel wallet e non ha storia on-chain** (verificato su 15, tutti vuoti); il wallet vero si
ritrova dal token (§3 di `docs/analisi-wallet.md`).

**La transazione.** Ogni swap ha due firmatari: il co-firmatario per primo, che paga il gas
(l'app e' "gasless"), e l'utente. Il co-firmatario fa ~526 transazioni al minuto e tiene 1.370
SOL. Tre big su 165 firmano da soli: hanno esportato la chiave.

**Il router** (300 transazioni del flusso generale):

    DFlow 72% · Relay 13% · OKX 11% · Jupiter 2%

Relay (`99vQwt…`, "Relay: Depository") e' il ponte: l'USDC parte da Solana e il token arriva su
un'altra catena. E' la porta di **piu' di meta' del capitale dei big**, che non e' su Solana:

    capitale dei giri:  Robinhood Chain (id 4663) 44% · Solana 39% · BSC 9% · Ethereum 3% · Base 3% · altre 2%

Dai 165 wallet sono usciti $66,4M di USDC senza token in cambio (ponte e prelievi) contro $3,9M
entrati da fuori.

**Il contante e' USDC**: sta da una parte in 88.583 swap su 89.975.

**La commissione** va a `R4rNJHaff…`, **"Fomo Fees Vault"** (multisig, 1,25M USDC il 3/10),
dentro la stessa transazione dello swap. Ha un minimo di **$0,10** e scende con la dimensione:

    ordine        commissione mediana
    < $5          3,3%   (il minimo da $0,10 pesa)
    $5-20         1,2%
    $20-100       1,1%
    $100-500      0,35%
    > $500        0,3-0,5%

Gli acquisti via Relay non pagano su Solana (40 su 40): la commissione, se c'e', sta
sull'altra catena. Nel flusso generale l'ordine mediano e' **$16** (53% sotto $20; 268 utenti
diversi in 300 transazioni): la folla paga 1-3% per lato. I big pagano **0,5%** per lato
(misurato su 10.205 loro swap ritrovati on-chain).

**L'API e' fedele, i dollari no.** Il 92,3% degli swap dichiarati si ritrova on-chain con la
quantita' di token identica; ma fomo registra gli importi al netto della commissione, quindi il
suo PnL sui giri e' gonfiato dello ~0,6% del capitale (1.082 giri accoppiati: +9,10% per fomo,
+8,53% on-chain). L'ora di fomo sta fra −30 e +27 secondi da quella del blocco.

## 2. La classifica misura la posizione aperta, non la bravura

Il caso da cui e' partito, **@CVLM03**: 5° nella 24h con +$224.758, ma −$94.787 da sempre. Il
+$225k di un giorno erano due posizioni aperte (MASK $352k, SI $197k) salite del 62% e del 32%
quel giorno; i "+$746k realizzati" su STONK erano 4,63M STONK **depositati da un altro wallet** e
liquidati in perdita rispetto al valore d'ingresso.

Non e' un'eccezione. Su 188 positivi nella 24h, **33 sono negativi da sempre**. Sui 170 positivi
su tutte e tre le finestre lunghe:

    PnL dichiarato da fomo a 30 giorni               $29,8M  (i 165 ritrovati)
    realizzato on-chain su Solana, giri chiusi        $3,3M
    posizioni aperte su Solana, ai prezzi di oggi    +$8,0M
    il resto                                          altre catene, token depositati

**Realizzato on-chain positivo: 83 wallet su 165.** Contando anche l'aperto ai prezzi di oggi,
126. Nell'ultima settimana, in cui *tutti* sono positivi per fomo, sui giri chiusi lo sono 58
su 138.

## 3. Chi sono davvero i migliori

Classifica rifatta dalla catena (Solana, 30 giorni, giri chiusi puliti: tutto comprato e
rivenduto nella finestra, niente token depositati, almeno $10). Un wallet e' **solido** se ha
almeno 10 giri, realizzato positivo, resta positivo **togliendo il suo giro migliore**, ed e'
positivo **in entrambe le meta' del mese**:

    wallet con almeno 10 giri       112
    solidi                           16

    utente              giri  capitale  realizz.  senza il migliore  1a meta'  2a meta'  vinti  mediana  follower
    bigbabba             115    $885k    +$205k        +$126k         +$133k    +$71k    51%   +0,5%    73.274
    0xBEC001              27    $234k     +$87k         +$57k          +$41k    +$46k    56%   +3,9%     1.948
    prevaile             553    $924k     +$64k         +$52k          +$55k     +$9k    37%   −8,9%     2.681
    seralberttrades       49    $862k    +$336k         +$51k         +$203k   +$133k    22%  −41,7%    29.167
    bystevenr            213    $308k     +$80k         +$50k           +$8k    +$72k    43%   −7,3%    21.835
    GenerationalFumbler   23    $417k    +$232k         +$48k         +$207k    +$25k    43%   −2,2%     3.541
    TradeRansoze         122    $807k     +$63k         +$41k          +$12k    +$51k    35%   −9,5%     2.038
    tontheneko           515    $524k     +$58k         +$39k          +$50k     +$8k    43%   −9,3%     6.732
    BTCwolf               45    $174k    +$171k         +$31k         +$122k    +$48k    22%  −41,2%     4.727
    kecoseh               20    $112k     +$45k         +$27k           +$1k    +$44k    65%  +13,4%       138
    eth200000             23     $64k     +$96k         +$21k           +$0k    +$96k    43%  −11,2%       568
    starcatcher444        48     $80k     +$27k         +$11k          +$19k     +$8k    40%   −8,9%    26.641
    modeincognito         11     $75k     +$13k          +$8k           +$5k     +$8k    55%   +5,6%    19.780
    cryptoklotz           22     $27k      +$3k          +$2k           +$3k     +$1k    64%  +19,8%     8.476
    bobdotjpg             36     $33k     +$11k          +$1k           +$1k    +$10k    56%   +5,6%       333
    man1festing          217    $161k     +$39k          +$0k           +$0k    +$39k    34%  −14,4%       162

**I follower non dicono niente**: fra i solidi si va da 138 a 73.274. Nemmeno il PnL di fomo:
@modeincognito e' primo nella classifica on-chain "realizzato + aperto" grazie a $799k aperti,
ma ha realizzato $13k in 11 giri.

**Due mestieri diversi** stanno dentro la stessa lista:

- **chi vince spesso poco** — @bigbabba (51% vinti, mediana +0,5%, perde in mediana −25% e
  vince +26%), @0xBEC001, @kecoseh, @cryptoklotz: tagli simmetrici, giri ripetibili;
- **chi perde quasi sempre e vince enorme** — @seralberttrades (14% vinti sui giri fomo, perso
  mediano −50%; $192k su un solo giro, PAID +252%), @BTCwolf (17%; $109k su un giro): il loro
  realizzato "senza il migliore" e' una frazione del totale.

**Le schede** (tutti i giri fomo, tutte le reti):

| utente | giri/g | tenuta mediana | capitale mediano | eta' token (Solana) | mcap all'ingresso | rete principale |
|---|---|---|---|---|---|---|
| bigbabba | 3,9 | 2 h | $2.516 | 2,6 h | $101k | Solana 50% |
| 0xBEC001 | 1,6 | 30 h | $4.998 | 5,4 giorni | $2,7M | Solana 68% |
| prevaile | 8,8 | **2 min** | $994 | 24 min | $42k | Solana 82% |
| seralberttrades | 4,5 | 11 h | $7.544 | 24 h | $615k | Robinhood 48% |
| bystevenr | 5,5 | 27 min | $995 | 1,0 h | $43k | Solana 56% |
| GenerationalFumbler | 4,1 | 7 h | $7.567 | 15 giorni | $2,3M | Robinhood 59% |
| TradeRansoze | 6,7 | 25 min | $2.998 | 2,3 giorni | $417k | Robinhood 58% |
| tontheneko | 7,5 | 21 min | $505 | 36 min | $90k | Solana 71% |
| BTCwolf | 3,8 | 3,7 h | $1.998 | 1,4 h | $314k | Robinhood 53% |
| kecoseh | 2,7 | 25 min | $3.499 | 20 h | $452k | Robinhood 55% |
| eth200000 | 3,6 | 9 h | $1.493 | 1,2 h | $312k | Robinhood 59% |

Nessuno entra nei primi minuti di vita del token; il piu' rapido (@prevaile) compra token di
mezz'ora e li tiene due minuti.

## 4. Come operano

13.520 giri chiusi puliti dei 170 (dati fomo, tutte le reti), $45,3M di capitale:

    vinti 31% · netto +$331k · resa pesata +0,7% · resa mediana −17,2%
    l'1% dei giri migliori fa il 64% del guadagno lordo; il 10% ne fa il 96%

**Eta' del token al primo acquisto (Solana, nascita on-chain):**

    eta'         giri   capitale   vinti   pesata   mediana
    <1 min        292      $154k     37%   +49,7%   −10,5%
    1-5 min       642      $425k     31%   +28,8%   −25,3%
    5-30 min    1.604     $1,94M     34%   +44,5%   −20,7%
    30m-6h      1.985     $3,90M     31%   +20,8%   −21,3%
    6h-1g         777     $2,07M     32%   −12,0%   −16,0%
    1-7g        1.195     $4,03M     32%   +12,4%   −14,4%
    7-30g         697     $2,82M     31%   −10,5%   −10,8%
    >30g          400     $2,13M     35%   +29,2%    −2,7%

**L'85% del capitale entra dopo i primi 30 minuti.** Per eta' mediana dei token comprati, su
135 utenti: 4 sotto i 5 minuti, 66 fra 5 minuti e 6 ore, 59 fra 6 ore e 7 giorni, 6 oltre.

**Capitalizzazione all'ingresso** (prezzo pagato × supply on-chain): il grosso fra $100k e $10M;
la fascia $10-100M ha la quota di vinti piu' alta (44%) e la mediana quasi nulla (−1,8%).

**Tempo in posizione** (tutte le reti): sotto le 24 ore ogni fascia e' negativa (−6% / −13%
pesato); 1-7 giorni +8,7%, oltre 7 giorni +31,1% con mediana −41%.

**Ordini spezzati.** Capitale mediano per giro $994; gli ordini grandi si spezzano in pezzi
uguali a pochi secondi l'uno dall'altro (@CVLM03: 389 acquisti da $498, 7 secondi di mediana
fra uno e l'altro). E' il modo di non muovere da soli pool da ~$1M di liquidita'.

**I solidi non operano in modo diverso dagli altri.** Stesse misure, 16 solidi contro gli altri
96 con almeno 10 giri:

                                        solidi        altri
    eta' mediana del token (Solana)     2,3 h         1,9 h
    mcap mediana all'ingresso           $93k          $122k
    tenuta mediana                      36 min        42 min
    giri sotto 10 min / oltre 1 giorno  31% / 14%     31% / 14%
    capitale mediano per giro           $1.346        $850
    giri al giorno                      3,8           2,4
    perso mediano / vinto mediano       −33% / +33%   −36% / +29%

Le uniche differenze sono di grado: un po' piu' grandi, un po' piu' attivi, perdite un po' piu'
corte, vincite un po' piu' lunghe. Lo stile, da solo, non distingue chi guadagna.

## 5. Il gregge dei big

I 170 toccano 7.272 token; 117 sono comprati da 10 o piu' di loro. I piu' affollati: SI (64),
HOOKED (39), PAID (35), un token di Robinhood Chain (34), e/acc (33), STONK (29), MASK (28). **I
giri migliori dei solidi cadono quasi tutti li'**: PAID per @seralberttrades, @kecoseh e
@0xBEC001; HOOKED per @BTCwolf, @kecoseh e @tontheneko; SI per @0xBEC001, @eth200000 (e @CVLM03).

Guardato a posteriori sembra la chiave:

    token comprato da...      giri   vinti   pesata
    solo lui                 4.640     26%   −21,6%
    10+ dei 170              1.955     42%   +19,9%
    primo dei 170 a entrare in un token poi comprato da 5+:   59% vinti, +36,2%

**Ma e' guardare il futuro**: un token diventa affollato *perche'* e' salito. Con la sola
informazione disponibile al momento dell'ingresso — quanti dei 170 erano gia' dentro nelle 6
ore precedenti — entrare dietro 5 o piu' big da' +43,3% pesato su 622 giri, e **togliendo il solo
SI scende a +6,6%; togliendo due token, −2,1%**. La quota di vinti resta un po' piu' alta
(37-38% contro 31%), i soldi no. I big convergono sugli stessi temi; seguirli dopo non paga.

## 6. La folla dietro i big

Ogni acquisto della folla fomo e' co-firmato da `AgmLJ…`, quindi si vede on-chain. Per 271
acquisti dei big ritrovati sulla catena, tutte le transazioni del token da 5 minuti prima a 15
minuti dopo, divise fra folla fomo e resto del mercato:

    finestra        acquirenti fomo/min   acquisti mercato/min   quota fomo
    prima                 11,0                  79,0              22,3%
    0-1 min               27,5                 120,7              26,8%
    1-5 min               10,8                  42,4              30,0%
    5-15 min               3,6                  19,9              27,4%

I big comprano **dentro un'impennata**: nel minuto del loro acquisto il mercato intero compra
1,5 volte piu' di prima. La folla fomo cresce un po' di piu' del mercato nel primo minuto (152
eventi su 257, test del segno p = 0,004), poi l'effetto sparisce, e dopo 5 minuti cresce meno.

**Non e' la notifica.** Se la folla seguisse il trader, la risposta crescerebbe coi suoi
follower. Non succede: eccesso medio +0,31 sotto 1.000 follower, +0,60 oltre 20.000,
correlazione +0,06, **p = 0,39**. Big e folla reagiscono alla stessa cosa nello stesso momento.

**I big non scaricano sui follower**: in 44 eventi su 271 rivendono entro 15 minuti, e la folla
fomo in quei minuti compra in mediana $2.355.

## 7. Scelti su una meta', misurati sull'altra

Giri chiusi prima del 26/09 (A) e aperti dopo (B), 88 utenti con almeno 5 giri in entrambe, in
terzi per resa in A:

    terzo        in A               in B
    peggiore     −25,8%  vinti 20%  −8,9%  vinti 29%
    centrale      −7,4%  vinti 31%  +6,3%  vinti 37%
    migliore     +12,7%  vinti 34%  +5,7%  vinti 36%

Il terzo migliore in B e' sotto il centrale; differenza fra estremi p = 0,10. **L'uscita a pezzi**
come abitudine (scelta in A, misurata in B) non prevede niente, p = 0,66. **Lo stile "token
giovani"** (eta' mediana sotto 30 minuti in A) fa +21,6% in B ma con 5 utenti positivi su 13, e
togliendo a ciascuno il giro migliore passa da +$228k a −$50k.

**Cautela:** B non e' vergine (i 170 sono scelti anche sul PnL a 7 giorni). La distorsione va a
favore di B.

## 8. In sintesi

1. **fomo e' un'interfaccia sopra DFlow, Relay, OKX e Jupiter**, con wallet veri ma nascosti, gas
   pagato da un co-firmatario unico, commissione dallo 0,3% al 3% secondo la dimensione
   dell'ordine, e piu' di meta' del capitale dei big fuori da Solana (Robinhood Chain in testa).
2. **La classifica premia chi ha posizioni grosse aperte nel giorno giusto.** Il realizzato
   on-chain e' ~11% del PnL dichiarato; meta' dei "migliori" non realizza nulla.
3. **I migliori veri sono pochi (16 su 112) e non hanno uno stile riconoscibile**: comprano token
   di ore o giorni, da $100k a $2M, tengono da minuti a ore, spezzano gli ordini. Li separa
   l'esito, non il metodo — e per meta' di loro l'esito e' uno o due colpi.
4. **Si muovono in branco sugli stessi temi**, ma arrivare dopo gli altri non paga.
5. **La folla fomo non li segue in modo misurabile**: compra con loro, non dietro di loro.

## 9. Controprove

| cosa | transazione |
|---|---|
| @cold: acquisto di 3.402.663,83 PRINTR via DFlow, firmato da "Fomo Co-signer" e dal wallet vero `D7LQ…` (fomo mostra `BoBd…`); due `TransferChecked` dopo lo swap = commissione | [fkx51ffc…](https://solscan.io/tx/fkx51ffcRJmooBdaNz8hBBXrH81W8auqmJAmNU2GEWPfc4gHL38srP2XkCRdqoVfmM3m6CVm3RrJvA4ik1J5wZz) |
| @pricedin: acquisto ZCAT, wallet vero `EU7F…` (fomo mostra `F4c8…`) | [64SH2NcK…](https://solscan.io/tx/64SH2NcK7woYorp2CtxSN7aFX34fCmboKAJE44dYP2NRSHth1TN8LT9tLkuuyvrm52NCou2759x7X7DEiHN7LGqL) |
| @OuterHeavyBat: wallet vero `49nv…` (fomo mostra `7gho…`) | [5hUw4rHf…](https://solscan.io/tx/5hUw4rHfgPUb2LRdFnj4ynoe4HHdRJZENHugp1rf8HgC1R28NxmKyBdRwLKkNqawLuAzyB1Gun1MvzAWvUc1jCyV) |
| @shootdown: firma da solo, senza co-firmatario | [q8RyUXpo…](https://solscan.io/tx/q8RyUXpo1HUPScx3wLGvJ4XFrQ6JaCyX5dkKKEUYXw1qAPfDRQjcv7YxwkqKrUkqQjXiY355Kzwnw27x7q3znCs) |
| commissione: @cryptorover vende per $5.015,54 secondo fomo, entrano 4.998,03 USDC | [UuQGZPQ6…](https://solscan.io/tx/UuQGZPQ6AiunwnDuTPNCtdbKANqYreLr6ArMUbLtQMZnrGjPzVmnszuuQcMApHqYnjpfpraQY98gH1AbwaAcdkS) |
| il vault delle commissioni | [R4rNJHaff…](https://solscan.io/account/R4rNJHaffSUotNmqSKNEfDcJE8A7zJUkaoM5Jkd7cYX) |

## 10. Limiti

- **Le altre catene non sono ricostruite on-chain**: per Robinhood Chain, BSC, Base ed Ethereum
  valgono i dati fomo, che su Solana si sono dimostrati fedeli a meno della commissione. La
  classifica dei solidi (§3) e' solo Solana.
- **Tetti di lettura.** 1.200 swap per utente dall'API (35 utenti l'hanno toccato); 4.000
  transazioni per wallet on-chain (9 wallet); nello studio della folla 163 eventi su 312 hanno
  la finestra troncata sui token piu' attivi, e i ritmi sono calcolati sulla parte letta.
- **La supply e' quella di oggi**: sui token con burn o mint successivi la capitalizzazione
  all'ingresso e' approssimata.
- **Trenta giorni.** Per molti utenti e' tutto il loro storico su fomo; per pochi e' una fetta.
