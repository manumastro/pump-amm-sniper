# Analizzare un trader o un portafoglio

Come si studia **chi** opera: un profilo di una classifica, un portafoglio "vincente", un gruppo
di trader. Scritto il 2026-10-03 dopo lo studio di fomo.family
(`analysis/2026-10-03-fomo-classifica.md`), che riprende il metodo di
`analysis/2026-09-15-gmgn-sei-ore.md` e ne aggiunge la parte sulle app custodiali.

La regola di fondo e' quella di `docs/verifica-onchain.md`: un numero letto su un sito non e'
un dato finche' non lo si ricostruisce. Qui si aggiunge: **un portafoglio scelto perche' ha
vinto non dice niente finche' non lo si misura dove non e' stato scelto.**

---

## 1. Le fonti, e cosa ciascuna sa davvero

| fonte | cosa da' | cosa non da' | come si legge |
|---|---|---|---|
| **fomo.family** | classifiche 24h/7g/30g/sempre, tutti gli swap e i trasferimenti di un utente, saldi | il wallet on-chain vero (vedi §3), le commissioni | API dietro login, §2 |
| **gmgn** | i primi 100 per profitto di ogni token, etichetta del terminale | lo storico fuori da quel token | `docs/verifica-onchain.md` §1 |
| **dexscreener** | coppie, capitalizzazione e prezzo **attuali** | i token morti (spariscono: 1.434 su 4.333 nello studio fomo), lo storico, **la nascita**: `pairCreatedAt` e' spesso la pool dopo la migrazione (28% dei token oltre un'ora dopo la catena, 394 eta' negative) | `api.dexscreener.com/tokens/v1/solana/<fino a 30 mint>` |
| **solscan** | la transazione singola, leggibile da chiunque | niente che la catena non abbia | link `https://solscan.io/tx/<firma>` come controprova |
| **RPC Helius** (`SVS_INDEX_RPC`) | storia completa; `getTransactionsForAddress` con filtro per orario | crediti del piano: esauriti il 2026-10-03 dopo ~3,1M transazioni (`429 max usage reached`) | §4 |
| **Alchemy Robinhood** (`robinhood-mainnet`, chiave di `SVS_HEAVY_RPC`) | tutti i trasferimenti ERC-20 di un wallet con `alchemy_getAssetTransfers` | `eth_getLogs` a 10 blocchi sul piano gratuito | §4b |
| **RPC Alchemy** (`SVS_HEAVY_RPC`) | storia completa con `getSignaturesForAddress` | filtro per orario | |
| **RPC publicnode** (`SVS_UNSTAKED_RPC`) | letture di account | **la storia oltre ~1 giorno** (misurato il 2026-10-03, `docs/rpc.md`) | mai per ricostruire il passato |

## 2. fomo.family: leggere l'API

Tutto e' dietro login: senza, profili e classifica rimandano alla home e l'API risponde
`unauthorized`. Si entra col browser Playwright (il login lo fa la persona), poi si cattura
l'header `Authorization` **dentro la pagina** avvolgendo `window.fetch`, e lo si riusa da li'.
Mai stamparlo, mai scriverlo su file.

    /v2/leaderboard                     classifica di sempre (100 righe)
    /v2/leaderboard/{24h|7d|30d}        le altre (150 righe)
    /v2/users/userHandle/{handle}       dal nome all'id
    /v2/users/{id}/leaderboard          rank e PnL su tutte e quattro le finestre
    /v2/users/{id}/swaps                25 per pagina, poi ?lastSwapIdV2=<id dell'ultimo>
    /v2/users/{id}/transfers            depositi e prelievi, poi ?lastTransferId=<id>
    /v2/users/{id}/balances             saldi attuali con prezzo e capitalizzazione

Uno swap ha `inTokenAddress`/`outTokenAddress`, le quantita' (`inHumanAmount`/`outHumanAmount`),
il valore in dollari, l'ora, il router (`DFLOW`, `JUPITER`, `OKX`, `RELAY`). Su fomo il contante
e' **USDC**: sta da una parte in 88.583 swap su 89.975.

    /v2/users/{id}/followers            gli ultimi 200 follower (senza paginazione)

