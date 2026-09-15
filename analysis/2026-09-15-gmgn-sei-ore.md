# Sei ore di gmgn, tutti i token, e i portafogli che ci guadagnano

**15 settembre 2026.** 160 token — *tutti* quelli comparsi nelle classifiche di gmgn fra le
16:02 e le 22:06 UTC del 14 settembre, non un campione · 8.559 portafogli che gmgn dichiara
in guadagno su almeno uno di quei token · 350 estratti a caso dentro tre strati e **344
ricostruiti on-chain transazione per transazione**: 90.914 mosse, 22.927 posizioni, 16.751
giri chiusi.

Il metodo di lettura e' quello di `docs/programmi.md`: nessun evento decodificato, solo saldi.
gmgn serve a decidere *chi* guardare; ogni numero qui sotto e' ricostruito dalla catena.

---

## 1. Come si prendono davvero "tutti" i token di sei ore

Le classifiche di gmgn si fermano a 100 righe, e questo aveva limitato lo studio precedente.
Ma l'API accetta un filtro temporale **al minuto** (`min_created` / `max_created`): tagliando
le sei ore in fette da dieci minuti e ripetendo su tutti e cinque i bacini (1m, 5m, 1h, 6h,
24h), nessuna fetta si avvicina al tetto di 100. L'enumerazione e' completa.

    104 pump · 50 Raydium LaunchLab · 5 stonk.fun · 1 Meteora     = 160 token
    73 gia' migrati su una pool vera · 144 creatori distinti, 10 con piu' di un lancio
    picco di capitalizzazione: mediana $42k · 26 superano $100k · 4 superano $1M

**Sono ~27 token all'ora, e pump.fun da solo ne crea migliaia.** Questo non e' l'universo di
cio' che nasce: e' l'universo di cio' che gmgn mostra, cioe' di cio' che ha avuto scambi veri.
E' l'universo giusto per cercare portafogli, ed e' quello che si vede sul sito, ma va detto.

Per ciascun token ho preso i suoi primi 100 per profitto: 15.609 righe, **8.559 portafogli
distinti** con profitto dichiarato. Ricorrenza molto sbilanciata: 6.203 compaiono su un token
solo, 589 su quattro o piu', uno su ventisette.

Il campione e' stratificato sulla ricorrenza (1 token: 6.203→120 · 2-3: 1.767→90 · ≥4: 589→140),
estratto a caso dentro ogni strato, e i pesi sono ricalcolati sui portafogli davvero
ricostruiti. Copertura: 118/120, 89/90, 137/140.

## 2. Meta' dei "vincenti" di gmgn non guadagna

Ripesato sull'universo degli 8.559:

    in guadagno sul saldo vero del conto        49%
    in guadagno sui soli giri chiusi            39%
    saldo mediano per portafoglio             0,00 SOL   (10° -7,6 · 90° +13,8)

Sui 16.751 giri chiusi: **32% in guadagno**, lordo vinto +3.437 SOL, lordo perso −3.076,
**netto +361 SOL su 20.502 di capitale rigirato: +1,8% pesato, −8,3% mediano.**
L'1% di posizioni migliori vale il 48% di tutto il guadagno lordo; il 10% ne vale il 90%.

Le cautele scartano 5.297 posizioni su 22.927 (23%): 394 vendute senza essere state comprate
in finestra, 1.691 arrivate per trasferimento, 3.212 comprate dentro transazioni con piu' token.

## 3. La prova della selezione — e' qui che si decide tutto

Ogni portafoglio e' entrato nel campione perche' gmgn lo elencava fra i primi 100 **di almeno
un token**. Su quel token il suo risultato e' scelto per essere positivo. Ma gli stessi
portafogli hanno operato anche su altri token delle stesse sei ore, e su migliaia di token
fuori: li' nessuno li ha scelti.

    insieme                                   giri   vinti   SOL netto   resa pesata
    token per cui gmgn LI HA SCELTI            853     94%      +1.442        +69,5%
    altri token delle stesse sei ore         1.808     29%        −390        −12,5%
    tutto il resto del loro libro           14.090     29%        −691         −4,5%

Gli stessi 245 portafogli, guardati due volte: **97% in guadagno sui token per cui sono stati
scelti, 28% su tutto il resto.** +1.225 SOL da una parte, −719 dall'altra.

