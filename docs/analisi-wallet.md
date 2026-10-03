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
| **RPC Helius** (`SVS_INDEX_RPC`) | storia completa; `getTransactionsForAddress` con filtro per orario | — | §4 |
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

**Capitalizzazione all'ingresso** = prezzo pagato (dollari ÷ token ricevuti) × supply
(`getTokenSupply`). Non dipende dal prezzo di oggi, al contrario di "mcap attuale × prezzo
d'ingresso ÷ prezzo attuale", che si rompe quando cambia la pool di riferimento.

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
- **catena**: tutte le transazioni di un wallet vero in 30 giorni, ridotte a variazioni di
  saldo (USDC, SOL, token).