**Un campione oltre la classifica.** I follower dei ~380 utenti in classifica danno ~30.000
utenti distinti (3 ottobre 2026), da cui si estrae a caso la folla. Sono i follower *piu'
recenti*: il campione pende verso utenti nuovi e attivi, va detto.

**I 429 dell'API rompono i dati in silenzio.** Con 4 richieste in parallelo fomo risponde 429
dal 4% al 14% delle volte. Una pagina che fallisce anche dopo i tentativi interrompe la
paginazione e l'utente resta con meta' degli swap, o con zero, senza nessun errore. Al primo
download lo era il 9% degli utenti (182 su 1.879; 46 su 50 dei top sospetti erano davvero
incompleti). Le impronte: numero di swap multiplo di 25, tutti dentro la finestra e meno di
quelli del profilo; profilo mancante; zero swap. Si riscaricano con una funzione che segna ogni
utente in cui anche una sola chiamata e' fallita, e si tengono solo quelli puliti. Il token di
sessione dura ~1 ora: si legge a ogni chiamata l'header piu' recente che l'app stessa ha usato.

## 3. Le trappole, in ordine di quanto costano

**3.1 La classifica breve premia il non realizzato.** Il 5° della 24h (@CVLM03, +$225k) era a
−$95k su tutta la sua storia: aveva due posizioni da $200-350k aperte su token saliti del 30-60%
quel giorno. Su 188 utenti positivi nella 24h, **33 sono negativi da sempre.** Si guarda sempre
il rank di tutte le finestre, e la scelta si fa su quelle lunghe.

**3.2 I depositi sembrano profitti.** Un token portato da fuori e poi venduto compare negli swap
come una vendita senza acquisto: "+$746k realizzati" per @CVLM03 erano 4,63M STONK depositati
da un altro wallet. Le posizioni con un deposito dello stesso token, o che iniziano con una
vendita, si escludono dai giri.

**3.3 L'indirizzo mostrato non e' il wallet.** L'`address` del profilo e quello degli swap su
fomo **non hanno nessuna transazione on-chain** (verificato su 15 utenti su 15). Il wallet vero
si trova dal token, §4.

**3.4 I dollari di fomo sono al netto della sua commissione.** Le quantita' di token coincidono
con la catena nel 92,3% degli swap (identiche, non approssimate); gli importi in USDC no: fomo
registra gli acquisti per meno di quanto esce dal wallet e le vendite per piu' di quanto entra,
**0,50% per lato** di mediana (90° percentile ~2%). Sui giri il PnL di fomo sovrastima di circa
lo 0,6% del capitale. Per un trader che fa molti giri piccoli non e' poco.

**3.5 L'orario di fomo non e' quello del blocco.** Da −30 a +27 secondi, mediana −2,5s, su 165
agganci. Per cercare uno swap on-chain la finestra e' ±40s.

**3.6 La selezione.** Chi entra in una classifica ci entra perche' ha vinto in quella finestra.
Il risultato sulla stessa finestra e' scelto per essere buono. Si sceglie su un periodo e si
misura sul successivo (§5).

**3.7 I token morti spariscono da dexscreener.** Ignorarli toglie dal campione proprio i lanci
andati male. Eta' e capitalizzazione si ricavano on-chain (§4).

## 4. Dalla piattaforma alla catena

**Trovare il wallet vero.** Si prende un acquisto dell'utente (mint, quantita' ricevuta, ora) e
si leggono le transazioni del **mint** in ±40s con Helius:

```js
{ method: 'getTransactionsForAddress', params: [mint, {
    transactionDetails: 'full', encoding: 'jsonParsed',
    maxSupportedTransactionVersion: 1,          // 0 non basta: esistono gia' tx di versione 1
    sortOrder: 'asc', limit: 100,
    filters: { blockTime: { gte: <intero>, lte: <intero> }, status: 'succeeded' } }] }
// pagina successiva: paginationToken dalla risposta
```

