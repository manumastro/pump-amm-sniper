# Prezzo e liquidita' attuali (dexscreener) dei token tenuti dagli utenti di una classifica.
# tokens/v1 da' solo la coppia maggiore di ogni token: per i token che fanno il 97% del valore si
# legge anche token-pairs/v1 (tutti i pool), in liq_tot. Uscita: prezzi/<ora>.json
# Uso: python3 prezzi.py [classifica.json]
import json, sys, time, collections, urllib.request
from datetime import datetime, timezone
from comune import leggi, scrivi, classifica, norm
CH = {1399811149: 'solana', 4663: 'robinhood', 1: 'ethereum', 8453: 'base', 56: 'bsc', 143: 'monad'}
STABILI = {'USDC', 'USDT', 'USDG', 'USD1', 'PYUSD', 'DAI', 'USDS'}
def get(url):
    for k in range(5):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0'}), timeout=30))
        except Exception: time.sleep(3 * (k + 1))
    return []
L = classifica(sys.argv[1] if len(sys.argv) > 1 else 'ultima')
ids = {x['id'] for p in ('24h', '7d', '30d') for x in L.get(p, [])}
val = collections.Counter()
for u in ids:
    for b in leggi(f'utenti/{u}.json', {}).get('bal', []):
        if b.get('tok') and b.get('q') and b.get('net') in CH and (b.get('sym') or '').upper() not in STABILI:
            val[(b['net'], norm(b['tok']))] += (b['q'] or 0) * (b.get('px') or 0)
out = {}; per = collections.defaultdict(list)
for k in val: per[CH[k[0]]].append(k)
for ch, lst in per.items():
    for i in range(0, len(lst), 30):
        parte = lst[i:i + 30]; best = {}; tot = collections.Counter()
        for p in get(f'https://api.dexscreener.com/tokens/v1/{ch}/' + ','.join(t for _, t in parte)):
            a = p['baseToken']['address'].lower(); liq = (p.get('liquidity') or {}).get('usd') or 0
            if a not in best or liq > best[a]['liq']: best[a] = dict(px=float(p.get('priceUsd') or 0), liq=liq, mcap=p.get('marketCap') or p.get('fdv'))
        for net, tok in parte:
            b = best.get(tok.lower())
            if b: b['liq_tot'] = b['liq']
            out[f'{net}:{tok}'] = b
        time.sleep(0.25)
tot = sum(val.values()); acc = 0
for (net, tok), v in val.most_common():
    if acc > .97 * tot: break
    acc += v; k = f'{net}:{tok}'
    if not out.get(k): continue
    d = get(f'https://api.dexscreener.com/token-pairs/v1/{CH[net]}/{tok}')
    liq = sum((p.get('liquidity') or {}).get('usd') or 0 for p in d if tok.lower() in (p['baseToken']['address'].lower(), p['quoteToken']['address'].lower()))
    out[k]['liq_tot'] = max(liq, out[k]['liq']); time.sleep(0.22)
ora = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H%M')
scrivi(f'prezzi/{ora}.json', out)
print(f'prezzi/{ora}.json: {len(out)} token, {sum(1 for v in out.values() if v)} con prezzo')
