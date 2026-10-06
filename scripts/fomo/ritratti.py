# Ritratti dei migliori: i numeri del mese (migliori.py) piu' come entrano ed escono (entrate.js, prezzo dalla catena).
# Esclude i giri in cui il grafico non torna col prezzo pagato (scarto oltre il 30%).
# Uso: python3 ritratti.py   -> risultati/ritratti-<data>.json e riepilogo per tipo a schermo
import json, os, statistics, collections
from datetime import datetime, timezone
from comune import DATI, leggi, scrivi
ult = lambda pref: sorted(f for f in os.listdir(os.path.join(DATI, 'risultati')) if f.startswith(pref))[-1]
B = {u: r for u, r in leggi('risultati/' + ult('migliori-')).items() if r['migliore']}
E = leggi('risultati/' + ult('entrate-'), {})
M = lambda xs: statistics.median(xs) if xs else None
out = {}
for u, r in B.items():
    gg = [g for g in E.get(u, []) if 'errore' not in g and g.get('prezzo_catena') and abs(g['prezzo_catena'] / g['entrata'] - 1) < 0.3]
    vinti = [g for g in gg if (g.get('netto') or 0) > 0]
    e = dict(giri_grafico=len(gg),
             pre60=M([g['pre60'] for g in gg if g.get('pre60') is not None]),
             rincorre=(sum(1 for g in gg if (g.get('pre60') or 0) > 0.2) / len(gg)) if gg else None,
             calo=(sum(1 for g in gg if (g.get('pre60') or 0) < -0.1) / len(gg)) if gg else None,
             massimo=M([g['massimo'] for g in gg if g.get('massimo') is not None]),
             minimo=M([g['minimo'] for g in gg if g.get('minimo') is not None]),
             presa_vinti=M([g['presa'] for g in vinti if g.get('presa') is not None]),
             dopo60=M([g['dopo60'] for g in gg if g.get('dopo60') is not None]),
             liq=M([g['liq'] for g in gg if g.get('liq')]),
             esempi=sorted(gg, key=lambda g: -(g.get('netto') or 0))[:2])
    # curva giornaliera di PnL secondo fomo (a prezzo di mercato): costanza e cadute
    det = leggi(f'dettagli/{u}.json', {}); cv = sorted(det.get('curva') or [], key=lambda c: c['snapshotId'])
    if len(cv) >= 5:
        pnl = [c['pnl'] for c in cv]; dd = [b - a for a, b in zip(pnl, pnl[1:])]
        picco = pnl[0]; caduta = 0
        for x in pnl: picco = max(picco, x); caduta = min(caduta, x - picco)
        e.update(giorni=len(dd), giorni_su=sum(1 for x in dd if x > 0) / len(dd), caduta_max=caduta,
                 giorno_migliore=max(dd) / sum(x for x in dd if x > 0) if any(x > 0 for x in dd) else None, curva_var=pnl[-1] - pnl[0])
    tr = det.get('trades') or {}
    e['commenti'] = sum(1 for x in tr.get('chiusi', []) + tr.get('attivi', []) if x.get('comment'))
    out[u] = dict(r, **e)
scrivi(f"risultati/ritratti-{datetime.now(timezone.utc):%Y-%m-%d}.json", out)
T = collections.defaultdict(list)
for x in out.values(): T[x['tipo']].append(x)
p = lambda v: '—' if v is None else f'{v:+.0%}'
for t, xs in sorted(T.items(), key=lambda kv: -len(kv[1])):
    print(f"\n== {t} ({len(xs)}): sale nell'ora prima {p(M([x['pre60'] for x in xs if x['pre60'] is not None]))}, massimo da dentro {p(M([x['massimo'] for x in xs if x['massimo'] is not None]))}, presa {p(M([x['presa_vinti'] for x in xs if x['presa_vinti'] is not None]))}, dopo l'uscita {p(M([x['dopo60'] for x in xs if x['dopo60'] is not None]))}")
    for x in sorted(xs, key=lambda x: -x['totale']):
        print(f"     curva: giorni in su {p(x.get('giorni_su'))} caduta max {x.get('caduta_max') or 0:+,.0f} giorno migliore {p(x.get('giorno_migliore'))} commenti {x.get('commenti')}")
        print(f"  @{str(x['h']):<20} totale {x['totale']:>+10,.0f} senza migl {x['senza_migliore']:>+9,.0f} | giri col grafico {x['giri_grafico']:2} pre60 {p(x['pre60'])} rincorre {p(x['rincorre'])} calo {p(x['calo'])} max {p(x['massimo'])} min {p(x['minimo'])} presa {p(x['presa_vinti'])} dopo {p(x['dopo60'])} liq ${x['liq'] or 0:,.0f}")
