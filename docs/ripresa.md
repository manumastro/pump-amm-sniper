# Ripresa del lavoro su un altro PC (stato al 6/10/2026)

Riassunto per ripartire con Claude Code da un'altra macchina (anche Windows) senza la conversazione originale, che
contiene token e chiavi e non va nel repo pubblico. Da leggere insieme a `CLAUDE.md` e `scripts/fomo/README.md`.

## Di cosa si tratta adesso

Lo studio e' partito dai trader migliori di fomo.family; **dal 4/10 lo scope e' l'analisi dei token in bonding su
fomo**: scovare presto i token che in pochi minuti prendono utenti fomo, tesi e soldi (es. Agent Capital, 4/10: 5 wallet
fomo al minuto 6 a ~$9k, graduato al minuto 19). Tutto e' **solo lettura e simulazione su carta**: nessuno swap, mai
`/swaps/v2` o `requestSwapQuote`, nessun click su buy/trade/callout.

La persona trada su una **prop firm** dove "Only pump/bonk/bags/brrr tokens are tradeable": si guardano solo i mint che
finiscono in pump, bonk, BAGS o brrr; quelli sul programma pump.fun con mint diverso (es. agencypad) sono `pump?`, da
verificare con la prop firm.

## Il sistema

- **`scripts/fomo/bonding_live.mjs`** + **`bonding_live.html`**: dashboard locale su http://127.0.0.1:8787. Un processo,
  un Chrome headless (via fomo-mcp), un giro ogni 5-9 s: liste `filtered-bonding`, `bonding`, `new` di fomo, holder fomo,
  tesi, feed, curva on-chain se fomo da' 0%. Al massimo 4 chiamate a fomo insieme (con 6 arrivano i 429).
  - In cima i **potenziali runner**: token nati da < 6 ore con almeno 2 di 5 segnali (holder: >= 5 utenti fomo in 5 min;
    tesi: >= 2 tesi fomo o callout nuovi in 10 min; bravi: un bravo fomo, un KOL GMGN o un caller Axiom affidabile;
    soldi: >= $300 messi dagli utenti fomo in 5 min; x: >= 2 post su X veri in 10 min o uno da 10k+ follower in 30 min).
    Le soglie sono **scelte a mano, non tarate**.
  - Stato in `dati/fomo/tesi/live/stato.json`, storia degli holder in `storia.jsonl` (per tarare le soglie).
  - In markdown: `python3 scripts/fomo/bonding_tabella.py` (runner + tabella in ordine di ritmo; `--tutti`, `--curva`).
- **`scripts/fomo/bonding_ora.mjs`**: la stessa foto, una volta sola.
- **`scripts/fomo/avvia_token.js`**: da lanciare con Playwright (`browser_run_code_unsafe`) nel browser dove la persona e'
  loggata a fomo: cattura il token d'accesso e lo manda a `servi.py` (porta 8765), che lo scrive in
  `~/.config/fomo-mcp/token`. Si ferma quando si chiude la sessione di Claude Code: **va rilanciato ogni mattina**.
