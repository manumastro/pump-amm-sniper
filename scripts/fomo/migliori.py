# I migliori, sui dati di oggi. Per ogni utente, ultimi 30 giorni prima del suo ultimo scarico, giri
# dagli swap fomo; le posizioni aperte contano come vendute adesso al prezzo ottenibile (tutti i pool).
# Migliore = almeno 10 giri chiusi, almeno $5.000 di totale, positivo senza il giro migliore, giri
# chiusi positivi in entrambe le meta' della finestra. Poi le misure di stile per dividerli in tipi.
# Uso: python3 migliori.py [prezzi.json]   -> risultati/migliori-<data>.json
import json, os, sys, collections, statistics
from datetime import datetime, timezone
from comune import DATI, leggi, scrivi, utenti, giri, ts, norm, SOL, RH
pf = sys.argv[1] if len(sys.argv) > 1 else sorted(os.listdir(os.path.join(DATI, 'prezzi')))[-1]
PX = leggi(f'prezzi/{pf}'); CM = leggi('risultati/chainmeta.json', {}); RM = leggi('risultati/rh_meta.json', {})
CAT = lambda n: {SOL: 'Solana', RH: 'Robinhood'}.get(n, 'EVM')
def uscita(V, p):
    if not p or not p.get('px'): return 0.0
    y = (p.get('liq_tot') or p['liq'] or 0) / 2; return y * V / (y + V) if y > 0 and V > 0 else 0.0
def meta(net, tok):
    m = CM.get(tok) if net == SOL else RM.get(tok.lower()) if net == RH else None
    return m or {}
M = lambda xs: statistics.median(xs) if xs else None
out = {}
for u in utenti():
    D = leggi(f'utenti/{u}.json')
    if not D.get('preso') or not D.get('swaps'): continue
    fine = ts(D['preso']); inizio = fine - 30 * 86400; meta_f = inizio + 15 * 86400
    bal = {(b['net'], norm(b['tok'])): b['q'] for b in D.get('bal', []) if b.get('tok')}
    G = [g for g in giri(D['swaps'], u) if g['t0'] >= inizio and not g['dep'] and g['inv'] >= 10 and g['stato'] != 'altro']
    chiusi = [g for g in G if g['stato'] == 'chiuso']
    if len(chiusi) < 10: continue
    nets = []
    for g in G:
        if g['stato'] == 'chiuso': g['netto'] = g['ret'] - g['inv']
        else:
            q = min(max(0, g['qb'] - g['qs']), bal.get((g['net'], g['tok'])) or 0); p = PX.get(f"{g['net']}:{g['tok']}")
            g['netto'] = g['ret'] + uscita(q * (p['px'] if p and p.get('px') else 0), p) - g['inv']
        nets.append(g['netto'])
    tot = sum(nets); migliore = max(nets); lordo = sum(x for x in nets if x > 0)
    a = sum(g['netto'] for g in chiusi if g['t1'] < meta_f); b = sum(g['netto'] for g in chiusi if g['t1'] >= meta_f)
    vinti = [g for g in chiusi if g['netto'] > 0]; persi = [g for g in chiusi if g['netto'] <= 0]
    ten = [(g['t1'] - g['t0']) / 60 for g in chiusi]
    eta = []; mcap = []
    for g in G:
        m = meta(g['net'], g['tok'])
        if m.get('nascita'): eta.append((g['t0'] - m['nascita']) / 3600)
        if m.get('supply') and g['qb']: mcap.append(g['inv'] / g['qb'] * m['supply'])
    cap = sum(g['inv'] for g in G); percat = collections.Counter()
    for g in G: percat[CAT(g['net'])] += g['inv']
    giorni = max(1, (fine - min(g['t0'] for g in G)) / 86400)
    out[u] = dict(h=(D.get('profilo') or {}).get('handle'), follower=(D.get('profilo') or {}).get('followers'),
        giri=len(chiusi), aperti=len(G) - len(chiusi), cap=cap, totale=tot, incassato=sum(g['netto'] for g in chiusi),
        senza_migliore=tot - migliore, meta1=a, meta2=b, quota_migliore=migliore / lordo if lordo > 0 else None,
        vinti=len(vinti) / len(chiusi), guadagno_tipico=M([g['netto'] / g['inv'] for g in vinti]), perdita_tipica=M([g['netto'] / g['inv'] for g in persi]),
        tenuta=M(ten), giri_g=len(chiusi) / giorni, cap_giro=M([g['inv'] for g in G]), eta_h=M(eta), mcap=M(mcap),
        catene={k: v / cap for k, v in percat.items()}, preso=D['preso'],
        perp=(D.get('altro') or {}).get('livePerpPnl') or 0)
    r = out[u]
    r['troncato'] = bool(D.get('troncato'))
    r['migliore'] = r['totale'] >= 5000 and r['senza_migliore'] > 0 and a > 0 and b > 0
def tipo(r):
    if r['tenuta'] is not None and r['tenuta'] < 5: return 'macchina'
    if (r['quota_migliore'] or 0) >= 0.4: return 'colpo grosso'
    if r['tenuta'] < 120: return 'rapido'
    if r['tenuta'] < 2880: return 'swing'
    return 'cassettista'
for r in out.values(): r['tipo'] = tipo(r) if r['migliore'] else None
scrivi(f"risultati/migliori-{datetime.now(timezone.utc):%Y-%m-%d}.json", out)
B = [r for r in out.values() if r['migliore']]
print(f'utenti con almeno 10 giri chiusi in 30 giorni: {len(out)}; migliori: {len(B)}')
T = collections.defaultdict(list)
for r in B: T[r['tipo']].append(r)
for t, xs in sorted(T.items(), key=lambda kv: -len(kv[1])):
    print(f"\n== {t}: {len(xs)}  tenuta {M([x['tenuta'] for x in xs]):.0f} min  giri/g {M([x['giri_g'] for x in xs]):.1f}  vinti {M([x['vinti'] for x in xs]):.0%}  quota giro migliore {M([x['quota_migliore'] or 0 for x in xs]):.0%}  eta' token {M([x['eta_h'] for x in xs if x['eta_h'] is not None]) or 0:.1f} h  mcap {M([x['mcap'] for x in xs if x['mcap']]) or 0:,.0f}")
    for x in sorted(xs, key=lambda x: -x['totale'])[:12]:
        print(f"   @{str(x['h']):<20} giri {x['giri']:4} cap ${x['cap']:>11,.0f} totale {x['totale']:>+10,.0f} senza migl {x['senza_migliore']:>+10,.0f} vinti {x['vinti']:.0%} ten {x['tenuta']:.0f}m giri/g {x['giri_g']:.1f} quota migl {x['quota_migliore'] or 0:.0%} Sol {x['catene'].get('Solana',0):.0%} RH {x['catene'].get('Robinhood',0):.0%}")
