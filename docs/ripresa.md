# Ripresa del lavoro su un altro PC (stato al 6/10/2026)

Riassunto per ripartire con Claude Code da un'altra macchina (anche Windows) senza la conversazione originale, che
contiene token e chiavi e non va nel repo pubblico. Da leggere insieme a `CLAUDE.md` e `scripts/fomo/README.md`.

## Di cosa si tratta adesso

Lo studio e' partito dai trader migliori di fomo.family; **dal 4/10 lo scope e' l'analisi dei token in bonding su
fomo**: scovare presto i token che in pochi minuti prendono utenti fomo, tesi e soldi (es. Agent Capital, 4/10: 5 wallet
fomo al minuto 6 a ~$9k, graduato al minuto 19). Tutto e' **solo lettura e simulazione su carta**: nessuno swap, mai
`/swaps/v2` o `requestSwapQuote`, nessun click su buy/trade/callout.

La persona trada su una **prop firm** dove "Only pump/bonk/bags/brrr tokens are tradeable": si guardano solo i mint che
finiscono in pump, bonk, BAGS o brrr. Quelli sul programma pump.fun con un mint diverso (es. agencypad) **non** sono
tradabili (confermato dalla persona il 6/10): il filtro della pagina e della tabella li esclude.

## Il sistema

- **`scripts/fomo/bonding_live.mjs`** + **`bonding_live.html`**: dashboard locale su http://127.0.0.1:8787. Un processo,
  un Chrome headless (via fomo-mcp), un giro ogni 5-9 s: liste `filtered-bonding`, `bonding`, `new` di fomo, holder fomo,
  tesi, feed, curva on-chain se fomo da' 0%. Al massimo 4 chiamate a fomo insieme (con 6 arrivano i 429).
  - In cima i **potenziali runner**: token ancora in bonding (dal 6/10 senza il limite delle 6 ore) con almeno 2 di 5 segnali (holder: >= 5 utenti fomo in 5 min;
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

0. ~~Demone Axiom~~ **fatto il 6/10 su Windows** (`scripts/axiom/`), ma **solo REST, niente WebSocket** (scelta della
   persona), sul modello di fomo-mcp. Nella scheda Axiom loggata del browser Playwright gira `avvia_sessione.js` (come
   `avvia_token.js`): a ogni rinnovo della pagina e ogni 2 minuti manda a `servi.py` il cookie d'accesso, i cookie
   Cloudflare e lo user-agent (-> `~/.config/axiom/sessione`); il refresh token resta nella scheda. `axiom_live.mjs` e' un
   processo Node con un Chrome headless (playwright-core di `~/fomo-mcp`) che legge `callouts-feed` (gli ultimi 200 callout
   Axiom Solana, ~2 ore, una chiamata al minuto) e `x-tweets` (primi 15 token, uno alla volta, ogni 2 minuti), con al massimo
   10 token (`AXIOM_MAX`), e manda tutto a `POST /axiom` di bonding_live. Su 401/403/"Session invalid" smette di chiamare e
   aspetta una sessione nuova; su 429 si ferma e rallenta. Il 6/10 il rinnovo della sessione dalla pagina funzionava
   (refresh-access-token 200, cookie nuovo arrivato al demone) e le prime 22 chiamate erano senza errori; il test lungo
   (30 minuti, poi alzare i token) non e' stato fatto. **Manca rispetto al WebSocket:** callout GMGN e commenti pump.fun
   (solo via `horn`). Il ponte WebSocket (`scripts/fomo/avvia_axiom.js`) non si usa.
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
7. **Axiom** (facoltativo): login ad Axiom in una scheda del browser di Playwright, `browser_run_code_unsafe` con
   `scripts/axiom/avvia_sessione.js`, poi `node scripts/axiom/axiom_live.mjs >> dati/axiom/axiom.log 2>&1` (in background;
   stato in `dati/axiom/stato.json`, la pagina live lo mostra). Come per fomo, il ponte vive nel browser di Playwright: va
   rilanciato a ogni nuova sessione di Claude Code. Su Windows i processi in background si lanciano dalla shell Bash (Git
   Bash) con `>> log 2>&1`: da PowerShell lo stderr finisce nel log come errore.

Note Windows: tutti gli script che importano fomo-mcp (`bonding_live.mjs`, `bonding_ora.mjs`, `simula.js`, `tesi.js`,
`bonding.js`, `bonding_studio.js`, `narrativa_fomo.mjs`, `profilo.mjs`) lo fanno con un URL `file://` (`pathToFileURL`)
e funzionano anche li' (corretti il 6/10). Gli script `.sh` (zsh) su Windows non girano:
servono WSL o Git Bash. Se `bonding_live.mjs` si ferma con `listen EACCES ... 8787`, Windows ha messo la porta tra
quelle riservate (`netsh int ipv4 show excludedportrange protocol=tcp`, cambia a ogni riavvio): lanciare
`bonding_live.mjs` e `axiom_live.mjs` con la stessa `PORTA=8788` (successo il 10/10).

Dal 10/10 fomo non manda piu' il token nell'header `Authorization`: viaggia nel cookie `privy-token` di
`prod-api.fomo.family`, ed e' da li' che lo prende `avvia_token.js` (l'header resta come riserva).
