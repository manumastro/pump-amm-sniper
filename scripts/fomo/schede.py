# Schede dei migliori in markdown, per tipo, caso per caso: per ogni trader i giri che fanno il
# risultato (token, data, quanto, come e' entrato e uscito letto sulla catena) e quelli peggiori,
# con la concentrazione esplicita. Niente valori "tipici": i migliori sono pochi e vincono con pochi giri.
# Uso: python3 schede.py [prezzi.json]   -> risultati/schede-<tipo>.md
import os, sys, json, glob
from datetime import datetime, timezone
from comune import DATI, leggi, utenti, giri, ts, norm, SOL, RH
ult = lambda pref: sorted(f for f in os.listdir(os.path.join(DATI, 'risultati')) if f.startswith(pref))[-1]
R = leggi('risultati/' + ult('ritratti-')); E = leggi('risultati/' + ult('entrate-'), {})
PX = leggi('prezzi/' + (sys.argv[1] if len(sys.argv) > 1 else sorted(os.listdir(os.path.join(DATI, 'prezzi')))[-1]))
CAT = {SOL: 'Solana', RH: 'Robinhood', 1: 'Ethereum', 8453: 'Base', 56: 'BSC'}
SLUG = {SOL: 'solana', RH: 'robinhood', 1: 'ethereum', 8453: 'base', 56: 'bsc'}
# numeri all'italiana solo dentro i numeri (non su testo e indirizzi)
num = lambda s: s.replace(',', '\x00').replace('.', ',').replace('\x00', '.')
eur = lambda x: ('+' if x >= 0 else '−') + num(f"${abs(x)/1e6:,.2f}M" if abs(x) >= 1e6 else f"${abs(x)/1e3:,.1f}k" if abs(x) >= 1e3 else f"${abs(x):,.0f}")
pc = lambda x: '—' if x is None else (('+' if x >= 0 else '−') + f"{abs(x):.0%}")
pp = lambda x: '—' if x is None else f"{x:.0%}"
ten = lambda m: 'aperto' if m is None else f"{m:.0f} min" if m < 90 else num(f"{m/60:.1f} h") if m < 2880 else num(f"{m/1440:.1f} giorni")
it = lambda s: s
data = lambda t: datetime.fromtimestamp(t, timezone.utc).strftime('%d/%m %H:%M')
SYM = {}
for u in utenti():
    for b in leggi(f'utenti/{u}.json').get('bal', []):
        if b.get('tok') and b.get('sym'): SYM[norm(b['tok'])] = b['sym']
def uscita(V, p):
    if not p or not p.get('px'): return 0.0
    y = (p.get('liq_tot') or p['liq'] or 0) / 2; return y * V / (y + V) if y > 0 and V > 0 else 0.0
def giri_di(u):
    # gli stessi giri di migliori.py: 30 giorni, aperti venduti adesso al prezzo ottenibile
    D = leggi(f'utenti/{u}.json'); fine = ts(D['preso'])
    bal = {(b['net'], norm(b['tok'])): b['q'] for b in D.get('bal', []) if b.get('tok')}
    G = [g for g in giri(D['swaps'], u) if g['t0'] >= fine - 30 * 86400 and not g['dep'] and g['inv'] >= 10 and g['stato'] != 'altro']
    for g in G:
        if g['stato'] == 'chiuso': g['netto'] = g['ret'] - g['inv']
        else:
            q = min(max(0, g['qb'] - g['qs']), bal.get((g['net'], g['tok'])) or 0); p = PX.get(f"{g['net']}:{g['tok']}")
            g['netto'] = g['ret'] + uscita(q * (p['px'] if p and p.get('px') else 0), p) - g['inv']
    return G
def tok(g):
    s = SYM.get(g['tok']) or (g['tok'][:4] + '…' + g['tok'][-4:])
    return f"[{s}](https://fomo.family/tokens/{SLUG.get(g['net'], g['net'])}/{g['tok']})"
