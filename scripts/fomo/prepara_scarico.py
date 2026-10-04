# Scrive dati/fomo/grezzi/scarico.js: la funzione di scarico_pagina.js con l'ora dell'ultimo swap gia'
# salvato per ogni utente (cosi' si scarica solo il nuovo). Uso: python3 prepara_scarico.py [id...]
import json, os, sys
from comune import DATI, utenti, utente
NOTI = {}
for u in utenti():
    v = utente(u)
    if v.get('swaps'): NOTI[u] = v['swaps'][-1]['t']
src = open(os.path.join(os.path.dirname(__file__), 'scarico_pagina.js')).read()
src = src[src.index('async () =>'):]
src = src.replace('__NOTI__', json.dumps(NOTI)).replace('__EXTRA__', json.dumps(sys.argv[1:]))
os.makedirs(os.path.join(DATI, 'grezzi'), exist_ok=True)
open(os.path.join(DATI, 'grezzi', 'scarico.js'), 'w').write(src)
print('scritto grezzi/scarico.js:', len(NOTI), 'utenti noti,', len(sys.argv) - 1, 'in piu\'')
