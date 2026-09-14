# I 100 token nuovi di gmgn, e chi ci guadagna davvero

**14 settembre 2026.** Fuori dal perimetro di stonk.fun: i 100 token piu' recenti visibili su
gmgn (70 pump.fun, 29 Raydium LaunchLab, 1 Meteora), i portafogli che ci compaiono fra i primi
per profitto, e la ricostruzione **on-chain** di cosa fanno davvero.

    scelta dei token   100 token, creati nelle ultime 24 ore, almeno 40 scambi e 40 minuti di vita
    screening          10.000 righe di trader (i primi 100 per profitto di ogni token) -> 6.785 portafogli
    candidati          161 portafogli che compaiono in 3 o piu' token (681 ne compaiono in >=3, 27 in >=10)
    verifica on-chain  83.578 mosse · 21.579 posizioni · 14.856 giri chiusi · 6.140 token distinti

**Il metodo e' agnostico rispetto al DEX**: non si decodifica nessun evento di nessun programma,
si guardano i saldi. Quanto SOL gli e' entrato o uscito davvero (`postBalances[0] - preBalances[0]`
piu' il movimento del suo WSOL), quale token e quanto (differenza dei suoi token account), e su
quale programma (le righe `Program <id> invoke [1]`). Il conto e' cosi' al netto di commissioni,
priority fee e rent: e' il profitto vero, non una stima.

---

## 1. Due cose che gmgn dice e che non sono vere

**Il `creation_timestamp` delle classifiche non e' la nascita del token**, e' quella della pool
che gmgn sta mostrando. Su 48 token su 100 differisce, e on-chain si vedevano acquisti fino a 40
minuti *prima* della presunta creazione — tutti su token migrati, dove la pool attuale e' nata
dopo. La nascita vera sta in `/api/v1/token_info/sol/<mint>`, e si verifica da sola: su PILLS il
primo acquisto on-chain cade **1 secondo dopo**, contro i −1.052 secondi del campo sbagliato.
Senza questa correzione ogni misura sul ritardo d'ingresso e' sbagliata di minuti.

**"I primi 100 per profitto" non dice niente sul mercato.** Sono selezionati per profitto: che
siano in guadagno e' la definizione, non un risultato. Servono per scegliere *chi guardare*. Il
segnale vero e' la **ricorrenza**: chi compare in tre token diversi non e' stato fortunato.

## 2. Meta' dei "portafogli vincenti" non guadagna

Presi gli 85 candidati con almeno 5 giri chiusi — tutti segnalati da gmgn come fra i primi 100
per profitto in 3 o piu' token — e misurato il loro **libro intero** delle ultime 30 ore:

    in guadagno   44      in perdita   41
    SOL netto dei vincenti  +1.261      dei perdenti  −589
    per portafoglio: 10% −16,6 · mediana +1,4 · 90% +42,4 · massimo +253,1 SOL

Le due misure indipendenti (saldo vero del conto, e solo i giri aperti e chiusi dentro la
finestra) sono d'accordo su 67 portafogli su 85. **Comparire fra i primi per profitto su qualche
token e' quasi privo di valore predittivo sul resto.**

## 3. La forma del guadagno: pochissime posizioni

    posizioni chiuse 14.856 · in guadagno 5.316 (36%)
    guadagno lordo +2.893 SOL · perdita lorda −2.771 SOL · netto +122 SOL
    l'1% di posizioni migliori fa il 33% del guadagno lordo
    il 10%                    ne fa l'83%
    resa mediana −6,7%  ·  resa pesata sul capitale +0,6%

Su 6.140 token toccati, 1.835 in guadagno e 4.305 in perdita; i 10 migliori valgono +368 SOL.
**Il mestiere non e' avere ragione, e' sopravvivere abbastanza a lungo da prendere il colpo.**

Attenzione alle medie: la media semplice delle rese e' +15%, ma la fanno una manciata di
posizioni da 0,02 SOL che moltiplicano per cinquanta. L'unica media onesta e' quella pesata sul
capitale (SOL usciti / SOL entrati), ed e' **+0,6%**.

## 4. Entrare presto paga, e si misura

Su 3.630 giri di cui conosciamo la nascita vera del token:

    ritardo        giri   in guadagno   resa med   resa pesata   SOL netto
    0-1s            116       78%        +34,0%      +58,8%        +80
    1-5s            260       60%        +12,2%      +43,3%       +169
    5-30s           951       50%         −0,2%      +14,6%       +320
    30-120s         657       47%         −2,3%       +0,2%         +3
    120-600s        958       51%         +0,6%       +7,3%       +149
    600-3600s       515       44%         −4,0%       +0,7%         +7
    oltre un'ora    173       27%         −8,5%      −11,6%        −46