def catena(u, g):
    # come e' entrato e uscito, se il giro e' stato letto sulla catena (entrate.js)
    for m in E.get(u, []):
        if m['tok'] == g['tok'] and abs(m['t0'] - g['t0']) < 2:
            if m.get('entrata') and m.get('prezzo_catena') and abs(m['prezzo_catena'] / m['entrata'] - 1) > .3: return 'grafico non affidabile'
            return it(f"1h prima {pc(m.get('pre60'))}, max dentro {pc(m.get('massimo'))}, esce a {pc(m.get('uscita'))}, 1h dopo {pc(m.get('dopo60'))}")
    return ''
def riga(u, g):
    return it(f"| {data(g['t0'])} | {tok(g)} | {CAT.get(g['net'], g['net'])} | {eur(g['inv'])[1:]} | {eur(g['netto'])} ({pc(g['netto'] / g['inv'])}) | {ten((g['t1'] - g['t0']) / 60 if g['t1'] else None)} | ") + catena(u, g) + ' |'
TESTA = ['| entrata (UTC) | token | catena | investito | risultato | tenuta | sulla catena |', '| --- | --- | --- | --- | --- | --- | --- |']
for tipo in ('rapido', 'swing', 'colpo grosso', 'macchina'):
    xs = sorted([(u, x) for u, x in R.items() if x['tipo'] == tipo], key=lambda ux: -ux[1]['totale'])
    md = ['| trader | giri chiusi | investito | risultato | senza il giro migliore | quota dei 5 giri migliori | giri vinti | catena principale |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
    G = {u: sorted(giri_di(u), key=lambda g: -g['netto']) for u, _ in xs}
    for u, x in xs:
        cat = max(x['catene'].items(), key=lambda kv: kv[1]); lordo = sum(g['netto'] for g in G[u] if g['netto'] > 0) or 1
        chiusi = [g for g in G[u] if g['stato'] == 'chiuso']
        md.append(it(f"| [@{x['h']}](https://fomo.family/profile/{x['h']}) | {x['giri']} | {eur(x['cap'])[1:]} | {eur(x['totale'])} | {eur(x['senza_migliore'])} | {pp(sum(g['netto'] for g in G[u][:5] if g['netto'] > 0) / lordo)} | {sum(1 for g in chiusi if g['netto'] > 0)} su {len(chiusi)} | {cat[0]} {cat[1]:.0%} |"))
    md.append('')
    for u, x in xs:
        g = G[u]; lordo = sum(y['netto'] for y in g if y['netto'] > 0) or 1
        q = lambda n: sum(y['netto'] for y in g[:n] if y['netto'] > 0) / lordo
        righe = [f"### @{x['h']}", '']
        righe.append(it(f"**Il mese:** {len(g)} giri ({x['giri']} chiusi), {eur(x['cap'])[1:]} investiti, risultato {eur(x['totale'])} contando le posizioni aperte vendute adesso al prezzo ottenibile. Il guadagno lordo e' {eur(lordo)}: il giro migliore ne fa il {pp(q(1))}, i primi 5 il {pp(q(5))}, i primi 10 il {pp(q(10))}. Senza il giro migliore resta {eur(x['senza_migliore'])}."))
        if x.get('giorni'):
            righe.append(it(f"La curva di fomo (30 giorni): in guadagno il {pp(x['giorni_su'])} dei giorni, caduta peggiore {eur(x['caduta_max'])}, il giorno migliore vale il {pp(x['giorno_migliore'])} dei guadagni."))
        righe += ['', '**I giri che fanno il risultato**', ''] + TESTA + [riga(u, y) for y in g[:5] if y['netto'] > 0]
        righe += ['', '**I giri peggiori**', ''] + TESTA + [riga(u, y) for y in sorted(g, key=lambda y: y['netto'])[:3] if y['netto'] < 0]
        md += righe + ['']
    open(os.path.join(DATI, 'risultati', f"schede-{tipo.replace(' ', '_')}.md"), 'w').write('\n'.join(md))
    print(tipo, len(xs))
