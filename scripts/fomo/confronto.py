# Fuori campione: i 150 di ogni classifica di una lettura, misurati alla lettura successiva.
# Per ciascuno, fra le due letture:
#  - variazione del PnL da sempre secondo fomo;
#  - variazione del patrimonio a prezzo di mercato e di quello liquidabile (contante stabile +
#    posizioni vendute al prezzo ottenibile con tutti i pool), al netto di depositi e prelievi.
# Uso: python3 confronto.py <lettura_prima> <lettura_dopo> <prezzi_prima> <prezzi_dopo>
#      (nomi dei file in classifiche/ e istantanee/, e in prezzi/)
import json, sys, statistics
from comune import leggi, ts, norm, CASSA
A, B = leggi('classifiche/' + sys.argv[1]), leggi('classifiche/' + sys.argv[2])
I0, I1 = leggi('istantanee/' + sys.argv[1]), leggi('istantanee/' + sys.argv[2])
PA, PB = leggi('prezzi/' + sys.argv[3]), leggi('prezzi/' + sys.argv[4])
STABILI = {'USDC', 'USDT', 'USDG', 'USD1', 'PYUSD', 'DAI', 'USDS'}
CONTANTE = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112', '11111111111111111111111111111111'}
def patrimonio(bal, PX):
    spot = liq = 0.0
    for b in bal or []:
        if not b.get('tok') or not b.get('q'): continue
        if (b.get('sym') or '').upper() in STABILI: x = b['q'] * (b.get('px') or 1); spot += x; liq += x; continue
        p = PX.get(f"{b['net']}:{norm(b['tok'])}")
        if p and p['px']:
            V = b['q'] * p['px']; y = (p.get('liq_tot') or p['liq'] or 0) / 2; spot += V; liq += y * V / (y + V) if y > 0 else 0
        else: spot += b['q'] * (b.get('px') or 0)   # nessuna coppia su dexscreener: non si vende
    return spot, liq
t0, t1 = ts(A['preso']), ts(B['preso'])
M = statistics.median; ris = {}
print(f"da {A['preso'][:16]} a {B['preso'][:16]} UTC ({(t1 - t0) / 3600:.1f} ore)")
for per in ('24h', '7d', '30d'):
    dopo = {x['id'] for x in B.get(per, [])}; rr = []
    for x in A.get(per, []):
        u = x['id']; a, b = I0.get(u), I1.get(u); D = leggi(f'utenti/{u}.json', None)
        if not a or not b or not D: continue
        # flussi = solo contante vero (USDC e SOL su Solana): gli altri "depositi" sono quasi tutti airdrop
        flusso = sum(float(t.get('usdAmount') or 0) * {'DEPOSIT': 1, 'WITHDRAWAL': -1}.get(t['type'], 0) for t in D.get('transfers', [])
                     if t0 < ts(t['createdAt']) <= t1 and t.get('tokenAddress') in CONTANTE)
        s0, l0 = patrimonio(a['bal'], PA); s1, l1 = patrimonio(b['bal'], PB)
        p0 = ((a['profilo'].get('rank') or {}).get('pnl')); p1 = ((b['profilo'].get('rank') or {}).get('pnl'))
        rr.append(dict(h=x['userHandle'], resta=u in dopo, fomo=(p1 - p0) if p0 is not None and p1 is not None else 0,
                       spot=s1 - s0 - flusso, liq=l1 - l0 - flusso, flusso=flusso, val0=s0))
    T = lambda k: sum(r[k] for r in rr); pos = lambda k: sum(r[k] > 0 for r in rr)
    ris[per] = rr
    print(f"\n{per}: {len(rr)} di ieri, ancora in classifica {sum(r['resta'] for r in rr)}")
    print(f"  PnL da sempre secondo fomo   {T('fomo'):>+14,.0f}  positivi {pos('fomo')}  mediana {M([r['fomo'] for r in rr]):+,.0f}")
    print(f"  patrimonio a prezzo mercato  {T('spot'):>+14,.0f}  positivi {pos('spot')}  mediana {M([r['spot'] for r in rr]):+,.0f}")
    print(f"  patrimonio liquidabile       {T('liq'):>+14,.0f}  positivi {pos('liq')}  mediana {M([r['liq'] for r in rr]):+,.0f}")
    print(f"  (depositi netti nel frattempo {T('flusso'):+,.0f}; patrimonio di partenza ${T('val0'):,.0f})")
open('/dev/null', 'w')
import os; from comune import DATI, scrivi
scrivi(f"risultati/confronto-{sys.argv[1][:-5]}-{sys.argv[2][:-5]}.json", ris)
