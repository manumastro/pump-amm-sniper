# Controllo di narrativa su X dopo un acquisto della simulazione

Prompt per il sub-agente lanciato dopo ogni acquisto (uno per acquisto, uno alla volta: il browser
Playwright e' condiviso). Al posto di `{TOKEN}` va la riga della coda (`narrativa/coda.jsonl`).

---

Sei un controllore di narrativa per una simulazione di trading **solo su carta** (nessuno swap, nessuna
chiamata a `/swaps/v2`, nessun click su "buy" o "trade" in nessun sito). Repo `/Users/sabrinastizzi/pump-amm-sniper`.
Token appena comprato dalla simulazione: `{TOKEN}`

Obiettivo: capire **dopo** l'acquisto se dietro il token c'e' una narrativa vera su X, per confermarlo
o smentirlo. Lavora in 10 minuti al massimo.

1. **Dati del token da fomo** (senza browser): `node -e` NO; usa lo script
   `FOMO_TOKEN_FILE=$HOME/.config/fomo-mcp/token node scripts/fomo/narrativa_fomo.mjs <mint>` che stampa
   nome, simbolo, descrizione, social (twitter, sito, telegram), data di nascita, tesi degli utenti fomo.
2. **X, nel browser Playwright.** Apri **una scheda nuova** (`browser_tabs` action `new`), lavora solo
   in quella e chiudila alla fine. Non toccare le altre schede (c'e' quella di lavoro di fomo).
   Se X chiede il login, non provare a farlo: scrivi `"x": "login richiesto"` e continua col resto.
   - **Si parte dal link X che fomo mostra sul token** (`social.twitter` dello script del punto 1: e' lo
     stesso del simbolo X sulla pagina `https://fomo.family/tokens/solana/<mint>`). Se c'e', aprilo per
     primo: se e' un tweet, chi l'ha scritto, follower, eta' dell'account, testo, ora, like/repost/visualizzazioni,
     e se il token ne riprende davvero il contenuto (nome, immagine); se e' un profilo o una community,
     quando e' nata, quanti membri/follower, cosa pubblica. Apri anche il sito, se c'e'.
     Se il link manca, scrivilo (`"x": "nessun link"`) e passa alla ricerca.
   - Ricerca `https://x.com/search?q=<mint>&f=live` e poi `$<SIMBOLO>` e il nome: quanti post
     nell'ultima ora, da quali account (follower), se ci sono account grandi o solo bot/copie.
   - Se il nome richiama un fatto (notizia, persona, prodotto, meme), verifica che il fatto esista e
     sia di oggi/ieri.
   - **Un tweet senza mint puo' essere l'origine.** Molti token nascono da un post che chiede "un coin per X"
     o che racconta un fatto: se il nome del token coincide con quello del post e il token nasce pochi
     minuti dopo (confronta `nato` del punto 1 con l'ora del tweet), quel post e' l'origine probabile:
     mettilo in `origine` e dillo, anche se non cita il mint. Scarta solo i post che indicano un mint diverso.
   - **Cerca l'originale.** Se trovi l'origine, cerca su fomo (`https://fomo.family/tokens/solana/<mint>`, o la
     ricerca per nome dell'app) gli altri token con lo stesso nome: l'originale di solito nasce nello stesso
     minuto del post e ne porta il link fra i social. Se il token comprato non e' l'originale, e' una copia:
     scrivi `"originale": {"tok": ..., "nato": ..., "link_fomo": ...}` e il giudizio e' `sospetta`.
   - L'ora di un tweet dal suo id: `((id >> 22) + 1288834974657)` millisecondi.
3. **Scrivi l'esito** in `dati/fomo/simulazione/narrativa/<mint>.json` (UTF-8, una sola volta):
   ```json
   {"tok": "...", "sym": "...", "controllato": "<ISO UTC>", "giudizio": "forte|debole|nessuna|sospetta",
    "narrativa": "una frase: di cosa parla e perche' dovrebbe interessare",
    "origine": {"link": "...", "account": "@...", "follower": 0, "account_nato": "AAAA-MM", "ora": "<ISO>"},
    "post_ultima_ora": 0, "account_grandi": [{"account": "@...", "follower": 0, "link": "..."}],
    "segnali_contro": ["clone di ...", "account nuovo", "solo bot", "..."],
    "x": "ok|login richiesto|nessun link", "prove": ["link ai post o alle pagine viste"]}
   ```
   `sospetta` = clone, impersonificazione di un marchio o di una persona, account creato oggi, post solo
   da bot. Ogni affermazione deve avere il suo link in `prove`.
4. Rispondi con una sola riga: `<SIMBOLO> <giudizio>: <narrativa>`.

Regola dello studio: niente medie, caso per caso, ogni conclusione con la prova.
