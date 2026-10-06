# Tabella di tutti gli acquisti simulati (solo entrate): link, ora di entrata, mcap e prezzo all'entrata, mcap ora,
# multiplo e profitto se si vendesse adesso (con impatto sul pool e commissione). Da dati/fomo/simulazione/stato.json.
import json, os
s = json.load(open(os.path.join(os.path.dirname(__file__), '../../dati/fomo/simulazione/stato.json')))
k = lambda v: '—' if v is None else (f"${v/1e6:.2f}M" if v >= 1e6 else f"${v/1e3:.1f}k").replace('.', ',')
pz = lambda v: '—' if v is None else f"{v:.3g}".replace('.', ',')
eur = lambda v: ('+' if v >= 0 else '−') + f"${abs(v):,.0f}".replace(',', '.')
righe = []
for b, x in s['binari'].items():
    for a in x['aperte']: righe.append((a['entrata'], b, a))
righe.sort(key=lambda r: (r[0], r[1], r[2]["sym"] or ""))
print(f"aggiornato {s['aggiornato'][11:19]} UTC\n")
print('| entrata (UTC) | conto | token | mcap entrata | prezzo entrata | mcap ora | multiplo | profitto se vendo |')
print('| --- | --- | --- | --- | --- | --- | --- | --- |')
for t, b, a in righe:
    print(f"| {t} | {b} | [{a['sym']}]({a['link']}) | {k(a['mcap0'])} | {pz(a['p0'])} | {k(a.get('mcap_ora'))} | {str(a['multiplo']).replace('.', ',')}x | {eur(a['profitto_se_vendo'])} |")
print()
for b, x in s['binari'].items(): print(f"- {b}: {len(x['aperte'])} acquisti, se vendessi tutto ora {eur(x['netto_aperte_se_vendo'])}")
