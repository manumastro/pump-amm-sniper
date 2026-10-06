# Pipeline fomo

Script permanenti degli studi su fomo.family. Chiavi in `.env.fomo` (mai nel `.env` dello sniper),
dati in `dati/fomo/` (fuori da git, ~1,5 GB). Metodo in `docs/analisi-wallet.md`.

## Il giro quotidiano

1. **Login** a fomo.family nel browser Playwright (lo fa la persona).
2. **Scarico** (solo il nuovo rispetto ai dati salvati; in piu' gli id di `dati/fomo/extra.json`, facoltativo):
   ```
   python3 scripts/fomo/servi.py &        # ponte locale su 127.0.0.1:8765, importa da solo
   ```
   poi `browser_run_code_unsafe` con `filename: scripts/fomo/avvia_scarico.js` (apre la classifica,
   cattura l'header, lancia lo scarico) e `filename: scripts/fomo/chiudi_scarico.js` (aspetta fino a
   9 minuti; finito, manda lo scarico al ponte che lo importa; se no restituisce lo stato e si
   rilancia). Nessun dato passa dalla conversazione; l'header non esce mai dalla pagina.
3. **Wallet nuovi**: `node scripts/fomo/wallet.js` (solo chi non ce l'ha).
4. **Prezzi e liquidita'** (solo dalla catena): `python3 scripts/fomo/prezzi.py` → chiama
   `prezzi_catena.js` (Solana, Helius) e `prezzi_evm.js` (Robinhood, Ethereum, Base, BSC, Alchemy)
   sullo stesso file; si misurano i token di cui qualcuno tiene almeno $50. Un token senza pool
   o senza scambi da 7 giorni resta `null` e vale 0; Monad e 5042 non hanno modulo (0).
5. **Saldi on-chain** (subito dopo lo scarico, se no i saldi si spostano): `node scripts/fomo/saldi.js`.
6. **Report classifiche**: `python3 scripts/fomo/classifiche.py` → `dati/fomo/risultati/classifiche-<ora>.md`.
7. **Automatici** (quando serve): `python3 scripts/fomo/automatici.py`.
8. **Storie on-chain** (lungo, in background): `node scripts/fomo/storia.js tutte classifica` (i 150 dell'ultima classifica) o `node scripts/fomo/storia.js` (tutti); `sol` o `evm` al posto di `tutte` per una sola parte.

## Cartelle in `dati/fomo/`

| percorso | cosa |
|---|---|
| `utenti/<id>.json` | profilo, swap, trasferimenti, posizioni aperte (`bal`), perp, ultimo scarico |
| `wallet.json` | id → wallet Solana (`sol`, `sol_metodo`) ed EVM (`evm`, stesso indirizzo su tutte le catene EVM) |
| `catena/sol/<id>.json` | righe on-chain del conto USDC: firma, ora, firmatario, variazioni di token; `fino` |
| `catena/evm/<id>.json` | trasferimenti ERC-20 su Robinhood, Ethereum, Base, BSC (`rete`); `fino` per rete |
| `classifiche/<ora>.json` | le quattro classifiche lette |
| `prezzi/<ora>.json` | `<rete>:<tok>` → prezzo, liquidita' del pool principale (`liq`) e di tutti i pool trovati (`liq_tot`), dalla catena; `null` = non si vende |
| `cache/pool_evm.json`, `cache/pool_evm_reti.json` | pool EVM dei token: il primo per il metodo dei log di Robinhood (tok → pool), il secondo per lo stato dei pool, `<rete>:<tok>` → pool con valute e decimali |
| `segui/<giorno>.jsonl`, `segui/<giorno>.catena.json` | swap dei seguiti (lato, token, rete, ora) e i loro prezzi dalla catena all'istante e a +15 min, +1 h, +6 h (`node scripts/fomo/foto_catena.js`) |
| `risultati/` | report e controprove |
| `grezzi/` | scarichi della pagina gia' importati |

## Fornitori e limiti

- **Alchemy gratuito**: 300 CU al secondo per tutte le reti insieme (`ALCHEMY_PER_SEC`, di
  default 10 richieste al secondo). Un solo script Alchemy alla volta.
- **Helius gratuito**: tutte le letture Solana (`comune.js`, rete `sol`); `storia.js` usa
  `getTransactionsForAddress` (100 transazioni complete per chiamata, filtro per orario). A crediti
  finiti Solana passa da sola ad Alchemy. Helius non copre le catene EVM: quelle restano su Alchemy.
- **fomo**: circa 4-9 utenti al minuto per uno scarico completo a 30 giorni; incrementale molto meno.
- **Nessuna API di prezzo esterna**: dexscreener e simili non si interrogano (vedi
  `docs/verifica-onchain.md`). Prezzi EVM: `eth_call` sullo stato dei pool (Alchemy e' archive,
  anche a blocchi passati); su Robinhood i log sull'RPC pubblico (10 milioni di blocchi per
  chiamata, 3 al secondo).

## Bonding e graduation (pump.fun)

- **Tracciatore** sempre acceso: `nohup node scripts/fomo/bonding.js >/dev/null 2>>dati/fomo/bonding.err &`.
  Ogni 2 minuti legge le liste "Bonding" (sopra ~75% della curva) e "Graduated" della scoperta di fomo,
  che l'app prende da Mobula pulse (`POST mobula-api.fomo.family/api/2/pulse`, viste `filtered-bonding` /
  `filtered-bonded`, stesso token; passa dal Chrome headless di `~/fomo-mcp`). Registro in
  `dati/fomo/bonding/registro.json` (prima vista, passaggi con avanzamento e capitalizzazione, stato
  bonding/graduato/morto), log in `dati/fomo/bonding.log`. I token usciti dalla lista si controllano
  sulla curva (`getMultipleAccounts`, flag `complete`) e con `filterTokens`: la graduation si vede prima
  che compaia in "Graduated". Un solo tracciatore alla volta (scrivono tutti lo stesso registro); per
  fermarlo `kill -9` (con SIGTERM resta vivo).
- **Studio**: `node scripts/fomo/bonding_studio.js <mint>...` o `registro [n graduati] [m fermi]` (i graduati
  pump.fun non studiati o col vecchio schema, fuori i lanci a pacchetto nati e graduati in < 10 s). Storia del mint
  con Helius dalla nascita alla MigrateV2 (al massimo `MAXP`=50 pagine), poi dopo la graduation fino a +`DOPO`=3600 s
  ma al massimo `MAXD`=50 pagine: i token caldi fanno 20-120 tx al secondo sul pool, e li' la finestra coperta e' di
  1-3 minuti (campo `riassunto.finestra_dopo_s`). Per **tutti** i compratori in bonding e per chi compra sul pool nella
  finestra (`bp` = "dopo"): entrata (punto della curva, ora, SOL), uscite prima e dopo, `pnl_vero` = incassato − speso +
  quel che resta venduto adesso sulle riserve del pool (prodotto costante, ognuno da solo). Chi a fine finestra tiene
  ancora almeno `SOGLIA_ATA`=0,3 SOL si segue dal conto token (i primi `MAX_ATA`=60); gli altri restano
  "tiene (non seguito)", valutati adesso. Prezzi a +5m/+30m/+1h/+6h/+24h, feed/tesi/detentori fomo. Tutti i wallet in
  forma corta in `tutti`, il dettaglio per i primi 60. Cache in `dati/fomo/bonding/grezzi/` (`RISCARICA=1` per
  riscaricare). Costo: ~60-130 chiamate per un token (graduato da poco e caldo ~105), ~5 per rifarlo dalla cache;
  ci si ferma a `LIMITE`=15000.
- **Storia di un wallet**: `node scripts/fomo/bonding_studio.js wallet <indirizzo>...` → `dati/fomo/bonding/wallet/`:
  i token pump.fun comprati sulla curva negli ultimi `GIORNI`=2 (al massimo `PAG_W`=15 pagine), graduati o no, con
  risultato al prezzo di adesso. Misura i vincenti sui token che non abbiamo scelto noi; ~5-15 chiamate a wallet.
- **Per wallet**: `python3 scripts/fomo/bonding_wallet.py` → `dati/fomo/risultati/bonding-wallet-<data>.md`: classifica
  (fuori blocco della nascita e creatore), ricorrenti con tutti i loro token, per fascia d'ingresso (0-25 … 95-100,
  dopo) i 5 migliori e i 5 peggiori, gruppi che comprano nello stesso slot con importi simili, storie recenti;
  scrive anche `dati/fomo/bonding/ricorrenti.json` (i ricorrenti in utile, da passare a `wallet`).
