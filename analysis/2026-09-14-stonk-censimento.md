# stonk.fun — il censimento, e cosa si puo' chiudere

**14 settembre 2026.** 211.831 scambi · 1.182 curve estratte a caso · 26.581 portafogli ·
30.757 giri completi (comprato e rivenduto). Piu' le storie complete di 31 portafogli seguiti
uno per uno, e 103 creazioni cronometrate passaggio per passaggio.

Tutto ricostruito on-chain dall'evento di scambio di LaunchLab: importi da `amount_in` /
`amount_out`, mai dedotti dai saldi. Il dettaglio del metodo sta in `docs/stonk-fun.md`.

---

## 1. Il mercato: a somma negativa, e si sa di quanto

    entra a         giri   in guadagno   mediano     medio   peggiore
    0,0-0,5%         827     445/827      +1,6%    +23,5%    -25,5%
    0,5-1,0%         196      78/196      -1,8%     +8,0%     -8,9%
    1,0-2,5%         661     244/661      -2,9%    +10,1%    -33,1%
    2,5-5%          1190    430/1190      -4,4%    +10,3%    -63,5%
    5-10%           2902   1058/2902      -4,9%     +6,9%    -75,8%
    10-20%          5698   2081/5698      -6,5%     +2,0%    -71,0%
    20-35%          8116   3007/8116      -9,1%     -5,4%    -77,3%
    35-60%          8346   2429/8346     -17,3%    -16,0%    -87,5%
    60-101%         2821    382/2821     -32,9%    -32,9%    -91,5%

