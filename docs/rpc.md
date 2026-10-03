# RPC

Due env var, entrambe provider-agnostiche:

```bash
SVS_UNSTAKED_RPC=https://solana-rpc.publicnode.com                  # letture HTTP
SVS_UNSTAKED_WS=wss://api.mainnet-beta.solana.com                   # subscription (opzionale)
SVS_HEAVY_RPC=https://solana-mainnet.g.alchemy.com/v2/<key>         # metodi strozzati (opzionale)
```

⚠️ **`getTokenLargestAccounts` su publicnode: 32,5s poi 429.** E la chiamata del controllo top-10.
Con `PRE_BUY_TOP10_FAIL_OPEN=false` un endpoint che non la serve fa scartare **ogni** token e
`checksPassed` resta zero per sempre, senza nessun errore visibile. Alchemy risponde in 691ms ma
regge 25 req/s e crolla sulle raffiche (55/60 in 429): da qui il terzo ruolo, che riceve solo una
chiamata per valutazione. Vedi `docs/controls.md` sezione 28.

Senza `SVS_UNSTAKED_WS` il WebSocket viene derivato dall'HTTP, come prima.

**Perche separarli.** I due carichi sono opposti — una connessione permanente da un lato,
raffiche da decine di req/s dall'altro — e nessun provider gratuito e buono su entrambi:

| Endpoint | logsSubscribe | HTTP | Esito |
|---|---|---|---|
| `https://solana-rpc.publicnode.com` | parziale | 218 req/s, archive ok, 250ms | **usato per HTTP** |
| Chainstack free (nodo Elastic) | completo, primo log ~500ms | niente archive | ⚠️ **quota mensile esaurita** |
| `wss://api.mainnet-beta.solana.com` | completo, il piu ricco misurato | 1,1 req/s | **usato per WS** |
| Alchemy free | **no** | archive ok, **58ms**, 25 req/s | HTTP ottimo, WS assente |
| dRPC free | — | — | Solana non inclusa nel piano free |

**Chainstack free blocca i metodi archive** (`getSignaturesForAddress`, `getParsedTransaction`)
con `403 -32002 "Archive, Debug and Trace requests are not available"`. Le letture di account
funzionano, quindi i poll di hold girerebbero, ma **i 30 controlli creator-risk no**: sono costruiti
sulla storia delle transazioni. Ottimo come WebSocket, inutilizzabile come `SVS_UNSTAKED_RPC`.

**Alchemy free e il contrario:** in HTTP e il piu veloce misurato (58ms contro i 250ms di
publicnode, archive incluso, 12/12 senza rate limit a ritmo sequenziale), ma **ogni metodo pubsub
risponde "method not found"** — `logsSubscribe`, `programSubscribe`, `accountSubscribe`,
`slotSubscribe`. La documentazione Alchemy elenca i WebSocket su tutti i piani, quindi la causa non
e chiara e **non e detto che un piano a pagamento la risolva**. Il limite del free e 25 req/s, il
PAYG sale a 300.

⚠️ **Alchemy restituisce un array vuoto, senza errore, su `getSignaturesForAddress` di un program
id** ad altissimo volume. Su wallet e pool risponde correttamente, ed e l'unica cosa che il bot
interroga davvero (`grep getSignaturesForAddress src/`: sempre creator, funder o pool) — quindi non
lo scarta. Ma e il terzo endpoint in un giorno che **risponde "ok" senza dare i dati**, ed e la
ragione per cui la fase 3 dello smoke test ora conta anche le risposte vuote.

⚠️ **"parziale" significa che publicnode accetta la subscription e non consegna niente** per il
program Meteora DAMM v2. Misurato il 2026-09-12: 0 eventi in 45s, contro 6.026 dello stesso program
su mainnet-beta nella stessa finestra, mentre pumpswap e ray_v4 arrivavano regolarmente sulla stessa
connessione. Nessun errore, nessun log: quel DEX sarebbe stato semplicemente invisibile.

⚠️ **publicnode non ha piu' la storia: ~16 ore di `getSignaturesForAddress`** (misurato il
2026-10-03, `analysis/2026-10-03-fomo-classifica.md`). Paginando fino in fondo, sullo stesso
indirizzo e nello stesso minuto:

| indirizzo | publicnode | Helius (`SVS_INDEX_RPC`) |
|---|---|---|
| `D7LQCUqttqbw9RqEPtubf5dYmurXk2aJ7zVbHWwYSUDn` | 134 firme, dalla 02/10 17:37 | 3.689, dall'11/09 |
| `EU7FSVgkt8eZYV199enSCoQa3qoH6h6HP8v9BqpGDeG5` | **0** | 724, dal 30/08 |
| `49nvFkUxnxd4wXY5W9XygB93rzDUvugaxK5AkMqqxmgS` | 19, poi 14 alla seconda chiamata | 278, dal 09/09 |

Nessun errore: la pagina e' semplicemente piu' corta, e cambia da una chiamata all'altra (nodi
diversi dietro lo stesso nome). Alchemy (`SVS_HEAVY_RPC`) e Helius hanno la storia completa. **Il
controllo creator-risk legge la storia dei creatori da `SVS_UNSTAKED_RPC`**
(`src/services/creator-risk/index.ts`, `getSignaturesForAddress` sulla connessione principale):
con questo endpoint un creatore che ha fatto rug due giorni fa risulta senza passato. Non
corretto: da decidere, e da verificare da quando succede prima di leggere i blocchi creator-risk.

**Helius `getTransactionsForAddress`** filtra per intervallo di tempo e restituisce le
transazioni complete (`docs/analisi-wallet.md` §4). Con `sortOrder: 'asc', limit: 1` da' la
prima transazione di un indirizzo in una chiamata: la nascita di un mint senza paginare.
Richiede `maxSupportedTransactionVersion: 1` — esistono gia' transazioni di versione 1, e con 0
la chiamata fallisce.

**Crediti Helius esauriti il 2026-10-03.** Dopo ~3,1 milioni di transazioni lette con
`getTransactionsForAddress` (1.757 wallet fomo, `analysis/2026-10-03-fomo-solana-robinhood.md`)
Helius risponde `429 max usage reached` a ogni chiamata: non e' un limite di frequenza, e' la
quota del piano. Fino al rinnovo `SVS_INDEX_RPC` non serve.

**Alchemy gratuito: il tetto e' la velocita', non il mese.** Il piano da' 30M CU al mese
(2,5M usate al 2026-10-03 dopo due studi fomo) e **300 CU al secondo**. `getTransaction` pesa
molto: due processi a 18 richieste al secondo l'uno hanno toccato 572 CU/s e da li' quasi ogni
chiamata torna 429 (16 su 40 in una raffica), e ognuno rallenta l'altro. Un solo processo
Alchemy alla volta, ~6 `getTransaction` al secondo: la storia di un conto USDC fomo molto
attivo (3.000 transazioni in 10 ore) richiede minuti. Ethereum, Base e BNB vanno abilitate
dalla dashboard come Robinhood (`ETH_MAINNET is not enabled for this app`).

**Robinhood Chain (id 4663).** Alchemy `robinhood-mainnet.g.alchemy.com` (stessa chiave di
`SVS_HEAVY_RPC`, rete da abilitare nella dashboard): `alchemy_getAssetTransfers` funziona sul
piano gratuito ed e' la strada per la storia di un wallet; `eth_getLogs` e' limitato a **10
blocchi** (un secondo). L'errore di frequenza arriva come stringa (`"error": "Rate limit
exceeded"`). L'RPC pubblico `rpc.mainnet.chain.robinhood.com`: `eth_getLogs` fino a 30.000
blocchi senza `address`, 10M con uno, 100.000 con una lista; 429 "reset in 60 seconds" oltre ~4
richieste al secondo.

`getProgramAccounts` su publicnode risponde 403 (richiede un token), e anche
`getMultipleAccountsInfo` con troppi account in una volta. Il bot non usa il primo, e il secondo
passa da `getAccountsChunked()`. Non e un problema, ma spiega i 403 se compaiono.

**Prima di adottare un endpoint, verificarlo:** `SVS_UNSTAKED_RPC="https://..." node scripts/rpc-smoke-test.js`.
La fase 2 prova **tutti** i program registrati, proprio per far emergere i buchi silenziosi come
quello sopra; poi misura la latenza e trova la soglia di 429.