In ogni transazione, `postTokenBalances − preTokenBalances` per owner sul mint: l'owner che
riceve **esattamente** la quantita' di fomo (scarto < 0,01%) e' il wallet. Con
`getSignaturesForAddress` sul mint non si fa: un token nei primi minuti ha migliaia di
transazioni per minuto (16.299 in ±5 minuti nel caso di prova) e non si arriva all'orario.

**Il segno di fomo.** Tutte le transazioni dei wallet fomo sono firmate e pagate dallo stesso
indirizzo, `AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51` (l'app e' "gasless"): ~526
transazioni al minuto, 1.370 SOL di saldo, il 2026-10-03; solscan lo etichetta "Fomo
Co-signer". Co-firma insieme al wallet dell'utente, che e' il secondo firmatario. Vedi
`docs/programmi.md`. Sul wallet vero arrivano anche transazioni firmate da altri (airdrop e
spam): non muovono USDC e non entrano nei giri.

**Eta' del token** = ora del primo acquisto − prima transazione sul mint. Con Helius e' una
chiamata: `getTransactionsForAddress(mint, { transactionDetails: 'signatures', sortOrder: 'asc',
limit: 1 })`. Senza, si pagina `getSignaturesForAddress` fino alla pagina non piena e si prende
l'ultimo elemento dell'ultima pagina (`docs/verifica-onchain.md`, regola 2) — lento sui token
attivi. Mai su publicnode, mai da dexscreener.

**La storia del wallet, in due letture.** `getTransactionsForAddress(wallet)` restituisce
solo le transazioni che toccano l'indirizzo del wallet: un **accredito** di token (che tocca
solo il conto token) non c'e' — e cosi' spariscono i pagamenti di Relay delle vendite su altre
catene. Il filtro `tokenAccounts: 'balanceChanged'` li include, ma include anche migliaia di
airdrop di spam: su @bigbabba il tetto di 6.000 transazioni si riempiva coprendo solo 8 giorni,
e 43 wallet su 120 risultavano troncati. La lettura giusta e' doppia: il **wallet senza filtro**
(swap e uscite, firmati dall'utente) piu' il **conto USDC del wallet** (indirizzo associato:
`PublicKey.findProgramAddressSync([wallet, TOKEN_PROGRAM, USDC], ATA_PROGRAM)`), unite per
firma. @bigbabba: 22.223 transazioni, tutto il mese, 4 minuti.

**Capitalizzazione all'ingresso** = prezzo pagato (dollari ÷ token ricevuti) × supply
(`getTokenSupply`). Non dipende dal prezzo di oggi, al contrario di "mcap attuale × prezzo
d'ingresso ÷ prezzo attuale", che si rompe quando cambia la pool di riferimento.

## 4b. Robinhood Chain (id 4663)

Arbitrum Orbit, ~10 blocchi al secondo. Su fomo e' la catena con piu' capitale dei big (44%).
Verificato il 2026-10-03 su uno swap di @seralberttrades.

**Come ci arriva fomo.** Il token si compra/vende con USDC su Solana attraverso **Relay**: su
Solana l'USDC va a `99vQwt…` (Relay: Depository), su Robinhood il token arriva o parte dal
wallet. Le due meta' dello stesso swap stanno su due catene e si accoppiano per orario e importo.

**Il wallet.** Anche qui l'indirizzo che fomo mostra (`evmAddress` del profilo, `address` degli
swap) e' vuoto: nonce 0, saldo 0, nessun codice. Il wallet vero e' un **EOA con delega
EIP-7702** (codice `0xef0100` + implementazione `0xe6cae83b…`) che opera via **ERC-4337**:
transazione inviata dal bundler di fomo `0x4337016838785634c63fce393bfc6222564436c4` (184.551
transazioni al 3/10) all'EntryPoint v0.8 `0x4337084d9e255ff0702461cf8895ce9e3b5ff108`
(`handleOps`). Il bundler e' l'equivalente del co-firmatario Solana.

