# Ritratto caso per caso dei profili scaricati con profilo.mjs (dati/fomo/profili/<handle>.json):
# soldi entrati e usciti, giri dagli swap (aperti venduti adesso al prezzo ottenibile), concentrazione,
# i giri migliori e peggiori, e dove entra sui token pump.fun (in bonding o dopo la graduation).
# La fase pump.fun e' stimata dall'mcap pagato (offerta 1 miliardo; graduation ~411 SOL): un token
# gia' graduato e poi crollato sotto la soglia finisce fra i "bonding".
# Uso: python3 profili.py [handle ...]   -> risultati/profili-<data>.md
import os, sys, json, statistics
from datetime import datetime, timezone
from comune import DATI, leggi, giri, ts, norm, SOL
SOL_USD = 120          # prezzo del SOL per la soglia di graduation (letto on-chain il 4/10: 114-121 negli ultimi 10 giorni)
GRAD_SOL = 411
STABILI = {'USDC', 'USDT', 'USDG', 'USD1', 'SOL', 'ETH', 'WETH', 'BNB', 'WBNB'}
SLUG = {SOL: 'solana', 4663: 'robinhood', 1: 'ethereum', 8453: 'base', 56: 'bsc'}
num = lambda s: s.replace(',', '\x00').replace('.', ',').replace('\x00', '.')
eur = lambda x: ('+' if x >= 0 else '−') + num(f"${abs(x)/1e3:,.1f}k" if abs(x) >= 1e3 else f"${abs(x):,.0f}")
pc = lambda x: '—' if x is None else (('+' if x >= 0 else '−') + f"{abs(x):.0%}")
ten = lambda m: 'aperto' if m is None else f"{m:.0f} min" if m < 90 else num(f"{m/60:.1f} h") if m < 2880 else num(f"{m/1440:.1f} giorni")
data = lambda t: datetime.fromtimestamp(t, timezone.utc).strftime('%d/%m %H:%M')
def compatti(R):
    return [dict(i=s['inTokenAddress'], o=s['outTokenAddress'], ia=s['inHumanAmount'], oa=s['outHumanAmount'], ui=s['humanUsdAmountIn'],
                 uo=s['humanUsdAmountOut'], t=s['createdAt'], inet=s['inNetworkId'], onet=s['outNetworkId']) for s in R['swaps']]
def uscita(V, liq):
    y = (liq or 0) / 2; return y * V / (y + V) if y > 0 and V > 0 else 0.0