**La curva mediana arriva al 9,6% del suo bersaglio. Su 1.182 curve non ne e' migrata nessuna.**
600 non superano mai il 10%. Il partecipante tipico perde, e la perdita e' dell'ordine del costo
di andata e ritorno misurato (3,3% senza tassa, 5,4% con l'1%, 9,2% con il 3%).

Il rendimento medio scende in modo monotono con la fascia d'ingresso: da +23,5% a -32,9%.

## 2. Perche' nessuna strategia copre i costi

Simulando la cosa piu' semplice — entrare dietro a ogni acquisto di chiunque, 70.450 occasioni —
**il prezzo dopo un acquisto sale davvero**, da +0,9% a +3,5% lordo secondo quanto si tiene. Ma:

    uscita            SENZA costi   costo 5,4%   costo 3,3% (tassa 0)
    esci a 3s           +0,9%         -4,5%          -2,4%
    esci a 10s          +1,9%         -3,5%          -1,4%
    esci a 60s          +3,5%         -1,9%          +0,2%

**Il pedaggio e' piu' grande del segnale.** E il nostro ritardo si mangia il resto: la stessa
regola a ritardo zero fa +4,7%, con i nostri due secondi +0,2%. **I due secondi valgono 4,5 punti.**

Questo spiega senza bisogno d'altro il mediano della popolazione, i filtri sulla curva che
selezionano bene senza attraversare lo zero, e il fatto che l'unica fascia che paga sia il blocco
di nascita — li' il movimento lordo e' molto piu' grande del pedaggio.

## 3. Il vantaggio dei bravi sta nell'uscita, non nella scelta

Due fatti che insieme lo dimostrano. **La bravura esiste** (scelti sulla prima meta' del tempo,
misurati sulla seconda, su 21.728 giri):

    scelti perche' in guadagno (>=3 giri)   386 portafogli   1.717 giri   +2,8% medio
    controllo: quelli in perdita            489 portafogli     938 giri   -7,4% medio

Dieci punti di distacco, stabili a tutte le soglie provate. **Ma copiare i loro acquisti rende
-7%**, identico a chi li scarta. Quindi il vantaggio non e' nello scegliere il token.

La prova diretta: per ogni loro giro, il rendimento vero contro una regola meccanica applicata
allo **stesso ingresso**, stessa curva, stesso istante:

    I BRAVI (267 portafogli, 1.114 giri)     mediano    medio
    quello che hanno fatto LORO               -4,3%     +2,4%
    regola meccanica +25% / -15% / 60s       -15,0%     -1,8%
    regola meccanica +60% / -20% / 600s      -20,0%     -0,4%

    GLI SCARSI (332 portafogli, 617 giri)     mediano    medio
    quello che hanno fatto LORO               -8,3%     -4,4%
    regola meccanica +25% / -15% / 60s        +0,0%     +2,5%

**I bravi battono ogni regola meccanica sui propri ingressi; gli scarsi fanno peggio di una
regola meccanica sui propri** — comprando le stesse cose e applicando una regola fissa
guadagnerebbero invece di perdere. Il metro e' perfino prudente a favore della conclusione: il
rendimento loro e' al netto delle commissioni del pool, quello meccanico e' lordo.

Spiega anche perche' copiarli non funziona: si copia l'acquisto e poi ci si applica la **propria**
uscita, che e' quella meccanica.

**Su cosa escono.** Non su un livello di prezzo (per entrambi il prezzo nei 10s precedenti e'
fermo a +0,0%):

                                  BRAVI              SCARSI
                           vendono  restano    vendono  restano
    scambi nei 10s prima      10       15          3       13
    volume comprato         5,55%    4,77%      0,04%    3,20%
    la compra piu' grossa   1,74%    1,50%      0,04%    1,17%

**I bravi vendono dentro il movimento, gli scarsi nel vuoto.** Tenuta mediana: 13 secondi contro
66. Taglia e numero di operazioni non li distinguono.

## 4. Il nostro ritardo, cronometrato

103 creazioni, passaggio per passaggio:

    dal blocco alla notifica              1,01s   <- non riducibile con logsSubscribe
    + leggere la transazione              0,53s   <- ELIMINATO (la pool sta nel log, offset 8)
    + leggere lo stato del pool           0,05s
    TOTALE                                1,54s -> ~1,0s

Effetto della correzione: la raccolta al momento in cui riusciamo a leggere una curva passa da
**4,33% a 1,12%**, e da 88% di nascite gia' oltre soglia a 10 su 15 sotto. Ma restiamo a ~2,5 slot
dal blocco, e il censimento dice che sotto lo 0,5% ma oltre un paio di slot si fa **0 vincite su 7**.
Vediamo il prezzo giusto, non siamo nel blocco giusto.

## 5. Quello che NON si puo' chiudere, e perche'

**Tre effetti su tre si sgonfiano passando dalla prima alla seconda meta' della giornata:**

| effetto | 1a meta' | 2a meta' |
|---|---|---|
| curve lente contro veloci | +12,5% contro +3,3% | -0,2% contro -9,7% |
| uscita sul compratore grosso | +16,1% contro +4,7% | -8,2% contro -9,3% |
| livello assoluto di qualunque regola | positivo | negativo |

Il **vantaggio relativo** regge (le lente battono le veloci di ~9 punti in entrambe le meta'); il
**livello assoluto** no. Non e' rumore di campionamento: le due meta' della giornata sono due
mercati diversi, e il livello generale domina qualunque segnale.

**Abbiamo un giorno solo.** Qualunque numero sull'intera giornata media due regimi; qualunque
numero su meta' ha meta' campione. Nessuna analisi aggiuntiva su questi dati lo risolve: servono
giorni diversi, non piu' elaborazione degli stessi.

## Conclusione operativa

**Su stonk.fun, con la nostra latenza, non esiste una strategia che copra i costi.** Il segnale
lordo e' +1/+4,7%, il pedaggio 3,3/9,2%, e i due secondi di ritardo valgono 4,5 punti. L'unica
fascia profittevole e' il blocco di nascita, che richiede di vedere la creazione a livello di
shred e spedire da vicino a un leader: infrastruttura che non abbiamo.

Quello che resta acquisito e vale su qualunque launchpad: il decoder dell'evento (dati per ogni
scambio a costo zero, senza polling), il metodo del censimento (partire dalle curve, mescolarle,
ricostruire ogni portafoglio), e la disciplina che ha corretto sei conclusioni sbagliate in un
giorno — campione casuale, prova fuori campione, e contare le curve invece delle posizioni.

**Se si volesse riprendere**, la cosa da fare non e' altra analisi: e' lasciar girare il daemon
(ora corretto) per giorni e rifare il confronto fra regimi diversi.

---

*Dati grezzi nello scratchpad di sessione (`censimento.json` 67 MB e affini): spariscono con la
sessione. I risultati derivati sono tutti qui e in `docs/stonk-fun.md`.*
