# fomo.family on-chain: 1.879 utenti, Solana e Robinhood Chain

**3 ottobre 2026.** Seconda passata, molto piu' larga della prima
(`analysis/2026-10-03-fomo-classifica.md`, 170 utenti, solo Solana): **tutti i 379 utenti
delle classifiche e 1.500 utenti estratti a caso dalla folla**, ricostruiti dalla catena su
Solana *e* su Robinhood Chain, dove sta piu' di meta' del capitale. Finestra: gli ultimi 30
giorni. Metodo in `docs/analisi-wallet.md`.

## Il campione

**Top**: l'unione delle quattro classifiche (24h, 7g, 30g, sempre), 379 utenti.
**Folla**: i ~30.000 follower recenti dei top, di cui 18.378 con almeno 10 swap e fuori
classifica; 1.500 estratti a caso (seme fisso). E' gente attiva e recente, non la media
degli iscritti.

    strato  utenti  swap fomo   wallet Solana   tx Solana lette   wallet Robinhood   movimenti Robinhood
    top        379    199.166   356 su 365        2.423.921         349 su 352           359.578
    folla    1.500    351.207   1.404 su 1.442      714.695         1.273 su 1.306       176.791

Su Robinhood **il 99,9% degli swap dichiarati da fomo si ritrova on-chain con la quantita'
esatta** (57.054 su 57.139 dei top, 83.782 su 83.825 della folla).

Il primo download dall'API aveva **182 utenti su 1.879 con dati incompleti senza nessun
errore visibile** (i 429 dell'API interrompono la paginazione): riscaricati e verificati
prima di tutto il resto.

## 1. Come funziona fomo su Robinhood Chain

- **Il wallet** e' un EOA con delega EIP-7702, mosso via ERC-4337 da una flotta di bundler di
  fomo (`0x4337…`) verso l'EntryPoint v0.8. L'`evmAddress` del profilo e' vuoto, come su Solana.
- **Il contante resta su Solana.** Un acquisto e' USDC che esce dal wallet Solana verso Relay
  e token che arriva sul wallet Robinhood dal router `0xb92fe925…`, di norma nello stesso
  secondo o due; una vendita e' il contrario. Il dollaro locale di Robinhood e' **USDG**, che
  si vede passare ma che l'utente quasi non tiene (65 scambi locali USDG↔token su 352.884
  transazioni dei top).
- **Le azioni tokenizzate** (GME, GOOGL, AAPL, HOOD, SPCX…) sono token di Robinhood Chain e si
  scambiano come i memecoin.
- **Spam**: due terzi delle transazioni che toccano i wallet Robinhood dei top (240.520 su
  352.884) muovono un token senza nessuna contropartita in contante; quasi tutte sono airdrop
  (lo stesso token a 50-100 indirizzi in una transazione). Non sono operazioni.

**Quanto costa.** Confrontando l'USDC che esce davvero da Solana con l'importo che fomo
dichiara, gamba per gamba (oltre 115.000 gambe):

                acquisto   vendita
    top          0,07%      0,08%
    folla        0,54%      0,65%

Su Robinhood **la folla paga sette volte i top**; su Solana la struttura era la stessa (minimo
di $0,10 per operazione, aliquota che scende con l'ordine: 3% sotto $5, 0,3-0,5% sopra $500).
L'ordine tipico della folla vale $45, quello dei top $1.400.

## 2. Il risultato vero: i top perdono su Robinhood, la folla perde ovunque

Giri chiusi puliti (tutto comprato e rivenduto nella finestra, niente token arrivati da fuori,
almeno $10), valorizzati con l'USDC mosso on-chain:

    strato  catena      giri    capitale    vinti   netto        pesata   mediana
    top     Solana     24.158    $79,1M      34%    +$4,36M      +5,5%    −11,6%
    top     Robinhood  15.486    $83,1M      30%    −$7,10M      −8,5%    −12,9%
    top     insieme    39.644   $162,2M      32%    −$2,74M      −1,7%    −12,1%
    folla   Solana     56.379    $12,2M      33%    −$0,75M      −6,2%    −10,4%
    folla   Robinhood  26.319     $9,5M      30%    −$0,74M      −7,8%     −8,6%
    folla   insieme    82.698    $21,7M      32%    −$1,49M      −6,9%     −9,8%

L'1% dei giri migliori fa il 65-67% di tutto il guadagno lordo; il 10% ne fa il 95-97%.

**La perdita su Robinhood e' confermata da tre strade**: ricostruita on-chain (−8,5% top,
−7,8% folla), coi soli importi dichiarati da fomo (−11,0%, −8,2%), e separando i giri le cui
gambe sono accoppiate grazie allo swap fomo (−19,2% top) da quelli accoppiati per orario
(+0,4%): non e' un artefatto dell'accoppiamento.

