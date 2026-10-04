# Trader automatici: segnali per utente (almeno 100 swap in 30 giorni) e gruppi.
#  macchina          >=100 giri chiusi e tenuta mediana <= 3 minuti
#  chiave esportata  >50% degli swap on-chain firmati dal wallet stesso, senza il co-firmatario fomo
#  iperattivo        >=100 swap al giorno sul periodo coperto
# Piu' il copy-trading: il "leader" che precede piu' spesso l'utente (0-30 s, stesso token),
# confrontato col verso opposto. Le taglie ripetute NON sono un segnale (bottoni dell'app).
# Uso: python3 automatici.py   -> risultati/automatici-<data>.json e riepilogo a schermo
import json, os, collections, statistics, bisect
from datetime import datetime, timezone
from comune import DATI, leggi, scrivi, utenti, giri, ts, CASSA
CO = 'AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51'; USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; WSOL = 'So11111111111111111111111111111111111111112'
FINE = datetime.now(timezone.utc).timestamp(); INIZIO = FINE - 30 * 86400
U = {}; prime = {}; acq = collections.defaultdict(list)
for u in utenti():
    v = leggi(f'utenti/{u}.json'); sw = [s for s in v.get('swaps', []) if ts(s['t']) >= INIZIO]
    U[u] = dict(h=(v.get('profilo') or {}).get('handle'), sw=sw)
    ultimo = {}; P = []
    for s in sw:
        if s['i'] in CASSA and s['o'] not in CASSA:
            x = ts(s['t']); k = s['o']
            if k in ultimo and x - ultimo[k] < 3600: ultimo[k] = x; continue
            ultimo[k] = x; P.append((x, k)); acq[k].append((x, u))
    prime[u] = P
for k in acq: acq[k].sort()
W = leggi('wallet.json', {}); out = {}
for u, v in U.items():
    sw = v['sw']
    if len(sw) < 100: continue
    t = [ts(s['t']) for s in sw]; span = max(1, (t[-1] - t[0]) / 86400)
    giorni = collections.defaultdict(list)
    for x in t: giorni[int(x // 86400)].append(x)
    sonno = [max(b - a for a, b in zip([g * 86400] + xs + [(g + 1) * 86400], xs + [(g + 1) * 86400])) / 3600 for g, xs in giorni.items() if len(xs) >= 20]
    G = [g for g in giri(sw, u) if g['stato'] == 'chiuso' and not g['dep'] and g['inv'] >= 10]
    ten = [(g['t1'] - g['t0']) / 60 for g in G]
    af = None; f = os.path.join(DATI, 'catena', 'sol', f'{u}.json')
    if os.path.exists(f) and W.get(u, {}).get('sol'):
        R = json.load(open(f))['righe']; w = W[u]['sol']
        ss = [r for r in R if r['t'] >= INIZIO and r['tok'].get(USDC) and len([m for m in r['tok'] if m not in (USDC, WSOL)]) == 1]
        if len(ss) >= 30: af = sum(1 for r in ss if r['firm'] == w) / len(ss)
    dopo = collections.Counter(); prima = collections.Counter()
    for x, k in prime[u]:
        L = acq[k]; i = bisect.bisect_left(L, (x - 30, ''))
        vd, vp = set(), set()
        for tt, uu in L[i:]:
            if tt > x + 30: break
            if uu == u: continue
            if tt < x and uu not in vd: dopo[uu] += 1; vd.add(uu)
            elif tt > x and uu not in vp: prima[uu] += 1; vp.add(uu)
    lead, segue = dopo.most_common(1)[0] if dopo else (None, 0)
    r = dict(h=v['h'], swap=len(sw), swap_g=len(sw) / span, sonno=statistics.median(sonno) if sonno else None,
             tenuta=statistics.median(ten) if ten else None, giri=len(G), net=sum(g['ret'] - g['inv'] for g in G), cap=sum(g['inv'] for g in G),
             auto_firma=af, leader=U[lead]['h'] if lead else None, segue=segue, contrario=prima[lead] if lead else 0, primi=len(prime[u]))
    r['gruppo'] = ('chiave esportata' if (af or 0) > .5 else 'macchina' if r['giri'] >= 100 and (r['tenuta'] or 99) <= 3
                   else 'iperattivo' if r['swap_g'] >= 100 else 'altri')
    r['copia'] = segue >= 15 and segue >= 4 * max(1, r['contrario'])
    out[u] = r
scrivi(f"risultati/automatici-{datetime.now(timezone.utc):%Y-%m-%d}.json", out)
G = collections.defaultdict(list)
for r in out.values(): G[r['gruppo']].append(r)
print(f'utenti con almeno 100 swap in 30 giorni: {len(out)}')
for g, xs in sorted(G.items()):
    cap = sum(x['cap'] for x in xs); net = sum(x['net'] for x in xs)
    print(f"  {g:17} {len(xs):5} utenti  capitale ${cap:>13,.0f}  resa {net/max(1,cap):+.1%}  positivi {sum(x['net']>0 for x in xs)/len(xs):.0%}  pausa giornaliera mediana {statistics.median([x['sonno'] for x in xs if x['sonno']] or [0]):.1f} h")
print(f"  copy-trading sistematico: {sum(r['copia'] for r in out.values())}; pausa giornaliera minima: {min((r['sonno'] for r in out.values() if r['sonno']), default=0):.1f} h")
for x in sorted(G['macchina'], key=lambda x: -x['net'])[:8]: print(f"    macchina @{x['h']}: {x['giri']} giri, {x['swap_g']:.0f} swap/g, tenuta {x['tenuta']:.1f} min, netto {x['net']:+,.0f} su {x['cap']:,.0f}")
