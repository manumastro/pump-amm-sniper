# Basi comuni della pipeline fomo (Python): cartella dati, orari, giri dagli swap fomo.
import json, os
from datetime import datetime
RADICE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATI = os.environ.get('FOMO_DATI') or os.path.join(RADICE, 'dati', 'fomo')
SOL, RH = 1399811149, 4663
CASSA = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112'}
ts = lambda x: datetime.fromisoformat(x.replace('Z', '+00:00')).timestamp()
norm = lambda t: t.lower() if t and t.startswith('0x') else t
_NIENTE = object()
def leggi(f, default=_NIENTE):
    try: return json.load(open(os.path.join(DATI, f)))
    except FileNotFoundError:
        if default is not _NIENTE: return default
        raise
def scrivi(f, v):
    p = os.path.join(DATI, f); os.makedirs(os.path.dirname(p), exist_ok=True); json.dump(v, open(p, 'w'))
def utente(u): return leggi(f'utenti/{u}.json', {})
def utenti(): return [f[:-5] for f in os.listdir(os.path.join(DATI, 'utenti')) if f.endswith('.json')]
def classifica(nome='ultima'):
    d = os.path.join(DATI, 'classifiche'); fs = sorted(f for f in os.listdir(d) if f.endswith('.json'))
    return json.load(open(os.path.join(d, fs[-1] if nome == 'ultima' else nome)))
def giri(swaps, uid):
    """Giri dagli swap fomo, tutte le catene. Contante = USDC (o SOL) su Solana. Chiuso al 95%;
    'dep' se si vende senza aver comprato o oltre il 105% del comprato (token arrivati da fuori)."""
    pos = {}; out = []
    for s in sorted(swaps, key=lambda s: s['t']):
        if s['i'] in CASSA and s['o'] not in CASSA: buy, net, tok, q, usd = True, s['onet'], s['o'], s['oa'], s['ui']
        elif s['o'] in CASSA and s['i'] not in CASSA: buy, net, tok, q, usd = False, s['inet'], s['i'], s['ia'], s['uo']
        else: continue
        if not tok or not q or usd is None: continue
        k = (net, norm(tok)); t = ts(s['t'])
        p = pos.get(k)
        if p is None: p = pos[k] = dict(uid=uid, net=net, tok=k[1], inv=0., ret=0., qb=0., qs=0., nb=0, ns=0, t0=t, dep=False)
        if buy: p['inv'] += usd; p['qb'] += q; p['nb'] += 1
        else:
            if p['qb'] == 0: p['dep'] = True
            p['ret'] += usd; p['qs'] += q; p['ns'] += 1
            if p['qb'] and p['qs'] >= .95 * p['qb']:
                if p['qs'] > 1.05 * p['qb']: p['dep'] = True
                out.append(dict(p, t1=t, stato='chiuso')); del pos[k]
    out += [dict(p, t1=None, stato='aperto' if p['qb'] > p['qs'] else 'altro') for p in pos.values()]
    return out
