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
