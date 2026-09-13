# Verificare un dato del bot contro la realta'

Quando un numero del bot non convince (un picco dello shadow, un PnL, una liquidita'), **non va
spiegato: va verificato**. Ci sono tre fonti indipendenti raggiungibili dalla sessione, piu' la
lettura diretta dell'account on-chain. Servono tutte e tre insieme: due che coincidono non bastano
se misurano la stessa cosa.

## 1. Browser via MCP Playwright

`mcp__playwright__browser_navigate` + `browser_evaluate`. Le pagine sono renderizzate in JS, quindi
`browser_evaluate` su `document.body.innerText` e' molto piu' utile di uno screenshot.

**gmgn** — `https://gmgn.ai/sol/token/<mint>`

I numeri di intestazione (`1h`, `5m`, `24h`) misurano **apertura → adesso** e non dicono nulla sul
massimo: un token che ha raddoppiato e poi e' tornato indietro li mostra tutti rossi. Il massimo si
legge dalla lista **Attivita'**, che riporta la market cap a ogni singola transazione. La lista e'
paginata: il contenitore scrollabile si trova con

```js
[...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 50 && d.clientHeight > 200)
```

e si carica mettendo `c.scrollTop = c.scrollHeight` in un ciclo con una pausa fra un giro e l'altro.

La stessa lista dice **chi** ha fatto le transazioni. E' il controllo piu' importante: un +100% fra
due wallet correlati (tipico: `NOME` che compra e `NOME Vault` che vende, decine di operazioni
ciascuno, acquisto netto ~0) e' volume fabbricato, non domanda. Confrontare sempre col numero di
detentori e con l'acquisto netto.

Utili anche: `1 SOL ≈ N TOKEN` (prezzo spot, per confrontarlo col nostro), `PUMP Pool info` (SOL in
pool e valore iniziale), `Token created`.

**dexscreener** — la API pubblica basta e non serve il browser:

```
https://api.dexscreener.com/latest/dex/tokens/<mint>
```

Da' `pairAddress`, `priceNative`, `marketCap`, `pairCreatedAt`. Serve soprattutto a **confermare che
la pool che stiamo leggendo appartiene davvero a quel mint**: il bug di pool sbagliata e' gia'
comparso tre volte. Non ha storico, quindi non risponde alla domanda "qual e' stato il massimo".

**solscan** — `https://solscan.io/token/<mint>` o `/account/<pool>`, per l'elenco delle transazioni e
i bilanci. Da usare quando serve sapere *cosa* e' successo (chi ha firmato, quanti SOL si sono
mossi), non *a che prezzo*.

## 2. Lettura diretta dell'account

L'ultima parola. L'endpoint sta in `SVS_UNSTAKED_RPC` nel `.env` — **mai stamparlo**, contiene la
chiave. `getAccountInfo` sull'indirizzo della curva, poi gli offset di
`src/services/dex/pumpBondingCurve.ts` (`virtualTokenReserves` 8, `virtualSolReserves` 16,
`realTokenReserves` 24, `realSolReserves` 32, `complete` 48).

Il prezzo e' `virtualSol / virtualToken`; la liquidita' e' `realSolReserves`, non quella virtuale.

**La lunghezza dell'account non e' 125 per tutte le curve** — se ne incontrano da 151 byte. Gli
offset sopra restano validi (verificato il 2026-09-13 contro gmgn: coincidenza al centesimo), quindi
una lunghezza diversa da sola **non** e' un bug.

## Questione aperta (2026-09-13)

Su `GPynmfqNfk7atMhsFM4USyHDq4gzJVgN2bj9RUsMpump` il prodotto `virtualSol × virtualToken` fra il
picco (spot 5,77e-8) e due ore dopo (spot 8,10e-9) **non si conserva**: a invariante costante un calo
di prezzo di 7,1× vorrebbe ~14,5 SOL usciti dalla curva, mentre `realSolReserves` e' calato di 0,19
SOL. Le singole letture di prezzo coincidono con gmgn in tutti e tre i punti, quindi non e' un
problema di decodifica; e' il modello della curva che non e' quello classico a 30 SOL virtuali
(quella curva parte da ~8,6). Da chiarire prima di fidarsi del `peakPnlPct` dello shadow in
aggregato.

## Le tre regole del misurare (2026-09-13)

Scritte dopo una giornata in cui tre modifiche di fila sono state applicate e poi annullate, tutte
per errori di misura e nessuna per un errore di codice. Valgono per qualunque analisi, sempre.

### 1. Il punto zero e' il nostro ingresso, mai la nascita del pool

Una curva pump che gradua all'istante viene comprata **nella stessa transazione di creazione**: il
prezzo sale di 1.000-11.000x prima che il bot possa vedere il token. Esempio verificato
(`6agyG6m21AwAabMdm8W5Y8htPCf45a8AhTxsKVTpump`, pool `GnXM8WeLB9QfULDqkP7weJU1ukmNrZZqPKxQyUdAG42u`):

| | ora | SOL nel pool | token nel pool | prezzo |
|---|---|---|---|---|
| creazione | 12:03:22 | 67,41 | 206.900.000 | 0,00000033 |
| nostro ingresso | 12:03:38 | 3.038,69 | 5.764.770 | 0,00052711 |
| massimo | 15:56:52 | 4.058,50 | 4.328.577 | 0,00093761 |

Dexscreener dice **+217.636%**. Dal nostro ingresso sono **+78%**. Il primo numero e' vero e
inutile: descrive un movimento avvenuto in 16 secondi, a cui non potevamo partecipare.

### 2. Le firme non si ordinano per `blockTime`

Decine di transazioni condividono lo stesso secondo di creazione. `Array.prototype.sort` e' stabile,
quindi dentro quel secondo conserva l'ordine di arrivo — che per `getSignaturesForAddress` e' **dal
piu' recente**. Ordinare per `blockTime` e prendere `[0]` restituisce l'**ultima** transazione di quel
secondo credendola la prima, e cambia la lettura di un fattore 20.

L'ordine cronologico corretto: impaginare fino alla pagina non piena, poi ribaltare pagine ed
elementi.

```js
const crono = [];
for (let i = pagine.length - 1; i >= 0; i--)
  for (let j = pagine[i].length - 1; j >= 0; j--) crono.push(pagine[i][j]);
```

### 3. Il prezzo si ricostruisce dalle riserve, non si copia

`prezzo = SOL nel pool / token nel pool`, letti da `postTokenBalances` della transazione
(`owner === pool`). Ogni percentuale presa gia' fatta da dexscreener, gmgn o solscan ha un punto zero
che non e' il nostro e che non e' scritto da nessuna parte.

**Controprova obbligatoria:** ogni conclusione va accompagnata dalla transazione che la dimostra, con
il link `https://solscan.io/tx/<firma>`, cosi' chiunque puo' riaprirla e contare gli stessi numeri.