def ritratto(h):
    R = leggi(f'profili/{h}.json'); p = R['profilo']; rk = R.get('rank') or {}
    # simboli, prezzo e liquidita' attuali dai trade di fomo (solo per orientarsi: il prezzo e' di fomo)
    meta = {}
    for x in R.get('trades', []):
        t = x['trade']; m = t.get('tokenMetadata') or {}
        meta[norm(t['tokenAddress'])] = dict(sym=m.get('symbol'), px=m.get('currentPrice'), liq=m.get('liquidity'))
    for b in (R.get('bal') or {}).get('balances', []):
        tf = (b.get('tokenFilterResult') or {}).get('token') or {}; a = (b.get('balance') or {}).get('tokenAddress')
        if a: meta.setdefault(norm(a), dict(sym=tf.get('symbol'), px=None, liq=None))
    q_ora = {norm((b.get('balance') or {}).get('tokenAddress') or ''): (b.get('balance') or {}).get('shiftedBalance') or 0 for b in (R.get('bal') or {}).get('balances', [])}
    G = [g for g in giri(compatti(R), h) if not g['dep'] and g['inv'] >= 5 and g['stato'] != 'altro']
    for g in G:
        m = meta.get(g['tok'], {})
        if g['stato'] == 'chiuso': g['netto'] = g['ret'] - g['inv']
        else:
            q = min(max(0, g['qb'] - g['qs']), q_ora.get(g['tok'], 0))
            g['netto'] = g['ret'] + uscita(q * (m.get('px') or 0), m.get('liq')) - g['inv']
        g['sym'] = m.get('sym') or (g['tok'][:4] + '…' + g['tok'][-4:])
        # fase pump.fun: mcap pagato (offerta 1 miliardo) sotto la soglia di graduation
        g['fase'] = None
        if g['net'] == SOL and g['tok'].endswith('pump') and g['qb']:
            g['mcap'] = g['inv'] / g['qb'] * 1e9; g['fase'] = 'bonding' if g['mcap'] / SOL_USD < GRAD_SOL else 'dopo'
    G.sort(key=lambda g: -g['netto'])
    soldi = {'DEPOSIT': 0., 'WITHDRAWAL': 0.}
    for t in R.get('transfers', []):
        sym = ((t.get('tokenMetadata') or {}).get('symbol') or '').upper()
        if t.get('type') in soldi and (sym in STABILI or t.get('isNativeToken')): soldi[t['type']] += t.get('usdAmount') or 0
    lordo = sum(g['netto'] for g in G if g['netto'] > 0) or 1
    q = lambda n: sum(g['netto'] for g in G[:n] if g['netto'] > 0) / lordo
    tot = sum(g['netto'] for g in G); chiusi = [g for g in G if g['stato'] == 'chiuso']
    t0 = min((ts(s['createdAt']) for s in R['swaps']), default=None); t1 = max((ts(s['createdAt']) for s in R['swaps']), default=None)
    trunc = len(R['swaps']) >= 5000
    righe = [f"## @{h}", '', f"[profilo](https://fomo.family/profile/{h}) · conto aperto il {p['createdAt'][:10]} · {p.get('followers')} follower · swap scaricati {len(R['swaps'])}" + (' (troncato: solo i piu\' recenti)' if trunc else '') + (f" dal {data(t0)} al {data(t1)}" if t0 else ''), '']
    righe.append(f"- **Secondo fomo:** PnL di sempre {eur((rk.get('rank') or {}).get('pnl') or 0)}, 30 giorni {eur((rk.get('rank30d') or {}).get('pnl') or 0)}, 24 ore {eur((rk.get('rank24h') or {}).get('pnl') or 0)}.")
    righe.append(f"- **Contante:** depositati {eur(soldi['DEPOSIT'])[1:]}, ritirati {eur(soldi['WITHDRAWAL'])[1:]} (solo stabili e valute native).")
    righe.append(f"- **Dai giri:** {len(G)} giri ({len(chiusi)} chiusi), {eur(sum(g['inv'] for g in G))[1:]} investiti, risultato {eur(tot)} contando gli aperti venduti adesso. Vinti {sum(1 for g in chiusi if g['netto'] > 0)} su {len(chiusi)}. Il guadagno lordo e' {eur(lordo)}: il giro migliore ne fa il {q(1):.0%}, i primi 5 il {q(5):.0%}, i primi 10 il {q(10):.0%}. Senza il migliore: {eur(tot - (G[0]['netto'] if G else 0))}.")
    pf = [g for g in G if g['fase']]
    if pf:
        b = [g for g in pf if g['fase'] == 'bonding']; d = [g for g in pf if g['fase'] == 'dopo']
        righe.append(f"- **Token pump.fun:** {len(pf)} giri; comprati in bonding (stima) {len(b)}, risultato {eur(sum(g['netto'] for g in b))}, vinti {sum(1 for g in b if g['netto'] > 0)}; comprati dopo la graduation {len(d)}, risultato {eur(sum(g['netto'] for g in d))}, vinti {sum(1 for g in d if g['netto'] > 0)}.")
    testa = ['| entrata (UTC) | token | catena | fase | mcap pagato | investito | risultato | tenuta |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
    def riga(g):
        mc = f"${g['mcap']/1e3:,.0f}k" if g.get('mcap') else '—'
        return f"| {data(g['t0'])} | [{g['sym']}](https://fomo.family/tokens/{SLUG.get(g['net'], g['net'])}/{g['tok']}) | {SLUG.get(g['net'], g['net'])} | {g['fase'] or '—'} | {num(mc)} | {eur(g['inv'])[1:]} | {eur(g['netto'])} ({pc(g['netto'] / g['inv'])}) | {ten((g['t1'] - g['t0']) / 60 if g['t1'] else None)} |"
    righe += ['', '**Giri migliori**', ''] + testa + [riga(g) for g in G[:6] if g['netto'] > 0]
    righe += ['', '**Giri peggiori**', ''] + testa + [riga(g) for g in sorted(G, key=lambda g: g['netto'])[:4] if g['netto'] < 0]
    return '\n'.join(righe) + '\n', dict(h=h, tot=tot, giri=len(G), lordo=lordo, q1=q(1))
if __name__ == '__main__':
    hh = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(os.path.join(DATI, 'profili')) if f.endswith('.json') and f != 'lista.json')
    pezzi = [ritratto(h) for h in hh]
    pezzi.sort(key=lambda x: -x[1]['tot'])
    out = f"risultati/profili-{datetime.now(timezone.utc):%Y-%m-%d}.md"
    open(os.path.join(DATI, out), 'w').write('# Profili fomo, caso per caso\n\n' + '\n'.join(p[0] for p in pezzi))
    for _, s in pezzi: print(f"{s['h']:16} {s['tot']:+10,.0f} giri {s['giri']:5} migliore {s['q1']:.0%} del lordo")
    print(out)