- **Report**: `python3 scripts/fomo/bonding_report.py` → `dati/fomo/risultati/bonding-<data>.md` (in testa
  le note a mano di `dati/fomo/bonding/note.md`).
- **A che punto della curva** (tutti i launchpad Solana): `node scripts/fomo/curve.js <mint>...` (JSON per mint;
  `TABELLA=1` aggiunge curva% -> mcap a 0/25/50/75/90/100). Come modulo: `const { curve, tabella } = require('./curve')`;
  `await curve(mints)` -> per mint `{launchpad, programma, pool, config, piattaforma, quote, percentuale_curva, perc_token,
  perc_quote, quote_raccolta, soglia_graduation_quote, mcap_quote, mcap_usd, mcap_graduation_quote, mcap_graduation_usd,
  multiplo_graduation, graduato, migrato, nota}`. Riconosce pump.fun, Meteora DBC (BAGS, Jupiter Studio e gli altri sono
  config DBC), Raydium LaunchLab (letsbonk, StonkFun, ... sono piattaforme) e Moonit dal programma proprietario del conto;
  layout dagli IDL Anchor sulla catena (`dati/fomo/curve/idl/`), pool e config in `dati/fomo/curve/cache.json`.
  `percentuale_curva` e' la misura di fomo: token venduti per pump.fun, contante raccolto per DBC e LaunchLab. Costo: un
  getMultipleAccounts ogni 49 mint gia' visti; un mint nuovo DBC costa un getProgramAccounts. Risultati del 4/10 in
  `dati/fomo/curve/curve.md`.
