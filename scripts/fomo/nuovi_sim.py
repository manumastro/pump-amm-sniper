# Righe della tabella solo per gli acquisti nuovi (eventi 'entra' letti da stdin) + i totali dei tre conti.
# Uso: python3 scripts/fomo/nuovi_sim.py < uscita_di_aspetta_evento
import sys, json, os
nuovi = [json.loads(l) for l in sys.stdin if l.strip().startswith('{')]
chiavi = {(e['binario'], e['tok']) for e in nuovi if e['tipo'] == 'entra'}
tek = [e for e in nuovi if e['tipo'] == 'tekkerrss']
s = json.load(open(os.path.join(os.path.dirname(__file__), '../../dati/fomo/simulazione/stato.json')))
k = lambda v: '—' if v is None else (f"${v/1e6:.2f}M" if v >= 1e6 else f"${v/1e3:.1f}k").replace('.', ',')
pz = lambda v: '—' if v is None else f"{v:.3g}".replace('.', ',')
eur = lambda v: ('+' if v >= 0 else '−') + f"${abs(v):,.0f}".replace(',', '.')
print(f"aggiornato {s['aggiornato'][11:19]} UTC\n")
print('| entrata (UTC) | conto | launchpad | token | mcap entrata | prezzo entrata | mcap ora | multiplo | profitto se vendo |')
print('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for b, x in s['binari'].items():
    for a in sorted(x['aperte'], key=lambda a: a['entrata']):
        if (b, a['tok']) in chiavi:
            print(f"| {a['entrata']} | {b} | {a.get('lp') or '?'} | [{a['sym']}]({a['link']}) | {k(a['mcap0'])} | {pz(a['p0'])} | {k(a.get('mcap_ora'))} | {str(a['multiplo']).replace('.', ',')}x | {eur(a['profitto_se_vendo'])} |")
print()
for e in tek: print(f"- @Tekkerrss {e['lato']} {e.get('sym')} ${e['usd']:.0f} alle {e['quando'][11:19]}")
for b, x in s['binari'].items():
    print(f"- {b}: {len(x['aperte'])} acquisti, se vendessi tutto ora {eur(x['netto_aperte_se_vendo'])}")
    for l, v in sorted((x.get('per_launchpad') or {}).items(), key=lambda kv: -kv[1]['acquisti']): print(f"  - {l}: {v['acquisti']} acquisti, vinti {v['vinti']}, {eur(v['se_vendo'])}")
