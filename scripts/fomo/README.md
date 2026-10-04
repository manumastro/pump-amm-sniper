# Pipeline fomo

Script permanenti degli studi su fomo.family. Chiavi in `.env.fomo` (mai nel `.env` dello sniper),
dati in `dati/fomo/` (fuori da git, ~1,5 GB). Metodo in `docs/analisi-wallet.md`.

## Il giro quotidiano

1. **Login** a fomo.family nel browser Playwright (lo fa la persona), poi aprire la classifica.
2. **Scarico** (solo il nuovo rispetto ai dati salvati):
   ```
   python3 scripts/fomo/prepara_scarico.py          # scrive dati/fomo/grezzi/scarico.js
   ```
   Leggere `dati/fomo/grezzi/scarico.js` e passarlo a `browser_evaluate`; lo stato con
   `() => window.__fomoStato()`; a `fine` valorizzato, salvare con
   `browser_evaluate(() => JSON.stringify(window.__fomoScarico), filename=".playwright-mcp/scarico.json")`.
   ```
   python3 scripts/fomo/importa.py .playwright-mcp/scarico.json
   ```
3. **Wallet nuovi**: `node scripts/fomo/wallet.js` (solo chi non ce l'ha).
4. **Prezzi e liquidita'**: `python3 scripts/fomo/prezzi.py`.
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
| `prezzi/<ora>.json` | prezzo, liquidita' del pool principale (`liq`) e di tutti i pool (`liq_tot`) |
| `risultati/` | report e controprove |
| `grezzi/` | scarichi della pagina gia' importati |

## Fornitori e limiti

- **Alchemy gratuito**: 300 CU al secondo per tutte le reti insieme (`ALCHEMY_PER_SEC`, di
  default 10 richieste al secondo). Un solo script Alchemy alla volta.
- **Helius gratuito**: crediti mensili. Lo usano `storia.js` (lettura veloce del conto USDC,
  100 transazioni per chiamata) e `wallet.js` (solo se il metodo dei saldi fallisce). Esaurito,
  `storia.js` passa da solo ad Alchemy.
- **fomo**: circa 4-9 utenti al minuto per uno scarico completo a 30 giorni; incrementale molto meno.
- **dexscreener**: `tokens/v1` da' solo la coppia maggiore; `token-pairs/v1` tutti i pool.
