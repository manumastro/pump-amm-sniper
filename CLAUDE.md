# fomo-studi (branch `analisi/fomo`)

**Scope: capire i trader migliori di fomo.family** — chi sono davvero, come operano, come funziona l'app — con analisi on-chain su Solana, Robinhood Chain ed EVM. Su questo branch lo sniper e' stato tolto (resta su `main`): qui ci sono solo studi, metodo e pipeline.

**fomo in breve.** App di trading "social": wallet Solana per utente (creato e finanziato dal co-firmatario `AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51`, che firma e paga il gas di ogni swap), router DFlow/Relay/OKX/Jupiter, commissione al "Fomo Fees Vault" `R4rNJHaffSUotNmqSKNEfDcJE8A7zJUkaoM5Jkd7cYX`, contante in USDC su Solana, le altre catene via Relay. Su EVM il wallet e' un EOA con delega EIP-7702, **lo stesso indirizzo su Robinhood, Ethereum, Base e BSC**. Gli indirizzi mostrati nei profili **non sono** i wallet on-chain. **Il PnL di classifica somma incassato, posizioni aperte a prezzo di mercato e perpetual aperti**: si misura sempre anche "come se si vendesse adesso", al prezzo ottenibile con la liquidita' dei pool.

**Come si lavora.** La pipeline sta in `scripts/fomo/` (giro quotidiano nel suo `README.md`), i dati in `dati/fomo/` (fuori da git). L'API di fomo (`prod-api.fomo.family/v2/...`) e' dietro login: lo fa la persona nel browser Playwright, l'header `Authorization` si cattura dentro la pagina e non si stampa ne' si scrive mai. Dall'API si prende chi guardare e cosa ha dichiarato; i numeri si verificano sulla catena.

**Chiavi.** Gli studi leggono **solo `.env.fomo`** (`FOMO_ALCHEMY_KEY`, `FOMO_HELIUS_KEY`): sono chiavi riservate agli studi, mai nel `.env` dello sniper e mai sotto i nomi che lo sniper legge (`SVS_*`). Alchemy gratuito: 300 CU al secondo per tutte le reti, un solo script Alchemy alla volta. Helius gratuito: crediti mensili, da spendere solo dove serve (`storia.js`). Mai publicnode per la storia (~16 ore).

**Si studia la coda, non la media.** I trader che contano sono pochissimi (29 su 1.328 nello studio del 4/10) e i guadagni stanno in pochissimi giri (nella bonding pump.fun: senza i 10 giri migliori su 2.988 il risultato passa da +$118k a −$9k). Medie e mediane descrivono la massa che perde, non chi ci si vuole ispirare: ogni risultato si presenta **caso per caso** (chi, quale token, quale transazione, quanto), con la concentrazione esplicita (quanto pesano i primi 1, 10, 50) e il numero sempre accanto alla quota. Una mediana si usa solo per dire com'e' la massa, mai come ritratto dei migliori, e va detto ogni volta.

**Regole.** Un numero letto su un sito (PnL di fomo, gmgn, dexscreener) non e' un dato finche' non lo si verifica on-chain (`docs/verifica-onchain.md`) · un trader scelto perche' ha vinto si misura dove non e' stato scelto: altra meta' del periodo, senza il giro migliore · ogni conclusione porta la transazione che la dimostra · le credenziali vivono solo in `.env.fomo`, mai nel repo e mai a schermo · gli script di pipeline stanno in `scripts/fomo/`, quelli usa-e-getta nello scratchpad · `node --check` per controllare un file JS · documentazione e commit in italiano · il documento di studio per la persona e' su Claude Docs ("Studio fomo.family") e va aggiornato quando cambiano i risultati.

**Documenti** — leggere quello di competenza *prima* di agire:
- **`docs/ripresa.md`** — stato attuale (dashboard dei token in bonding, prop firm, cosa e' dimostrato e cosa no) e come rimettere tutto in piedi su un altro PC; le memorie di Claude sono copiate in `docs/memoria-claude/`.
- **`scripts/fomo/README.md`** — il giro quotidiano, le cartelle dei dati, i limiti dei fornitori.
- **`docs/analisi-wallet.md`** — come si studia un trader: fonti, trappole, dal profilo al wallet vero, giri, solidi, classifiche "come se si chiudesse", trader automatici, prova fuori campione.
- **`docs/verifica-onchain.md`** — come si misura sulla catena; controprove su solscan/blockscout.
- **`docs/programmi.md`** — program id e indirizzi che si incontrano (DEX, router, fomo, Relay).
- `docs/rpc.md` — fornitori e trappole.
- `analysis/README.md` indicizza gli studi.