Non e' un dettaglio metodologico: e' il risultato principale. L'etichetta "portafoglio
vincente" di gmgn descrive *un token*, non un portafoglio. Copiare chi compare in quelle liste
significa copiare qualcuno che, su tutto quello che fa d'altro, perde.

## 4. Entrare presto non paga: paga aver azzeccato il token

Sull'insieme completo il gradiente e' bellissimo e monotono — ed e' esattamente quello che
avevo concluso il giorno prima sui 100 token:

    ritardo      giri   vinti   resa pesata          ritardo      giri   vinti   resa pesata
    0-1s           23     74%       +216,4%          120-600s      759     49%        +14,8%
    1-5s          149     60%        +85,9%          600-3600s     577     46%         +5,7%
    5-30s         453     55%        +38,5%          oltre         246     38%         +3,2%
    30-120s       454     54%        +28,2%

**Togliendo i token della selezione, il gradiente sparisce.** Sugli stessi token delle stesse
sei ore, per i portafogli che su quel token gmgn non aveva eletto:

    0-5s      84 giri   27% in guadagno   −23,8% pesato       <- la fascia PEGGIORE
    5-30s    285 giri   29%                −4,5%
    30-120s  291 giri   30%               −14,7%
    120-600s 546 giri   32%               −15,4%
    oltre 600s                             −11,9% / −7,6%

Prova di permutazione (20.000 rimescolamenti) su presto <30s contro tardi ≥600s, **solo fuori
dalla selezione**: quota in guadagno 1,9 punti, p = 0,56 · resa pesata 1,4 punti, p = 0,78 ·
resa mediana −3,4 punti, p = 0,06 (a sfavore del presto). Dentro la selezione lo stesso
confronto da' 97% contro 88% e +121% contro +30%.

**Correzione di `analysis/2026-09-14-gmgn-100-token-nuovi.md`:** li' avevo scritto che entrare
entro 1-5 secondi rende +45,8% pesato, che l'effetto era stabile nelle due meta' della finestra
e che il nostro ritardo di ~1,0s cade nella fascia buona. Il campione era selezionato allo
stesso modo, e la stabilita' nelle due meta' non protegge da questo: la selezione agisce in
entrambe. **Quel risultato era un artefatto della selezione.** Entrare presto e' una
*conseguenza* dell'aver comprato il token che poi e' salito, non una causa del guadagno.

## 5. Uscire a scaglioni, invece, regge

Stesso trattamento, esito opposto:

    insieme                     uscita            giri   vinti   resa pesata
    token selezionati           in una volta       380     91%        +38,7%
    token selezionati           in 3+ pezzi        324     97%        +82,8%
    altri token delle sei ore   in una volta     1.166     25%        −20,6%
    altri token delle sei ore   in 3+ pezzi        345     45%         −0,6%
    tutto il resto del libro    in una volta    10.849     23%        −14,2%
    tutto il resto del libro    in 3+ pezzi      1.527     59%        +15,9%

L'effetto sopravvive dove la selezione non aiuta, e sui conti interi: i 93 portafogli che
escono a scaglioni fanno +2,8% pesato e +273 SOL, i 93 che escono in un colpo −7,1% e −212 SOL.

Resta pero' vero che la direzione della causa non e' dimostrata: si esce in cinque pezzi solo
se la posizione dura e sale. E' l'unico segnale che non si e' sgonfiato, non e' una strategia
dimostrata.

## 6. Su quali programmi — e i terminali a pagamento non danno vantaggio

Fuori dalla selezione, dove i numeri non sono scelti:

    attrezzo            portaf.   giri   vinti   SOL netto   resa pesata
    Axiom                   149  6.151     27%      −797,3        −8,6%
    DIRETTO SUL DEX          52  3.683     26%       +25,3        +1,2%
    Padre                    38  1.374     29%       −91,4        −5,8%
    router privato 6Vo       38  1.222     34%       −98,7        −6,6%
    Jupiter                  74  1.172     30%      −101,0        −5,9%
    gmgn                     22    886     30%       −32,0        −5,4%
    DFlow/bullx              35    105     23%       −14,0       −13,0%

