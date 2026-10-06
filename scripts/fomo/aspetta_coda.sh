#!/bin/zsh
# Aspetta finche' la coda dei controlli X (narrativa_coda.py) ha un token da controllare: a ogni acquisto della
# simulazione aggiorna la coda (solo token con link social e tesi di trader bravi) ed esce solo se c'e' qualcosa.
# Uso: scripts/fomo/aspetta_coda.sh
cd "$(dirname "$0")"
while true; do
  out=$(zsh ./aspetta_evento.sh | python3 ./narrativa_coda.py)
  if ! print -r -- "$out" | grep -q '"in_attesa": 0'; then print -r -- "$out"; exit 0; fi
done
