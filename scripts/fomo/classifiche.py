# Le classifiche come se si chiudesse adesso. Per i 150 di ogni periodo (24h, 7g, 30g):
#  - PnL di classifica = incassato nella finestra + aperto (per differenza);
#  - posizioni di oggi vendute adesso: incasso = (L/2 x V) / (L/2 + V), V valore di mercato,
#    L liquidita' del pool principale (caso peggiore) o di tutti i pool (caso migliore);
#  - resa sul capitale investito nella finestra, contando le posizioni aperte come vendute;
#  - token piu' tenuti contro la loro liquidita'.
# Uso: python3 classifiche.py [classifica.json [prezzi.json]]   -> risultati/classifiche-<ora>.md
import json, sys, os, collections, statistics
from comune import DATI, leggi, scrivi, classifica, giri, ts, norm, CASSA, SOL, RH
L = classifica(sys.argv[1] if len(sys.argv) > 1 else 'ultima')
pf = sys.argv[2] if len(sys.argv) > 2 else sorted(os.listdir(os.path.join(DATI, 'prezzi')))[-1]
PX = leggi(f'prezzi/{pf}'); FINE = ts(L['preso'])
STABILI = {'USDC', 'USDT', 'USDG', 'USD1', 'PYUSD', 'DAI', 'USDS'}
CAT = lambda n: {SOL: 'Solana', RH: 'Robinhood'}.get(n, 'altre EVM')
def uscita(V, liq): y = (liq or 0) / 2; return y * V / (y + V) if y > 0 and V > 0 else 0.0
def prezzo(net, tok): return PX.get(f'{net}:{norm(tok)}')
def realizzato(D, inizio):
    avg = {(b['net'], norm(b['tok'])): (b.get('ut') or {}).get('avg') for b in D.get('bal', []) if b.get('tok')}
    pos = collections.defaultdict(lambda: [0.0, 0.0]); r = collections.Counter()
    for s in D.get('swaps', []):
        if s['i'] in CASSA and s['o'] not in CASSA: p = pos[(s['onet'], norm(s['o']))]; p[0] += s['oa'] or 0; p[1] += s['ui'] or 0
        elif s['o'] in CASSA and s['i'] not in CASSA:
            k = (s['inet'], norm(s['i'])); p = pos[k]; q = s['ia'] or 0; inc = s['uo'] or 0
            qq = min(q, p[0]); c = p[1] * qq / p[0] if p[0] > 0 else 0; p[1] -= c; p[0] -= qq
            resto = q - qq; ignoto = resto > 1e-9 and not avg.get(k); c += resto * (avg.get(k) or 0)
            if ts(s['t']) >= inizio:
                if ignoto: r['ignoto'] += inc
                else: r['real'] += inc - c
    return r
def tenute(D, insieme):
    r = collections.Counter(); mag = 0
    for b in D.get('bal', []):
        if not b.get('tok') or not b.get('q') or not b.get('net') or (b.get('sym') or '').upper() in STABILI or b['tok'] in CASSA: continue
        p = prezzo(b['net'], b['tok'])
        if p and p['px']:
            V = b['q'] * p['px']; r['usc'] += uscita(V, p['liq']); r['usct'] += uscita(V, p.get('liq_tot') or p['liq']); insieme[(b['net'], norm(b['tok']), b.get('sym'))] += V
        else: V = b['q'] * (b.get('px') or 0); r['usc'] += V; r['usct'] += V
        r['spot'] += V; mag = max(mag, V)
    r['mag'] = mag; return r
def resa_finestra(D, u, inizio):
    r = collections.Counter(); bal = {(b['net'], norm(b['tok'])): b['q'] for b in D.get('bal', []) if b.get('tok')}
    for g in giri(D.get('swaps', []), u):
        if g['t0'] < inizio or g['dep'] or g['inv'] < 10 or g['stato'] == 'altro': continue
        c = CAT(g['net']); r['cap ' + c] += g['inv']; r['cap'] += g['inv']
        if g['stato'] == 'chiuso': d = g['ret'] - g['inv']; r['real'] += d; spot = usc = usct = d
        else:
            q = min(max(0, g['qb'] - g['qs']), bal.get((g['net'], g['tok'])) or 0); p = prezzo(g['net'], g['tok'])
            V = q * p['px'] if p and p['px'] else 0
            spot = g['ret'] + V - g['inv']; usc = g['ret'] + uscita(V, p['liq'] if p else 0) - g['inv']; usct = g['ret'] + uscita(V, (p.get('liq_tot') or p['liq']) if p else 0) - g['inv']
        for k, v in (('spot', spot), ('usc', usc), ('usct', usct)): r[k] += v; r[f'{k} {c}'] += v
    return r
