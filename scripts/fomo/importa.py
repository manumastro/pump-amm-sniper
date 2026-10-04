# Unisce uno scarico della pagina (JSON salvato con browser_evaluate in .playwright-mcp/) ai dati:
# classifiche in classifiche/<ora>.json, swap e trasferimenti nuovi in utenti/<id>.json.
# Uso: python3 importa.py <file.json>
import json, sys, os
from comune import DATI, leggi, scrivi
raw = open(sys.argv[1]).read(); d = json.loads(raw)
if isinstance(d, str): d = json.loads(d)
ora = d['inizio'][:16].replace(':', '')
scrivi(f'classifiche/{ora}.json', dict(preso=d['inizio'], **{k: v for k, v in d['classifiche'].items()}))
# fotografia di questa lettura (rank, PnL, posizioni, perp): serve per confrontare una lettura con la dopo
scrivi(f'istantanee/{ora}.json', {u: dict(profilo=v['profilo'], bal=v['bal'], altro=v['altro'], preso=v['preso']) for u, v in d['utenti'].items()})
k = lambda s: (s['t'], s['i'], s['o'], s['ia'], s['oa'])
nuovi = swap = 0
for u, v in d['utenti'].items():
    r = leggi(f'utenti/{u}.json', {'id': u, 'swaps': [], 'transfers': []})
    if not r.get('swaps'): nuovi += 1
    viste = {k(s) for s in r['swaps']}
    agg = [s for s in v['swaps'] if k(s) not in viste]; swap += len(agg)
    r['swaps'] = sorted(r['swaps'] + agg, key=lambda s: s['t'])
    vt = {(t['createdAt'], t['tokenAddress'], t['humanAmount']) for t in r.get('transfers', [])}
    r['transfers'] = sorted(r.get('transfers', []) + [t for t in v['transfers'] if (t['createdAt'], t['tokenAddress'], t['humanAmount']) not in vt], key=lambda t: t['createdAt'])
    for c in ('profilo', 'bal', 'altro', 'preso'): r[c] = v[c]
    r['troncato'] = v['troncato']; r['fallito'] = v['fallito']
    scrivi(f'utenti/{u}.json', r)
os.replace(sys.argv[1], os.path.join(DATI, 'grezzi', f'scarico-{ora}.json'))
print(f"classifiche {ora}: {', '.join(f'{p} {len(x)}' for p, x in d['classifiche'].items())}; utenti {len(d['utenti'])} ({nuovi} nuovi), swap aggiunti {swap}, falliti {sum(1 for v in d['utenti'].values() if v['fallito'])}")