- **Bonding, la foto a richiesta** (lo studio di adesso): `FOMO_TOKEN_FILE=~/.config/fomo-mcp/token node
  scripts/fomo/bonding_ora.mjs [min_holder] [max_holder] [max_ore] [min_curva]` (default `5 Infinity 48 0`) legge le
  liste `filtered-bonding` (l'app), `bonding` (nascosta) e `new` (i 500 piu' giovani: senza, i token nati e graduati in 20 minuti non si vedono), tiene i token nati da poco con almeno 5 holder fomo e per
  ognuno da' holder e valore fomo, primo ingresso di ogni holder (mcap e % di curva), bravi, tesi. Il risultato si
  presenta sempre nella stessa tabella, in ordine di % di curva decrescente.
- **Bonding in diretta** (per scovare presto i token che si graduano in 20 minuti): `FOMO_TOKEN_FILE=~/.config/fomo-mcp/token
  nohup node scripts/fomo/bonding_live.mjs >> dati/fomo/tesi/live/live.log 2>&1 &`, pagina su http://127.0.0.1:8787
  (`bonding_live.html`, si aggiorna ogni 2 s). Un solo processo con un solo Chrome sempre aperto: un giro ogni 5-8 s
  (le tre liste, holder fomo dei token nati da < 3 ore e dei candidati; gli altri ogni 2 minuti), al massimo 4 chiamate
  a fomo insieme (`IN_VOLO`; con 6+ arrivano i 429), tesi/feed/classifica dei candidati in sottofondo. Il segnale e'
  il **ritmo**: holder fomo entrati negli ultimi 5 minuti (Agent Capital, 4/10: 5 wallet fomo al minuto 6, graduato
  al 19). In cima i **potenziali runner**: token nati da < 6 ore con almeno 2 di 4 segnali accesi (holder: >= 5 utenti
  fomo in 5 min; tesi: >= 2 tesi nuove in 10 min; bravi: un bravo fra holder o tesi; soldi: >= $300 messi dagli utenti
  fomo in 5 min), o nati da < 30 minuti col segnale holder; soglie scelte a mano, da tarare con `storia.jsonl`. Poi i
  graduati dell'ultima ora, poi la tabella (ordine a scelta: runner, ritmo, piu' giovani, holder, curva, valore). Stato in `dati/fomo/tesi/live/stato.json`, holder dei
  candidati nel tempo in `storia.jsonl` (per misurare quanti token col ritmo alto si graduano davvero). In markdown:
  `python3 scripts/fomo/bonding_tabella.py [min_curva] [--curva] [--tutti]`. Uno solo alla volta; se il login scade la pagina lo dice.
  Per default pagina e tabella mostrano solo i token tradabili sulla prop firm della persona ("Only pump/bonk/bags/brrr
  tokens are tradeable": mint che finisce in pump, bonk, BAGS o brrr) e, segnati `pump?`, quelli sul programma di pump.fun
  con un mint diverso (es. agencypad), da verificare con la prop firm.
- **Axiom nella pagina live** (6/10; sul Mac bloccato dopo 11 minuti, da rifare sull'altro PC come demone, vedi `docs/ripresa.md`): con il login ad Axiom fatto dalla persona nel browser Playwright e una scheda
  axiom.trade aperta, si lancia `scripts/fomo/avvia_axiom.js` con `browser_run_code_unsafe` (come `avvia_token.js`).
  Dentro la scheda loggata (cookie di sessione mai letti ne' stampati) apre il WebSocket `wss://horn.axiom.trade/ws`
  della sezione Callouts e si iscrive ai token di `GET /axiom-lista` (candidati tradabili nati da < 6 ore, max 60):
  arrivano lo storico ('replay') e i nuovi ('post') dei callout di tre fonti, Axiom, GMGN (con KOL e follower) e
  pump.fun (commenti; contano solo se chi scrive tiene >= $50); quelli di fomo si scartano (ci sono gia' le tesi).
  Post su X che citano il contratto: `api8.axiom.trade/x-tweets`, uno alla volta, primi 15 token, ogni 2 minuti.
  Tutto va a `POST /axiom` ogni 15 s. Solo letture: mai callout, voti o trade. **Attenzione:** il 6/10 dopo 11 minuti
  Axiom ha chiuso la sessione ("Session invalid", dopo alcune 429 con un carico piu' alto e con il rinnovo della sessione
  che falliva gia' dal login); il ponte ora si ferma da solo su 401/403/4401/4403 e la pagina lo mostra.
- **Tesi sui token in bonding** (domanda: i token che ricevono presto tante tesi di trader bravi si graduano
  piu' spesso?): `nohup node scripts/fomo/tesi.js >/dev/null 2>>dati/fomo/tesi/tesi.err &`. **Non e' acceso** (4/10: si e'
  scelto di fare lo studio a richiesta, con un'istantanea); i dati raccolti dalle 14:42 alle 15:02 del 4/10 restano in
  `dati/fomo/tesi/`. Se lo si riaccende, uno solo alla volta.
  Ogni 3 minuti (`TESI_PASSO`) legge le liste `filtered-bonding` (la scheda Bonding dell'app), `bonding` non filtrata
  (3 pagine: oltre l'offset 300 Mobula da' 500), `filtered-bonded` e un campione fisso del 10% di `new` (`TESI_NEW_QUOTA`,
  scelto dall'hash del mint: i nuovi sono ~100 ogni 2-3 minuti). Ogni token si segue finche' gradua (liste, `filterTokens`
  migrated, o registro di `bonding.js`, letto dal file), muore (mcap < $5.000 per 30 minuti) o passano 24 ore dalla prima
  vista; alla chiusura si scaricano per intero tesi e feed. Tesi (`/feed/token/thesis`) e compratori fomo (`/feed/token`,
  solo per i token con tesi, threshold 0) si leggono incrementali, con una coda a priorita' (chiusura, mai visto, curva
  >= 30%, il resto ogni 5 giri) e un tetto di `TESI_BUDGET`=240 richieste a giro, `TESI_GAP_MS`=300 fra l'una e l'altra:
  la prima lettura di un token pagina tutta la storia delle tesi, quindi quelle vecchie non si perdono. Per ogni tesi:
  autore, ora, mcap al momento, testo, posizione dell'autore *quando l'abbiamo letta* (fomo da' solo quella attuale).
  Autori: `getUserRank` per ogni autore nuovo e poi una volta al giorno (40 per giro), con l'ora della lettura.
  Dati in `dati/fomo/tesi/`: `token/<mint>.json` (stati, tesi, feed), `indice.json`, `autori.json`, `giri.jsonl`
  (richieste per tipo e per giro, 429), log in `tesi.log`. Per fermarlo `kill <pid>`.
- **Report tesi**: `python3 scripts/fomo/tesi_report.py [--soglia 60] [--minuti 60] [--rank 1000]` →
  `dati/fomo/risultati/tesi-<data>.md`. Solo token chiusi e scaricati, solo tesi prima della graduation. Tesi "presto" =
  sotto il 60% della curva (pump.fun: dalla formula della curva col prezzo del SOL ricavato dagli stati del token; altri
  launchpad: interpolando gli stati osservati) o nei primi 60 minuti. Autore "bravo" = uno dei migliori dell'ultimo
  `risultati/migliori-*.json` o dei cinque studiati (@Tekkerrss, @NinjaTradeCr, @whoisdimchae, @DueYappySwift, @Mudo9453),
  oppure rank 30 giorni <= 1.000 con pnl 30 giorni e di sempre positivi, **letto prima della chiusura del token** (letto
  dopo conterrebbe il guadagno sul token stesso: questi casi si contano a parte). Tabelle "graduati X su Y" per numero di
  bravi presto, di autori presto, bravo che aveva comprato (feed) o no, separando i token visti la prima volta sotto o
  sopra il 60%; poi caso per caso con link fomo e la concentrazione per autore.
- Via MCP: `fomo_discover_tokens` (view `graduated`, `pre-graduated`, `new`, `trending`, `bonding`,
  `bonded`; `limit`/`offset`), e `lastId` per paginare `fomo_token_feed` / `fomo_token_thesis`.
