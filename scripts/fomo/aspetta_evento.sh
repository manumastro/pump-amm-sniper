#!/bin/zsh
# Aspetta il prossimo evento importante della simulazione (entrata, vendita, chiusura, mossa di @Tekkerrss,
# decisione, candidato che passa i filtri) dopo la riga gia' letta; stampa le righe nuove ed esce.
# Uso: scripts/fomo/aspetta_evento.sh   (la riga letta sta in dati/fomo/simulazione/.letto)
cd "$(dirname "$0")/../../dati/fomo/simulazione"
letto=$(cat .letto 2>/dev/null || echo 0)
while true; do
  n=$(wc -l < eventi.jsonl | tr -d ' ')
  if (( n > letto )); then
    nuove=$(tail -n +$((letto + 1)) eventi.jsonl | head -n $((n - letto)))
    imp=$(print -r -- "$nuove" | grep -E '"tipo":"entra"')
    if [[ -n "$imp" ]]; then echo $n > .letto; print -r -- "$imp"; exit 0; fi
    letto=$n; echo $n > .letto
  fi
  sleep 15
done
