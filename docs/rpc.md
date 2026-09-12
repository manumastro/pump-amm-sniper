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

`getProgramAccounts` su publicnode risponde 403 (richiede un token), e anche
`getMultipleAccountsInfo` con troppi account in una volta. Il bot non usa il primo, e il secondo
passa da `getAccountsChunked()`. Non e un problema, ma spiega i 403 se compaiono.

**Prima di adottare un endpoint, verificarlo:** `SVS_UNSTAKED_RPC="https://..." node scripts/rpc-smoke-test.js`.
La fase 2 prova **tutti** i program registrati, proprio per far emergere i buchi silenziosi come
quello sopra; poi misura la latenza e trova la soglia di 429.
