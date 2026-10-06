# Prezzo e liquidita' attuali dei token tenuti dagli utenti di una classifica, solo dalla catena:
# Solana con prezzi_catena.js (Helius), Robinhood/Ethereum/Base/BSC con prezzi_evm.js (stato dei pool
# su Alchemy). Si misurano i token di cui qualcuno tiene almeno $50 al prezzo di fomo. Le reti senza
# modulo (Monad, 5042) e i token senza prezzo on-chain restano null: valgono 0 (non si vendono).
# Uscita: prezzi/<ora>.json con '<rete>:<tok>' -> {px, liq, liq_tot, pool, fonte, ora} o null
# Uso: python3 prezzi.py [classifica.json | tutti]   (tutti = le posizioni di ogni utente salvato)
import os, sys, subprocess
from datetime import datetime, timezone
from comune import leggi, scrivi, classifica, norm, utenti
STABILI = {'USDC', 'USDT', 'USDG', 'USD1', 'PYUSD', 'DAI', 'USDS'}
if len(sys.argv) > 1 and sys.argv[1] == 'tutti': ids = set(utenti())
else:
    L = classifica(sys.argv[1] if len(sys.argv) > 1 else 'ultima')
    ids = {x['id'] for p in ('24h', '7d', '30d') for x in L.get(p, [])}
out = {}
for u in ids:
    for b in leggi(f'utenti/{u}.json', {}).get('bal', []):
        if b.get('tok') and b.get('q') and b.get('net') and (b.get('sym') or '').upper() not in STABILI:
            out[f"{b['net']}:{norm(b['tok'])}"] = None
ora = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H%M'); f = f'prezzi/{ora}.json'
scrivi(f, out)
qui = os.path.dirname(os.path.abspath(__file__))
for js in ('prezzi_catena.js', 'prezzi_evm.js'):
    subprocess.run(['node', os.path.join(qui, js), f], check=True)
P = leggi(f)
print(f'{f}: {len(P)} token, {sum(1 for v in P.values() if v)} con prezzo dalla catena')