- **`scripts/fomo/avvia_axiom.js`**: primo ponte verso Axiom (WebSocket dei callout + post su X), lanciato dalla sessione
  di Claude. Sul Mac il 6/10 Axiom ha chiuso la sessione dopo 11 minuti e poi ha risposto 404 a tutto da quella rete
  (blocco dell'IP, probabilmente per le 429 del ponte). La persona assicura che dall'altro PC Axiom funziona: **la
  lettura di Axiom si rifa' li', come demone autonomo sul modello di fomo-mcp** (vedi "Da fare"). GMGN per ora no.
- **`scripts/fomo/simula.js`**: simulazione su carta (regole + ombre di @Tekkerrss e @NinjaTradeCr), in pausa.

## Cosa si e' capito (caso per caso, mai medie: vedi `docs/memoria-claude/coda-non-media.md`)

- Il segnale "molti utenti fomo in un token appena nato" **trova** i runner (ROOT 35x, TIT 17x, QUOTA/Clanker 12x
  nell'ora dopo), ma quasi tutti crollano entro l'ora: conta uscire in fretta.
- Un vantaggio ripetibile **non e' dimostrato**: su 338 giri da $100 (ingresso al primo giro con >= 5 holder fomo,
  uscita 2x, stop -30%) il risultato va da +$3.486 a -$4.760 secondo il prezzo preso dentro il minuto del segnale.
  Serve il prezzo esatto dalle transazioni on-chain (Helius), al secondo del segnale + ~8 s di ritardo: proposto, non fatto.
- Il controllo della narrativa su X fatto da sub-agenti non era predittivo (Ash giudicato "debole" e poi 20x): sospeso.

## Da fare

0. **Demone Axiom** (`scripts/axiom/axiom_live.mjs`, sull'altro PC): processo Node autonomo come fomo-mcp, con
   playwright-core e il Chrome installato in un **profilo persistente dedicato** (`dati/axiom/profilo/`): la prima volta
   si apre con la finestra e la persona fa il login, poi gira senza finestra e la sessione resta nel profilo. Dentro la
   pagina axiom.trade:
   - apre **un solo** WebSocket `wss://horn.axiom.trade/ws` e si iscrive ai token di `GET /axiom-lista` di bonding_live
     (`{type:'view', view:[{chain:'sol', tokenAddress}]}`; arrivano 'replay' e 'post' dalle fonti axiom, gmgn, pumpfun,
     fomo: fomo si scarta); normalizza i callout come fa `avvia_axiom.js` (funzione `norm`);
   - legge `api8.axiom.trade/x-tweets?tokenAddress=&limit=50&all=1` uno alla volta, primi 15 token, ogni 2 minuti;
   - manda tutto a `POST /axiom` di bonding_live ogni 15 s (formato `{q, ws:{stato}, dati:{tok:{callouts, tweets}}}`,
     gia' gestito da bonding_live.mjs e dalla pagina);
   - lascia che sia la pagina di Axiom a rinnovare la sessione (sul Mac `refresh-access-token` rispondeva 401 gia' dal
     login: verificare che col profilo persistente il rinnovo funzioni e che la sessione regga piu' di 30 minuti);
   - su 401/403, chiusura 4401/4403 o "Session invalid" si ferma e lo scrive nello stato; su 429 aspetta e rallenta;
     ricollega il WebSocket con attese crescenti. Partire con pochi token e alzare solo se regge.
1. Misura on-chain del prezzo al segnale su 50-100 token (decide se il segnale e' sfruttabile).
2. Tarare le soglie dei runner con `storia.jsonl`.
3. Aggiornare il documento di studio su Claude Docs ("Studio fomo.family", link in `docs/memoria-claude/fomo-family.md`).

## Rimettere in piedi su un altro PC

1. **Repo**: `git clone git@github.com:manumastro/pump-amm-sniper.git`, branch `analisi/fomo` (lo sniper e' su `main`).
   Node 20+ e Python 3; `npm install` nella radice del repo (serve `@solana/web3.js`).
2. **fomo-mcp** (il client dell'API di fomo, fuori dal repo): `git clone https://github.com/ColinEdw/fomo-mcp.git` nella
   cartella home (`~/fomo-mcp`, su Windows `C:\Users\<nome>\fomo-mcp`), `git checkout e97d14a`,
   `git apply <repo>/docs/fomo-mcp-modifiche.patch` (lettura del token da `FOMO_TOKEN_FILE`), `npm install`,
   `npm run build`. Usa il Chrome installato.
3. **Chiavi**: creare a mano `.env.fomo` nella radice del repo con `FOMO_ALCHEMY_KEY` e `FOMO_HELIUS_KEY` (portarle in modo
   privato, mai nel repo). Le regole sulle chiavi sono in `CLAUDE.md`.
4. **Dati**: `dati/` e' fuori da git (~1,5 GB); la dashboard live non ne ha bisogno (si riempie da sola), gli studi sui
   trader si'.
5. **Memorie di Claude**: copiare `docs/memoria-claude/*.md` nella cartella memoria del progetto di Claude Code
   (su macOS/Linux `~/.claude/projects/<percorso-del-repo-con-trattini>/memory/`, su Windows
   `%USERPROFILE%\.claude\projects\<percorso-del-repo-con-trattini>\memory\`, es. `C--Users-nome-pump-amm-sniper`).
6. **Avvio**: `python3 scripts/fomo/servi.py` (ponte del token), login a fomo.family nel browser di Playwright, poi da
   Claude Code `browser_run_code_unsafe` con `scripts/fomo/avvia_token.js`, poi
   `FOMO_TOKEN_FILE=~/.config/fomo-mcp/token node scripts/fomo/bonding_live.mjs` (su Windows PowerShell:
   `$env:FOMO_TOKEN_FILE="$HOME\.config\fomo-mcp\token"; node scripts/fomo/bonding_live.mjs`).

Note Windows: tutti gli script che importano fomo-mcp (`bonding_live.mjs`, `bonding_ora.mjs`, `simula.js`, `tesi.js`,
`bonding.js`, `bonding_studio.js`, `narrativa_fomo.mjs`, `profilo.mjs`) lo fanno con un URL `file://` (`pathToFileURL`)
e funzionano anche li' (corretti il 6/10). Gli script `.sh` (zsh) su Windows non girano:
servono WSL o Git Bash.
