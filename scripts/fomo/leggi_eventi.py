# Stampa leggibile delle righe di eventi della simulazione (da stdin) e lo stato dei tre conti.
# Uso: scripts/fomo/aspetta_evento.sh | python3 scripts/fomo/leggi_eventi.py   (o con un file in stdin)
import sys, json, os
for l in sys.stdin:
    l = l.strip()
    if not l.startswith('{'): continue
    d = json.loads(l); r = lambda v: round(v, 4) if isinstance(v, float) else v
    if d['tipo'] == 'candidato':
        print(d['t'][11:19], 'CANDIDATO', d['sym'], d['tok'], d['lista'], 'curva', round(d.get('bp') or 0), 'min dopo grad', d.get('minDopo'), 'mcap', round(d['mcap'] or 0), 'liq', round(d['liq'] or 0), 'holder', d['holders'], 'top10', round(d['top10'] or 0, 1), 'vol5m', round(d['vol5m'] or 0), 'scartato', d['scartato'])
    else: print(d['t'][11:19], d['tipo'].upper(), {k: r(v) for k, v in d.items() if k not in ('t', 'tipo')})
s = json.load(open(os.path.join(os.path.dirname(__file__), '../../dati/fomo/simulazione/stato.json')))
for b, x in s['binari'].items(): print(b, 'chiuse', x['chiuse'], 'vinte', x['vinte'], 'netto chiuse', x['netto_chiuse'], 'aperte', [(a['sym'], a['multiplo']) for a in x['aperte']], 'se vendo', x['netto_aperte_se_vendo'])
