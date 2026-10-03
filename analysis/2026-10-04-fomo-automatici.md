# fomo.family: i trader automatici

**4 ottobre 2026.** Su 1.119 utenti con almeno 100 swap in 30 giorni (i 1.879 dello studio del
3/10 piu' i top 150 aggiornati), i segnali di automazione dagli swap fomo e dalla catena.
Metodo in `docs/analisi-wallet.md` §5c.

## 1. Il risultato

    gruppo             come si riconosce                               utenti   capitale   resa    positivi
    macchina           >=100 giri chiusi, tenuta mediana <= 3 min       28       $1,4M     +0,4%     29%
    iperattivo         >=100 swap al giorno, tenute piu' lunghe          50       $6,8M     −3,3%     20%
    chiave esportata   >50% degli swap firmati dal wallet, senza fomo     5       $1,3M     −7,1%     40%
    altri                                                              1.036     $206,8M    −5,0%     25%

Giri chiusi dagli swap fomo (le macchine tengono minuti: le posizioni aperte non cambiano il
conto). L'unica macchina che guadagna davvero e' @Nichequantelsa: +$203k su $3,4M on-chain in
30 giorni (6.056 giri, tenuta mediana 47 secondi, un giro su quattro chiuso entro 30 secondi,
fino a 20 operazioni al minuto).

## 2. Cosa non c'e'

- **Nessuno opera 24 ore su 24.** La pausa piu' lunga di ogni giornata attiva e' di 9-10 ore in
  mediana in ogni gruppo, mai sotto le 4: sessioni, non un programma sempre acceso.
- **Nessun copy-trading.** Per ogni utente, il "leader" che lo precede piu' spesso di 0-30
  secondi sullo stesso token: la coppia piu' forte e' 22 su 198 primi acquisti, con 11 casi
  nel verso opposto. @macdegods segue @frankdegods 8 volte su 474.
- **Poca firma esterna.** 30 wallet su 1.265 firmano da soli piu' del 5% degli swap; 5 piu'
  della meta'. Nessuno di loro e' fra i veloci: le macchine sono co-firmate da fomo.
- **Nessun acquisto abituale alla nascita del token** (gia' nello studio del 3/10).

## 3. Trappola: le taglie ripetute

$498, $995 e $99 ricorrono perche' sono i bottoni preimpostati dell'app ($500, $1.000, $100)
al netto della commissione. Una raffica di ordini uguali a pochi secondi e' lo stesso bottone
premuto piu' volte, non un programma.

## 4. Domanda aperta

Se fomo offre ordini automatici (take-profit, stop-loss, limit), le macchine possono esserne il
prodotto. Lo swap dell'API non porta il tipo di ordine e l'app web (151 KB di script) non ne fa
menzione: va guardato nell'app mobile.

## 5. Limiti

- L'API restituisce al massimo 1.500 swap per utente (60 pagine): per i piu' attivi la finestra
  e' di pochi giorni, e il risultato fomo di @Nichequantelsa (+$19,5k su $220k) e' quello degli
  ultimi tre giorni; il dato a 30 giorni e' quello on-chain del 3/10.
- La firma si legge solo dove c'e' la storia on-chain (1.265 wallet con almeno 30 swap).
