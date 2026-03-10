# Solscan Debug Parser (Creator/Token + Time Window)

Minimal DrissionPage parser used only for manual debug/investigation.

It reads Solscan account tabs:

- `Transactions`
- `Transfers`
- `Activities`

for both:

- a `creator` account
- a `token` mint account

within a specific timestamp window.

Output is saved as local JSON.
Oltre al file principale, il parser salva anche due dump separati:

- `<output>_raw_creator_tabs.json`
- `<output>_raw_token_tabs.json`

Per ogni tab il JSON salva:

- `rows_seen`: tutte le righe viste nella scheda
- `rows_in_range`: solo le righe che ricadono nella finestra richiesta
- `diagnostics`: stato del tab e contatori utili

Se Solscan mostra solo tempi relativi (`19 mins ago`, `just now`), il parser lo segnala con warning e `diagnostics.status = rows_seen_but_none_in_range_relative_time_only`.
Prima del parsing il tool prova anche a cliccare il toggle del clock nella colonna `Time` per ottenere timestamp assoluti; se Solscan non espone il menu o il click fallisce, continua in fallback sui tempi relativi.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Run

```bash
xvfb-run -a .venv/bin/python src/debug_account_tabs.py \
  --creator <CREATOR_ACCOUNT> \
  --token <TOKEN_MINT> \
  --from-local "YYYY-MM-DD HH:MM:SS" \
  --to-local "YYYY-MM-DD HH:MM:SS" \
  --tz Europe/Berlin \
  --tabs transactions,transfers,activities \
  --output ../last_rugpulls/solscan_debug.json
```

Per server/headless Linux usare `xvfb-run -a` e NON passare `--headless` (Cloudflare è molto più restrittivo in headless puro).

Se vuoi leggere direttamente l'output JSON da terminale senza salvare file:

```bash
xvfb-run -a .venv/bin/python src/debug_account_tabs.py ... --stdout-only
```

Per ottenere timestamp reali e dati parsed on-chain dalle signature viste su Solscan:

```bash
.venv/bin/python src/hydrate_solscan_dump.py \
  --input ../last_rugpulls/solscan_debug_raw_creator_tabs.json
```

Il file risultante sarà:

- `<input>_hydrated.json`

Lo script prova prima l'Enhanced Transactions API di Helius; se non disponibile, fa fallback automatico a `getTransaction` RPC.

## Notes

- This parser is for investigation only.
- Do not use this parser in real-time bot decision flow.
- Se un tab non contiene righe nella finestra, controlla sempre `rows_seen` e `warnings` prima di concludere che i dati mancano davvero.
