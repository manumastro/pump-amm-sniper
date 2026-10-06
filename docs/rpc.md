# Fornitori RPC per gli studi

Chiavi in `.env.fomo` (`FOMO_ALCHEMY_KEY`, `FOMO_HELIUS_KEY`), lette solo da `scripts/fomo/comune.js`.
Misurato fra il 3 e il 4 ottobre 2026.

| fornitore | per cosa | limite |
|---|---|---|
| Alchemy Solana | firme e transazioni, saldi (`getTokenAccountsByOwner`, `getTokenLargestAccounts`) | 300 CU al secondo per tutte le reti; niente filtro per orario |
| Alchemy Robinhood, Ethereum, Base, BSC | `alchemy_getAssetTransfers` (storia ERC-20 di un wallet), `alchemy_getTokenBalances`; prezzi e liquidita' con `eth_call` sullo stato dei pool, anche a blocchi passati (archive) | reti da abilitare dalla dashboard; `eth_getLogs` a 10 blocchi sul piano gratuito |
| Helius | `getTransactionsForAddress`: transazioni complete filtrate per orario, 100 per chiamata | crediti mensili (il piano del 3/10 li ha finiti dopo ~3,1M transazioni) |
| RPC pubblico Robinhood `rpc.mainnet.chain.robinhood.com` | `eth_getLogs` per ritrovare i wallet dai Transfer, gli Swap dei pool (prezzo all'ultimo scambio) e l'`Initialize` delle pool v4 (le loro valute) | 30.000 blocchi senza `address`, 10M con uno, 100.000 con una lista; 429 per 60 s oltre ~4 richieste al secondo |
| publicnode Solana | letture di account | **solo ~16 ore di storia**: mai per il passato |

**Alchemy gratuito: il tetto e' la velocita', non il mese.** 30M CU al mese (2,5M usate dopo due
studi) e 300 CU al secondo. `getTransaction` pesa molto: due script a 18 richieste al secondo
l'uno hanno toccato 572 CU/s, e da li' quasi ogni chiamata torna 429 (16 su 40 in una raffica).
Un solo script Alchemy alla volta, ~10 richieste al secondo (`ALCHEMY_PER_SEC`).

**Gli errori arrivano in forme diverse.** Alchemy manda l'errore di frequenza a volte come
stringa (`"error": "Rate limit exceeded"`); Helius a quota finita risponde `429 max usage
reached` a ogni chiamata, che non e' un limite di frequenza; una rete Alchemy non abilitata
risponde `ETH_MAINNET is not enabled for this app`. `comune.js` li distingue.

**Helius `getTransactionsForAddress`** richiede `maxSupportedTransactionVersion: 1` (esistono
transazioni di versione 1); `blockTime` nel filtro va in secondi interi; con `sortOrder: 'asc',
limit: 1` sul mint da' la nascita di un token in una chiamata.

**Alchemy restituisce un array vuoto, senza errore, su `getSignaturesForAddress` di un program
id** ad altissimo volume. Su wallet, conti token e mint risponde correttamente.

**Nessuna API di prezzo.** Dexscreener, gmgn e simili non sono fornitori: prezzo e liquidita'
vengono dalle transazioni (Solana, Helius) e dallo stato dei pool (EVM, Alchemy). Una pool v4 non
espone le sue valute: si leggono da `PositionManager.poolKeys` (Ethereum, Base, BSC; non tutte le
pool ci sono, quelle create dai lanciatori con hook propri mancano) o dall'evento `Initialize`
(Robinhood, RPC pubblico).