**Per utente** (realizzato on-chain nei 30 giorni):

    strato  utenti   positivi   mediana    10°         90°        fomo dice positivi
    top       356       35%     −$6.041   −$115.877   +$97.599         78%
    folla   1.302       20%        −$60     −$2.965       +$67         18%

Fra i top che fomo da' positivi a 30 giorni, sono positivi on-chain **il 42%**.

## 3. I migliori: 47 su 1.169

Solido = almeno 10 giri, realizzato positivo, positivo **senza il giro migliore**, positivo
**in entrambe le meta'** del mese.

    top     24 su 284 con almeno 10 giri   (8%)
    folla   23 su 885                      (3%)

I primi dei top:

| utente | giri | capitale | realizzato | senza il migliore | vinti | tenuta mediana | capitale/giro | follower |
|---|---|---|---|---|---|---|---|---|
| @frankdegods | 336 | $6,16M | +$830.851 | +$421.337 | 36% | 5,5 h | $5.000 | 337.195 |
| @macdegods | 177 | $2,31M | +$653.547 | +$74.506 | 19% | 14,6 h | $5.000 | 46.618 |
| @bigbabba | 224 | $1,67M | +$387.303 | +$292.033 | 49% | 36 min | $2.666 | 73.338 |
| @reganbryan83940 | 278 | $2,10M | +$288.521 | +$151.294 | 29% | 19 min | $2.250 | 4.050 |
| @0xLingard | 87 | $0,89M | +$270.747 | +$50.215 | 26% | 2,9 h | $5.000 | 8.750 |
| @GenerationalFumbler | 110 | $2,48M | +$247.838 | +$63.390 | 30% | 8,2 h | $8.046 | 3.541 |
| @sadcrissy | 54 | $0,69M | +$245.830 | +$41.054 | 63% | 9,2 h | $1.844 | 54.856 |
| @redemptionjizzy | 239 | $0,78M | +$229.939 | +$119.832 | 35% | 3,3 h | $1.500 | 9.324 |
| @Nichequantelsa | 6.056 | $3,42M | +$203.381 | +$194.035 | 47% | **0 min** | $410 | 1.475 |
| @Tekkerrss | 278 | $0,28M | +$158.408 | +$100.108 | 35% | 3,8 h | $800 | 14.566 |

Tre profili diversi dentro la stessa lista:

- **il colpo grosso** — @macdegods: 19% di giri vinti, $579k su un solo giro. Senza quello
  resta positivo, ma di poco;
- **il regolare** — @bigbabba (49% vinti, il migliore pesa un quarto del totale),
  @redemptionjizzy, @Tekkerrss;
- **la macchina** — @Nichequantelsa: 6.056 giri in un mese (200 al giorno), tenuta mediana
  sotto il minuto, $410 a giro, 47% vinti, +$203k quasi tutto senza colpi. Anche @prevaile
  (1.483 giri, 3 minuti). E' il comportamento di un programma, non di una persona che tocca
  lo schermo.

Nella folla i solidi sono piccoli: il primo, @liveyng, fa +$36.597 su $349k con il 96% di giri
vinti (token da $50M, settimane di vita: compra roba grossa e vende presto); il secondo,
@camolNFT, 1.113 giri da $150 tenuti 5 minuti.

**I follower non c'entrano**: fra i solidi dei top si va da 748 a 337.195; nella folla quasi
tutti hanno meno di 100 follower.

## 4. Come operano i solidi, contro tutti gli altri

Mediane per utente (utenti con almeno 10 giri):

                      eta' token   mcap ingresso   tenuta    capitale/giro   giri/g   perso/vinto   vendite/giro
    top    solidi        10,6 h       $155k        100 min       $1.672        4,9    −29% / +36%       2,5
    top    altri          8,6 h       $339k        189 min       $1.420        1,8    −39% / +33%       1,7
    folla  solidi        13,4 h       $144k         38 min         $150        2,8    −22% / +23%       1,4
    folla  altri          5,5 h       $376k         20 min          $45        1,4    −25% / +18%       1,2