M = statistics.median; md = []; ris = {}
f = lambda x: (f"{x/1e6:+,.1f}M" if abs(x) >= 1e6 else f"{x/1e3:+,.0f}k").replace(',', 'X').replace('.', ',').replace('X', '.')
md.append(f"# Classifiche fomo come se si chiudesse adesso\n\nClassifica letta {L['preso'][:16]} UTC, prezzi {pf[:-5]}.\n")
md.append('| | ' + ' | '.join(['24 ore', '7 giorni', '30 giorni']) + ' |\n|---|---|---|---|')
righe = collections.defaultdict(list); tabelle = []
for per, giorni, campo in (('24h', 1, 'pnl24h'), ('7d', 7, 'pnl7d'), ('30d', 30, 'pnl30d')):
    inizio = FINE - giorni * 86400; ins = collections.Counter(); rr = []
    for x in L.get(per, []):
        D = leggi(f"utenti/{x['id']}.json", None)
        if not D: continue
        r = realizzato(D, inizio); t = tenute(D, ins); w = resa_finestra(D, x['id'], inizio)
        rr.append(dict(h=x['userHandle'], fomo=x[campo], real=r['real'], ignoto=r['ignoto'], spot=t['spot'], usc=t['usc'], usct=t['usct'], mag=t['mag'],
                       chiuso=x[campo] - (t['spot'] - t['usc']), chiuso_t=x[campo] - (t['spot'] - t['usct']), perp=(D.get('altro') or {}).get('livePerpPnl') or 0,
                       sempre=((D.get('profilo') or {}).get('rank') or {}).get('pnl') or 0, w=w))
    T = lambda k: sum(r[k] for r in rr); W = lambda k: sum(r['w'][k] for r in rr)
    insieme = sum(uscita(V, (prezzo(n, t) or {}).get('liq_tot') or (prezzo(n, t) or {}).get('liq')) for (n, t, _), V in ins.items())
    ris[per] = dict(utenti=len(rr), fomo=T('fomo'), real=T('real'), real_max=T('real') + T('ignoto'), spot=T('spot'), usc=T('usc'), usct=T('usct'),
                    chiuso=T('chiuso'), chiuso_t=T('chiuso_t'), pos=sum(r['chiuso'] > 0 for r in rr), pos_t=sum(r['chiuso_t'] > 0 for r in rr),
                    neg_sempre=sum(r['sempre'] < 0 for r in rr), perp=T('perp'), insieme=insieme, cap=W('cap'), w_spot=W('spot'), w_usc=W('usc'), w_usct=W('usct'),
                    cat={c: dict(cap=W('cap ' + c), spot=W('spot ' + c), usc=W('usc ' + c), usct=W('usct ' + c)) for c in ('Solana', 'Robinhood', 'altre EVM')},
                    pochi_real=sum(1 for r in rr if r['fomo'] > 0 and r['real'] < .25 * r['fomo']))
    righe['PnL di classifica'].append(f"{f(T('fomo'))}")
    righe['gia\' incassato'].append(f"{T('real')/T('fomo'):.0%}-{(T('real')+T('ignoto'))/T('fomo'):.0%}")
    righe['posizioni aperte oggi'].append(f"${T('spot')/1e6:,.1f}M")
    righe['perso vendendole'].append(f"{1-T('usct')/T('spot'):.0%}-{1-T('usc')/T('spot'):.0%}")
    righe['**PnL se vendessero adesso**'].append(f"**{f(T('chiuso'))} … {f(T('chiuso_t'))}**")
    righe['ancora positivi'].append(f"{ris[per]['pos']}-{ris[per]['pos_t']} su {len(rr)}")
    righe['perpetual aperti'].append(f(T('perp')))
    righe['resa sul capitale della finestra'].append(f"{W('usc')/max(1,W('cap')):+.0%} … {W('usct')/max(1,W('cap')):+.0%}")
    tab = [f"\n**{ {'24h':'24 ore','7d':'7 giorni','30d':'30 giorni'}[per] }**\n\n| utente | classifica | incassato | aperte oggi | se vendesse adesso |\n|---|---|---|---|---|"]
    for r in sorted(rr, key=lambda r: -r['fomo'])[:10]:
        tab.append(f"| @{r['h']} | {f(r['fomo'])} | {f(r['real'])} | ${r['spot']/1e6:,.2f}M | {f(r['chiuso'])} … {f(r['chiuso_t'])} |")
    tabelle.append('\n'.join(tab))
    if per == '30d':
        conc = sorted(ins.items(), key=lambda kv: -kv[1])[:10]
for k, v in righe.items(): md.append(f'| {k} | ' + ' | '.join(v) + ' |')
c = ris['30d']['cat']
md.append('\n## Resa dei 150 a 30 giorni per catena\n\n| catena | capitale | prezzo di mercato | prezzo ottenibile |\n|---|---|---|---|')
for k, v in c.items(): md.append(f"| {k} | ${v['cap']/1e6:,.1f}M | {v['spot']/max(1,v['cap']):+.0%} | {v['usc']/max(1,v['cap']):+.0%} … {v['usct']/max(1,v['cap']):+.0%} |")
md.append('\n## Token piu\' tenuti (30 giorni)\n\n| token | rete | tenuto | liquidita\' pool principale |\n|---|---|---|---|')
for (n, t, s), V in conc: md.append(f"| {s} | {n} | ${V/1e6:,.1f}M | ${(prezzo(n, t) or {}).get('liq', 0)/1e6:,.2f}M |")
md.append('\n## I primi dieci'); md += tabelle
ora = L['preso'][:16].replace(':', '')
scrivi(f'risultati/classifiche-{ora}.json', ris)
open(os.path.join(DATI, 'risultati', f'classifiche-{ora}.md'), 'w').write('\n'.join(md) + '\n')
print('\n'.join(md))