La quota di giri in guadagno scende senza eccezioni, da 78% a 27%. **Presto (<30s) contro tardi
(>600s): 14,2 punti di scarto sulla quota di giri vinti e 23,9 sulla resa pesata, p < 0,0001** su
test di permutazione a 20.000 giri.

**E regge nel tempo.** Sul censimento di stonk.fun tre effetti su tre si sgonfiavano passando
dalla prima alla seconda meta' della giornata. Qui no:

| | 1a meta' | 2a meta' |
|---|---|---|
| entra entro 30s | +17,3% | +23,6% |
| entra dopo 600s | +1,4% | −5,2% |

## 5. Uscire a scaglioni e' un esito, non una strategia

Per posizione la relazione e' fortissima:

    vendite   giri     in guadagno   resa med   resa pesata   tenuta med
    1        10.551       28%         −10,0%      −10,0%         16s
    2         1.901       44%          −3,1%       −1,4%        117s
    3-5       1.459       59%          +4,6%       +8,4%        168s
    6-10        736       65%          +6,4%      +23,3%         43s
    11+         209       78%         +27,1%      +25,9%        485s

34,7 punti di scarto, p < 0,0001. **Ma per portafoglio la differenza sparisce**: chi ha
l'abitudine di uscire a scaglioni rende +0,6% pesato, chi esce in una volta rende +0,6%. Si
riesce a vendere dieci volte solo se il prezzo regge: la relazione e' vera e inutile.

E' la stessa trappola gia' documentata su stonk.fun con la tenuta breve. La regola: quando una
caratteristica dell'uscita predice il risultato, misurarla sul portafoglio prima di crederci.

## 6. Su quali programmi

Identificazione empirica, non indovinata — incrociando l'etichetta che gmgn da' al portafoglio
con il programma che invoca davvero al primo livello:

| programma | portafogli | etichetta gmgn |
|---|---|---|
| `FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9` | 32 | **axiom: 32 su 32** |
| `term9YPb9mzAsABaqN71A4xdbxHmpBNZavpBiQKZzN3` | 8 | **padre: 8 su 8** |
| `GMGNreQcJFufBiCTLDBgKhYEfEe9B4`, `GMgnVFR8Jb…` | 2 | gmgn |
| `DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH` | 2 | DFlow / bullx |
| otto programmi diversi | 1 ciascuno | nessuna — **codice proprio** |

Corrispondenza perfetta sui due router principali: 32 su 32 e 8 su 8.

**E il guadagno per attrezzo:**

    attrezzo              portaf.   giri   giri vinti   SOL sui giri chiusi
    Axiom                    41     4.728     32%           −78
    Padre                     9     1.216     30%          −107
    diretto sul DEX          12     3.779     39%           +48
    router privati            8     2.500+    35-52%       +200 circa

**I terminali a pagamento non danno vantaggio.** Chi guadagna in modo consistente passa da codice
proprio o va diretto sul programma del DEX.

## 7. Cinque modi diversi di guadagnare

Non esiste *il* modo. Cinque dei portafogli piu' redditizi, tutti in guadagno, non hanno quasi
niente in comune:

| portafoglio | SOL | attrezzo | puntata | tenuta | ritardo | giri vinti |
|---|---|---|---|---|---|---|
| `5hAgYC8T…` | +253 | Padre | 2,0 SOL | 62s | 32s | 62% |
| `7JVQMwRj…` | +182 | Jupiter | 1,3 SOL | 25s | **417s** | 50% |
| `4DdrfiDH…` | +106 | privato `6Vo…` | **3,00 fisso** | 32s | **817s** | **95%** |
| `AMDEmVoc…` | +66 | privato `DDDD…` | 0,51 SOL | **7s** | **0s** | 34% |
| `8CSqCUg4…` | +32 | privato `AURA…` | 3,1 SOL | 196s | 1.056s | 57% |

Due entrano nel blocco di nascita, tre entrano minuti dopo. `AMDEmVoc` tocca **1.404 token in 30
ore** tenendoli 7 secondi: e' un'industria. `8CSqCUg4` ne tocca 30 e i suoi 5 colpi migliori
valgono il 58% del guadagno.