**Trovarlo.** Dallo swap fomo (token, quantita', ora): `eth_getLogs` con `address` = token,
`topics` = `Transfer`, ±400 blocchi attorno al blocco dell'ora (stimato per interpolazione e
rifinito con 2-3 `eth_getBlockByNumber`); fra gli indirizzi che mandano o ricevono la quantita'
esatta, quello con codice `0xef0100…` (la quantita' passa anche per router e pool). Riuscito
per il 99% dei top e il 97,5% della folla. I bundler sono una flotta: indirizzi diversi che
iniziano tutti con `0x4337`, stesso EntryPoint.

**Leggerne la storia: Alchemy `alchemy_getAssetTransfers`**, sul piano gratuito (la rete va
abilitata dalla dashboard; dopo l'abilitazione ci vuole qualche minuto). Per wallet: `toAddress`
e poi `fromAddress`, `category: ['erc20']`, `withMetadata: true` (ora del blocco), fino a 1.000
per pagina con `pageKey`. Quattro wallet in 2,7 secondi; gli swap fomo ritrovati con quantita'
identica 87/87, 414/414, 539/539, 144/162. La nascita di un token e' la stessa chiamata con
`fromAddress` = indirizzo zero, `contractAddresses: [token]`, `order: 'asc'`, `maxCount: 1`.
Sul piano gratuito l'errore di frequenza arriva come *stringa* (`"error": "Rate limit
exceeded"`), non come oggetto: un gestore che guarda solo `error.message` non lo riconosce.

Le alternative, misurate e scartate:

| fonte | perche' no |
|---|---|
| Alchemy `eth_getLogs` | piano gratuito: 10 blocchi per richiesta (un secondo di catena) |
| RPC pubblico `rpc.mainnet.chain.robinhood.com` | `eth_getLogs`: 30.000 blocchi senza `address`, 10M con un `address`, **100.000 con una lista di address**; 429 con "reset in 60 seconds" gia' sopra ~4 richieste al secondo: un utente in 45 minuti |
| Blockscout `robinhoodchain.blockscout.com/api/v2/addresses/<w>/token-transfers` | completo e gratuito ma dietro Cloudflare (solo dal browser) e ~1 richiesta al secondo: 2.000 trasferimenti in 200 secondi |
| Relay `api.relay.link/requests/v2?user=<wallet>` | il registro perfetto (entrambe le catene, importi, commissioni, hash) ma v2 e' in dismissione (24/11/2026) e concede ~2 richieste al minuto; la v3 vuole `x-api-key` |

**Come si legge un wallet fomo su Robinhood.** Movimenti raggruppati per transazione:

- **consegna o ritiro via Relay**: il token arriva dal router `0xb92fe925…` o parte verso il
  deposito `0x4cd00e38…`, in una transazione inviata da un solver al contratto `0xccc88a9d…`.
  Il contante sta dall'altra parte del ponte: USDC che esce dal wallet Solana (acquisto) o vi
  entra (vendita), di norma entro pochi secondi (mediana 1-2s). Si accoppiano con lo swap fomo
  della stessa quantita' (scarto d'importo < 6%) o, se fomo non c'e', per vicinanza d'orario.
  Verifica obbligatoria: rifare il risultato sui soli giri senza gambe "solo orario" (su fomo:
  −19,2% contro +0,4% dei giri con gambe solo-orario, quindi la perdita non viene
  dall'accoppiamento) e coi soli importi dichiarati dalla piattaforma;
- **contante locale**: **USDG** (Global Dollar, 6 decimali) e' il dollaro del wallet EVM; USDG
  che si muove da solo e' contante in viaggio, USDG e token opposti nella stessa transazione
  sono uno scambio locale;
- **airdrop**: lo stesso token mandato a 50-100 indirizzi in una transazione. Su @bigbabba 2.177
  transazioni su 3.270. Non sono operazioni: un giro e' contaminato solo se l'utente ha venduto
  piu' di quanto ha comprato;
- **azioni tokenizzate**: GME, GOOGL, AAPL, HOOD, SPCX e altre sono token di Robinhood Chain e i
  big le scambiano come i memecoin.

**Tutto cio' che non e' Solana passa da Relay** (Robinhood, BSC, Base, Ethereum: sui primi 170
utenti studiati, ~36.400 swap fuori da Solana, 31 non Relay), quindi lo stesso schema vale per
le altre catene EVM.

## 4c. Ritrovare il wallet Solana dai saldi

Quando la via del token (§4) costa troppo — senza Helius, `getSignaturesForAddress` su un mint
molto scambiato pagina migliaia di firme per arrivare all'orario: 8 utenti in un'ora — si usano
i saldi. Da `/balances` si prendono le posizioni piu' grandi **rispetto alla supply**
(quantita' × prezzo ÷ capitalizzazione), per ognuna `getTokenLargestAccounts` (i 20 conti
maggiori del token) e si cerca il conto col saldo dichiarato da fomo (scarto < 0,1%); il suo
owner (`getAccountInfo` jsonParsed) e' il wallet. Due-tre chiamate a prova: 46 wallet su 91 in
pochi minuti. **Verifica obbligatoria**: almeno una transazione recente co-firmata da
`AgmLJ…`; sui wallet invasi dallo spam bisogna guardarne 25, e quelli senza nessuna co-firma si
scartano (4 su 46 il 2026-10-03).

## 5. Le misure

**Il giro.** Una posizione nasce col primo acquisto e si chiude quando la quantita' venduta
arriva al 95% di quella comprata. Si tengono solo i giri: tutto comprato e rivenduto dentro la
finestra, nessun deposito dello stesso token, almeno $10. Un rientro dopo la chiusura e' un
giro nuovo.

**Le grandezze.** Capitale, quota vinti, netto, resa pesata (netto ÷ capitale) e resa
mediana. La pesata dice cosa succede ai soldi, la mediana cosa succede al giro tipico; quando
divergono, pochi giri grossi fanno il risultato.

**La prova fuori campione.** Si divide la finestra in due (qui: tutto fino a 7 giorni fa, e
l'ultima settimana). Gli utenti con almeno 5 giri in entrambe si ordinano per resa nella prima
parte, si dividono in terzi, e si misura ogni terzo nella seconda. Se il terzo migliore resta
migliore, e la differenza regge a una permutazione (5.000 rimescolamenti), c'e' bravura; se no,
c'e' solo selezione.

**Chi e' "migliore".** Mai il PnL della piattaforma. Dalla catena: giri chiusi puliti, e un
wallet conta come solido solo se ha almeno 10 giri, realizzato positivo, resta positivo **senza
il suo giro migliore**, ed e' positivo **in entrambe le meta'** della finestra. Su fomo passano 16
wallet su 112; la meta' dei rimanenti vive di uno o due colpi.

**Il confronto di stile.** Le stesse misure (eta' del token, capitalizzazione all'ingresso,
tenuta, dimensione, tagli) sui solidi e sugli altri. Se non differiscono, lo stile non spiega il
risultato — ed e' quello che e' successo su fomo.

## 5b. Il PnL di classifica, come se si chiudesse adesso

Il PnL di una classifica fomo e' realizzato **piu' aperto**: per le 24 ore quasi solo aperto
(`analysis/2026-10-03-fomo-top150.md`). Tre passi:

- **realizzato nella finestra**: vendite nella finestra meno il costo medio degli acquisti visti
  (30 giorni di swap); per i token comprati prima, il prezzo medio d'ingresso di `/balances`
  (`userToken.averageEntryPriceUsd`). Le vendite senza costo noto si tengono a parte e danno un
  intervallo (costo ignoto escluso / contato zero). L'aperto e' la differenza;
- **vendere adesso**: ogni posizione di `/balances` a prezzo e liquidita' di dexscreener, incasso
  = (L/2 × V) ÷ (L/2 + V). `tokens/v1` restituisce **una sola coppia per token** (la maggiore):
  per la liquidita' di tutti i pool serve `token-pairs/v1/<catena>/<token>`, una chiamata a
  token, che quadruplica la liquidita' sui 174 token che fanno il 97% del valore. Si riportano
  entrambi come intervallo; e, sommando gli stessi token fra utenti, quanto incasserebbero
  vendendo insieme;
- **i perpetual**: `/balances` ha `livePerpPnl` (perp aperti), che fomo somma al PnL.

`/balances` per posizione: `balance.shiftedBalance` (quantita'), `tokenFilterResult` (prezzo,
capitalizzazione, volume, nascita), `userToken` (costo, realizzato, ingresso medio),
`activeTrade` (aperture, chiusure, trasferimenti), `valuation` (se entra nel PnL); in testa
`otherPnl`, `livePerpPnl`, `otherEquity`.

**La trappola del gregge.** "I token comprati da molti big rendono di piu'" e' sempre vero a
posteriori, perche' un token si affolla quando sale. Si misura solo con l'informazione del
momento: quanti erano gia' dentro *prima* dell'ingresso (qui nelle 6 ore precedenti), poi si
toglie un token alla volta dai migliori. Su fomo +43% diventa −2% togliendo due token.

**La folla dietro un trader.** Se l'app rende riconoscibili i suoi utenti on-chain (fomo: il
co-firmatario), per ogni acquisto del trader si leggono tutte le transazioni del token attorno
all'acquisto — **all'indietro** dall'ora dell'acquisto per il "prima" e **in avanti** per il
"dopo", altrimenti sui token affollati la lettura non arriva all'orario — e si confronta la
crescita degli acquisti dell'app con quella del resto del mercato. La prova che e' il trader a
muovere la folla e' che l'effetto cresca coi suoi follower; se non cresce, trader e folla
reagiscono alla stessa cosa.

**L'anatomia dell'app.** Qualche centinaio di transazioni del co-firmatario lette per intero:
programmi di primo livello (il router), firmatari, flussi di USDC per owner (la commissione e
dove va), e le etichette di solscan sugli indirizzi che ricorrono.

## 6. Gli script

Usa-e-getta, nello scratchpad della sessione (regola del repo). Sono descritti qui perche' si
possano rifare:

- **download fomo** (nella pagina, via `browser_evaluate`): classifiche → rank per utente →
  swap e trasferimenti degli ultimi 30 giorni, tetto 1.200 swap per utente, 3 richieste in
  parallelo.
- **giri**: posizioni per utente e per token dagli swap, marcatura depositi e prime vendite.
- **mappa**: wallet vero per utente (§4), fino a 4 acquisti provati.
- **chainmeta**: supply (Alchemy) e nascita on-chain (Helius, una chiamata) di ogni token.
- **concilia**: swap fomo contro transazioni on-chain (commissione), giri fomo contro giri
  ricostruiti dalla catena, accoppiati per token e primo acquisto entro 60s.
- **classifica**: giri on-chain di tutti i wallet, posizioni aperte ai prezzi di dexscreener,
  scambi fuori dall'app, criterio dei solidi.
- **meccanica**: 300 transazioni del co-firmatario lette per intero.
- **seguaci**: per ogni acquisto di un trader, le transazioni del token da −5 a +15 minuti.
- **mappa_rh**: wallet EVM vero dai log del token (RPC pubblico di Robinhood).
- **catena** (seconda versione): due letture per wallet (wallet e conto USDC), un file per
  wallet, ogni pagina ridotta subito a variazioni di saldo (la versione che accumulava le
  transazioni intere ha esaurito la memoria), 8 wallet in parallelo.
- **rh_storia**: trasferimenti ERC-20 del wallet EVM da Alchemy; **rh_meta**: nascita (primo
  conio) e supply dei token EVM.
- **giri2**: giri su entrambe le catene, gambe Relay accoppiate all'USDC su Solana; segna per
  ogni giro quante gambe sono accoppiate solo per orario, per poterle escludere in verifica.
- **analisi2**: risultati per strato e catena, solidi, stili, prova fuori campione con e senza
  il giro migliore, eta' e capitalizzazione, folla dietro i top.
- **integra**: rimette nei file principali i riscaricamenti dell'API e rimette in coda solo le
  mappature senza wallet.
- **catena**: tutte le transazioni di un wallet vero in 30 giorni, ridotte a variazioni di
  saldo (USDC, SOL, token).