Rispetto agli altri, i solidi fanno **piu' giri** (2-3 volte), **tagliano le perdite prima**
(−29% contro −39% nei top) e comprano **token piu' piccoli**. Nessuno entra nei primi minuti:
l'eta' mediana dei token che comprano e' di mezza giornata.

## 5. Che cosa prevede il risultato

Ogni tratto misurato sulla **prima meta'** del mese, la resa sulla **seconda**. 658 utenti con
almeno 5 giri in entrambe (209 top, 449 folla), in terzi. Fra parentesi quadre la resa
togliendo a ognuno il giro migliore della seconda meta'.

    tratto (1a meta')                 terzo basso           terzo medio          terzo alto           p
    resa                             −19,9% [−29,0%]       −8,8% [−16,0%]       −3,2% [−12,2%]       0,00
    quota di giri vinti              −13,9% [−24,0%]       −9,3% [−17,8%]       +0,5% [ −6,6%]       0,01
    tenuta mediana                    +3,3% [ −3,0%]       −8,3% [−16,5%]      −13,5% [−24,0%]       0,00
    giri al giorno                   −15,3% [−24,2%]      −16,2% [−25,3%]       −3,4% [−12,0%]       0,02
    perdita mediana dei giri persi   −12,8% [−24,9%]       −6,1% [−13,2%]       −1,7% [ −7,4%]       0,03
    eta' del token                    −8,2%                 −4,3%               −11,9%               0,50
    capitalizzazione all'ingresso     −5,4%                −10,2%                −7,3%               0,74
    capitale per giro                 −7,8%                 −6,7%                −7,8%               0,99
    quota su Robinhood                −9,6%                 −3,9%               −10,8%               0,84

Con un campione grande la bravura **si vede**: chi ha reso, vinto spesso, tenuto poco, fatto
molti giri e tagliato le perdite nella prima meta', fa meglio nella seconda (p da 0,00 a 0,03).
Ma il miglior terzo per quasi ogni tratto resta **negativo**, e **lo e' sempre senza il giro
migliore**. L'unica riga vicina allo zero e' chi tiene poco (+3,3%; −3,0% senza il colpo
migliore).

Il tipo di token — eta', capitalizzazione, catena — e la dimensione dell'ordine **non
prevedono niente**.

Il confronto con la prima passata (170 utenti, p = 0,10) non e' una contraddizione: la
persistenza c'era, era piccola, e serviva un campione quattro volte piu' grande per vederla.

## 6. Eta' e capitalizzazione del token

Entrambi gli strati, giri chiusi puliti, eta' dalla prima transazione del token on-chain.

    eta'          Solana: giri   vinti   pesata   mediana      Robinhood: giri   vinti   pesata   mediana
    <1 min              729       44%   +32,3%    −4,5%                170      33%   +23,8%    −7,3%
    1-5 min           3.975       42%   +35,2%    −9,1%              1.705      37%   +11,3%    −8,6%
    5-30 min         14.907       39%    +7,8%   −12,0%              7.265      33%    −4,3%   −12,8%
    30m-6h           19.926       34%    +5,3%   −12,7%             11.046      30%   −13,0%   −14,0%
    6h-1g             7.695       32%    −9,8%   −10,3%              4.944      30%    +6,9%   −11,0%
    1-7g             11.522       31%    +2,0%    −9,7%              7.704      30%   −12,0%    −9,1%
    7-30g             7.107       30%    −1,8%    −8,8%              4.418      28%   −18,0%    −7,4%
    >30g              4.496       32%   +12,9%    −4,9%              3.283      27%    −9,3%    −3,3%

I primi minuti sono la fascia migliore su entrambe le catene, ma piccolissima (4.704 giri e
$2M su Solana contro $91M totali) e — §5 — un'abitudine all'eta' del token non si porta
nella seconda meta'. Su Robinhood quasi ogni fascia e' negativa.

## 7. La folla dietro i top

Giri della folla sugli stessi token dei top, per quando entra rispetto al primo top:

    la folla entra...           giri     vinti   pesata
    prima dei top               7.253     45%    +18,2%
    entro 10 minuti dopo       10.790     39%     −7,0%
    10-60 minuti dopo          12.983     35%     −9,1%
    1-6 ore dopo               10.181     31%     −8,1%
    oltre 6 ore dopo           26.103     29%     −6,4%
    token mai toccati dai top  15.388     26%    −24,8%

Entrare **dopo** un top perde a ogni distanza. Entrare **prima** sembra ottimo, ma e' lo stesso
inganno del gregge (prima passata, §5): i top comprano dentro le impennate (prima passata,
§6), quindi un token toccato dopo da un top e' per costruzione un token che stava salendo. E i
token che nessun top tocca, cioe' quelli che non sono saliti, sono la fascia peggiore.

## 8. In sintesi

1. **fomo funziona uguale su due catene**: wallet nascosti (Solana: co-firmatario; Robinhood:
   EIP-7702 + bundler), contante sempre in USDC su Solana, Robinhood raggiunta via Relay. I dati
   dell'API sono fedeli alle quantita' on-chain al 99,9%.
2. **Il costo pesa sulla folla**: su Robinhood 0,07-0,08% per i top, 0,54-0,65% per la folla, e
   su Solana dallo 0,3% al 3%. Con una mediana di giro gia' negativa, la commissione e' la
   differenza fra perdere poco e perdere sempre.
3. **La classifica non misura il guadagno.** On-chain i top perdono l'1,7% sul capitale in 30
   giorni (Robinhood −8,5%), e solo il 35% e' positivo — fomo ne da' positivi il 78%.
4. **I migliori veri sono il 3-8%**: fanno piu' giri, tengono meno, tagliano prima. Alcuni sono
   chiaramente automatici (centinaia di giri al giorno, tenute sotto il minuto).
5. **La bravura esiste ma vale poco**: si porta da una meta' del mese all'altra, ma il miglior
   terzo resta negativo appena si toglie il colpo migliore. Nessun tipo di token, catena o
   dimensione predice il risultato.
6. **Seguire i top non paga** a nessuna distanza di tempo.

## 9. Controprove

| cosa | transazione |
|---|---|
| vendita su Robinhood di @seralberttrades: 2.049.995,84 ORBIOBOOK dal wallet `0x9164…` (EIP-7702) via bundler fomo e EntryPoint v0.8 | [0x5128bd84…](https://robinhoodchain.blockscout.com/tx/0x5128bd84631358b59b3d91b445890746041aea4e120450b62d5868b2b1ef131e) |
| la stessa vendita pagata su Solana: 385,88 USDC al wallet `Cqu5u…` (fomo dichiara 386,50) | [5YZnXmzf…](https://solscan.io/tx/5YZnXmzfiaFBtrQtNx5UvYFwxmr7jFr5oWYQBczW7QYkbmKyhS7PWGTk86YLDzHAwnnXGC5kBeURgPaxXcPbYwP1) |
| acquisto ROBIT di @bigbabba consegnato su Robinhood, pagato in USDC su Solana | [0x485aa500…](https://robinhoodchain.blockscout.com/tx/0x485aa500b060b2a767195f3284a59782b2c1f2bbc858d6005e0d56fa622f6ffd) |
| airdrop di massa: lo stesso token (DCA) a 100 indirizzi, fra cui un wallet fomo | [0x2775b7aa…](https://robinhoodchain.blockscout.com/tx/0x2775b7aa0ae5e6baad490813c824dce809c12320d267d06dfbb56fcc11c14eb7) |

## 10. Limiti

- **54 storie Solana troncate fra i top** (oltre 20.000 transazioni in una lettura: manca la
  coda del mese). Sono i wallet piu' pesanti e migliori su Solana (+8,8%); senza di loro i top
  fanno +2,6% su Solana e −11,1% su Robinhood. La direzione non cambia.
- **Eta' del token**: nota per il 99% del capitale dei top e il 94% della folla su Solana, il
  99,9% su Robinhood. I crediti Helius si sono esauriti a fine lavoro ("max usage reached"); il
  resto dei token e' nella riga "ignota".
- **Altre catene EVM** (BSC, Base, Ethereum) non ricostruite: passano da Relay come Robinhood,
  stesso metodo, non fatto qui.
- **La folla e' estratta dai follower recenti dei top**: utenti attivi e nuovi, non la media.
- **Trenta giorni.** La seconda meta' (§5) non e' fuori dalla selezione per i top (scelti anche
  sul PnL a 7 giorni); per la folla, estratta senza guardare il risultato, lo e'.