**`4DdrfiDH` va guardato con sospetto**: 95% di giri vinti, puntata sempre esattamente 3,00 SOL,
perdita massima 1,1 SOL, ed entra tredici minuti dopo la nascita. Non e' arbitraggio atomico (la
tenuta minima e' 2 secondi). Un vantaggio cosi', senza velocita', non e' abilita': e'
informazione. gmgn lo etichetta `pump_smart` e `wash_trader`. **Non e' replicabile.**

Ne' la dispersione ne' la taglia distinguono i vincenti: a pioggia +142 SOL contro −73 di chi
mira; puntate grosse +79 contro +42 delle piccole, con quote di giri vinti fra 34% e 42%.

## 8. Portafogli diversi, stessa mano

Cercando chi compra gli stessi token nello **stesso secondo** si trovano subito grandi
agglomerati — ma buona parte e' un artefatto: due bot che corrono lo stesso lancio comprano
insieme senza avere niente a che fare l'uno con l'altro. Restringendo alle sole coincidenze
**fuori dalla corsa iniziale** (token gia' vecchio di 30 secondi) restano 4 gruppi veri:

    3 conti · 303 giri · +18 SOL     3A722kkc  3M8QAq8x  6yeiZ2sK   (16 token su 16, al secondo)
    2 conti · 347 giri · +435 SOL    5hAgYC8T  7JVQMwRj
    2 conti · 354 giri · +102 SOL    4DdrfiDH  4zBysSt9
    2 conti · 273 giri · −5 SOL      EDXHdSFd  5PE3gSfy

## 9. Cosa significa per noi

    fascia d'ingresso        giri    SOL netto   quota del netto
    nel blocco di nascita     116       +80          12%
    da 1 a 5 secondi          260      +169          25%
    da 5 a 30 secondi         951      +320          47%
    oltre 30 secondi        2.303      +113          17%

**L'83% del guadagno netto viene da ingressi entro 30 secondi**, e la fascia migliore in resa
pesata non e' il blocco di nascita ma **da 1 a 5 secondi** (+43,3%, 60% di giri in guadagno),
seguita da 5-10s (+32,7%). Spezzata piu' fine:

    1-2s      65 giri · 68% in guadagno · resa pesata +34,5%
    2-5s     195 giri · 57%              · resa pesata +45,8%
    5-10s    319 giri · 56%              · resa pesata +32,7%
    10-30s   632 giri · 47%              · resa pesata  +7,7%

**Questo e' l'opposto di stonk.fun**, dove l'unica fascia profittevole era il blocco di nascita e
due secondi di ritardo valevano 4,5 punti di perdita. Su pump.fun e Raydium LaunchLab, con volumi
molto maggiori, la finestra utile e' larga secondi, non millisecondi. La nostra latenza misurata
(≈1,0s dal blocco, `docs/controls.md`) cade **dentro la fascia migliore**.

Tre avvertenze prima di crederci fino in fondo:

1. **Il campione e' scelto fra portafogli gia' profittevoli.** Il gradiente fra le fasce e'
   interno allo stesso gruppo selezionato ed e' valido; il *livello* assoluto no. Che le fasce
   tardive siano in perdita **nonostante** la selezione e' pero' un'informazione forte.
2. **Solo 3 portafogli su 80** hanno un ingresso tipico entro 5 secondi. Quella fascia e' poco
   popolata anche fra chi guadagna: e' una nicchia, non la norma.
3. **Un giorno solo.** Qui, a differenza di stonk.fun, gli effetti reggono in entrambe le meta'
   della finestra — ma restano 30 ore.

## Conclusione operativa

Il passo successivo non e' altra analisi di questi dati: e' **portare il daemon su pump.fun e
Raydium LaunchLab** (dove stonk.fun e' solo una delle piattaforme sullo stesso programma
LaunchLab, gia' decodificato) e misurare in paper trade la fascia 1-10 secondi, che e' l'unica
che la nostra latenza puo' raggiungere e che qui risulta la piu' redditizia.

Quello che **non** va fatto: copiare i portafogli. Il vantaggio dei migliori o e' velocita' che
non abbiamo (blocco di nascita), o e' informazione che non abbiamo (`4DdrfiDH`), o e' un router
scritto da loro.

---

*Grezzo nello scratchpad di sessione (`mosse.json`, 83.578 mosse): sparisce con la sessione.
Script: `portafogli.js` (scarico agnostico), `conti-nuovi.js` (conti e guardie), `profilo.js`,
`gruppi.js`, `ritratto.js`.*
