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

## Notes

- This parser is for investigation only.
- Do not use this parser in real-time bot decision flow.