**Axiom e' il piu' usato e il peggiore.** L'unica riga non negativa e' andare dritti sul DEX.
Non e' una prova che il router costi quei punti (chi lo usa fa anche trade diversi), ma e' la
smentita piu' netta possibile dell'idea che l'attrezzo a pagamento porti un vantaggio.

Identificazioni confermate incrociando programma on-chain ed etichetta gmgn del portafoglio
(metodo di `docs/programmi.md`, campione molto piu' grande di prima): **Axiom 160/160 utenti
etichettati axiom · Padre 46/46 · gmgn 27/27 e 19/19 su due programmi · Trojan 7/7 e 4/4.**
Due correzioni: `proVF4pMXVaY…` e `6Vo3245eszAb…`, che avevo classificato come codice privato
di un solo portafoglio, sono usati da 76 e 45 conti. E due indirizzi che leggevo come router
sono DEX: `LBUZKhRxPF3…` (Meteora DLMM) e `cpamdpZCGKUy…` (Meteora CP-AMM).

## 7. Dove stanno i soldi: sui token gia' migrati

    lanciatore                 giri   vinti   SOL netto   resa pesata
    ray_launchpad (migrato)     620     50%      +537,6        +33,7%
    pump (migrato)              787     55%      +331,3        +19,5%
    stonk.fun (migrato)         100     51%      +126,1        +30,4%
    pump (curva)                900     47%       +56,2         +5,0%
    ray_launchpad (curva)       226     42%        +0,3         +0,1%
    stonk.fun (curva)            19     47%        −0,7         −1,9%

91 dei 158 token toccati hanno dato saldo positivo a chi ci ha operato; i dieci migliori valgono
+924 SOL, i dieci peggiori −172. Anche qui la sopravvivenza spiega quasi tutto: un token migra
*perche'* e' salito. Non e' una regola d'ingresso, e' una descrizione di dove e' finito il denaro.

## 8. Stessa mano, piu' conti

Restringendo alle compre dello stesso token nello stesso secondo su token gia' vivi da oltre
30 secondi (fuori dalla corsa iniziale, dove i bot indipendenti si accavallano per forza):
**6 gruppi**. Il piu' grande sono 3 conti, 441 giri, +82,9 SOL. Un altro gruppo di 2 conti
perde 60,9 SOL. Avere piu' conti non e' di per se' un segno di bravura.

## 9. Cosa ne viene per noi

1. **La lista dei "portafogli vincenti" non e' una fonte.** Descrive un token, non una persona.
   Su tutto il resto del loro libro quegli stessi conti perdono il 71% delle volte.
2. **La velocita' non e' il vantaggio che sembrava.** Fuori dalla selezione entrare nei primi
   cinque secondi e' la fascia peggiore. Questo *toglie* urgenza al lavoro sulla latenza: non
   c'e' un premio misurabile ad arrivare primi, su questo universo e in questa finestra.
3. **L'unico segnale sopravvissuto riguarda l'uscita**, ed e' lo stesso di stonk.fun: chi esce
   a pezzi fa meglio di chi esce in un colpo. Anche li' era l'uscita, non la scelta del token.
4. **Nessun terminale compra un vantaggio.** Andare dritti sul DEX e' l'unica riga non negativa.
5. Il mercato resta a somma quasi zero anche per i selezionati-per-vincere: +1,8% pesato,
   −8,3% mediano, e il 90% del guadagno lordo in un decimo delle posizioni.

**Quello che non si puo' chiudere.** Sei ore sono una finestra sola: lo studio di stonk.fun ha
gia' mostrato che il livello generale cambia fra due meta' della stessa giornata. E i portafogli
sono comunque una popolazione selezionata (compaiono tutti in qualche classifica): il confronto
dentro/fuori selezione e' onesto sul *relativo*, non dice quanto guadagna un trader qualunque.

---

*Dati grezzi nello scratchpad di sessione (`mosseTutte6h.json` 53 MB, `universo6h.tsv`,
`trader6h.json`, `campione6h.tsv`): spariscono con la sessione. Gli script della catena sono
`portafogli.js` → `conti6h.js` → `mercato6h.js` / `profilo6h.js` / `selezione.js` /
`attrezzi6h.js` / `gruppi6h.js`.*
