# Report dello studio delle tesi sui token in bonding (dati di tesi.js in dati/fomo/tesi/).
# Domanda: i token che ricevono PRESTO tante tesi, scritte da trader con buoni risultati, arrivano alla
# graduation piu' spesso degli altri?
#
# Si guardano solo i token chiusi e scaricati per intero (graduati, morti, scaduti dopo 24 ore) e, di
# ogni token, solo le tesi scritte prima della graduation (o della chiusura).
# Tesi "presto": scritta sotto il 60% della curva (SOGLIA), stimato dalla capitalizzazione della tesi;
# in alternativa nei primi MINUTI dalla nascita del token. Curva al momento della tesi: per pump.fun dalla
# formula della curva (prodotto costante, 30 SOL e 1.073M token virtuali, 793,1M in vendita) con il prezzo
# del SOL ricavato dagli stati osservati del token stesso; per gli altri launchpad interpolando le coppie
# (capitalizzazione, curva%) osservate su quel token; se no, lo stato piu' vicino entro 10 minuti.
#
# Autore "bravo" (la coda, non la media, vedi CLAUDE.md), una delle due:
#  a) studiato: i "migliori" dell'ultimo risultati/migliori-*.json (almeno 10 giri chiusi, almeno $5.000,
#     positivo senza il giro migliore e in entrambe le meta' dei 30 giorni: 29 su 1.328 il 4/10) piu' i
#     cinque indicati dalla persona (@Tekkerrss, @NinjaTradeCr, @whoisdimchae, @DueYappySwift, @Mudo9453);
#  b) dalla classifica di fomo, con la lettura di getUserRank fatta PRIMA della chiusura del token (quella
#     fatta dopo conterrebbe il guadagno sul token stesso): rank 30 giorni <= RANK (1.000, ~0,1% di ~950.000
#     utenti), pnl 30 giorni > 0 e pnl di sempre > 0 (la classifica breve premia il non realizzato).
# Se di un autore esiste solo una lettura successiva alla chiusura, la si usa e il token si conta a parte
# ("letto dopo").
# "Ha comprato": l'autore ha un acquisto nel feed fomo del token entro 2 minuti dopo la tesi o prima.
#
# Uso: python3 scripts/fomo/tesi_report.py [--soglia 60] [--minuti 60] [--rank 1000]
#      -> dati/fomo/risultati/tesi-<data>.md
import json, os, sys, glob, math, bisect, collections, statistics
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comune import DATI, leggi

def arg(nome, d):
    return type(d)(sys.argv[sys.argv.index(nome) + 1]) if nome in sys.argv else d
SOGLIA, MINUTI, RANK = arg('--soglia', 60.0), arg('--minuti', 60), arg('--rank', 1000)
CINQUE = {'tekkerrss', 'ninjatradecr', 'whoisdimchae', 'dueyappyswift', 'mudo9453'}

I = leggi('tesi/indice.json', {})
A = leggi('tesi/autori.json', {})
mf = sorted(glob.glob(os.path.join(DATI, 'risultati', 'migliori-*.json')))
MIGLIORI = {(v.get('h') or '').lower() for v in json.load(open(mf[-1])).values() if v.get('migliore')} if mf else set()
STUDIATI = (MIGLIORI | CINQUE) - {''}

# ---- curva al momento della tesi ----
K = 30 * 1073e6                                   # SOL * token virtuali di pump.fun
def mcap_sol_pump(bp):
    vt = 1073e6 - bp / 100 * 793.1e6
    return K * 1e9 / vt ** 2
def bp_pump(mcap_sol):
    vt = math.sqrt(K * 1e9 / mcap_sol)
    return 100 * (1073e6 - vt) / 793.1e6
def stimatore(r):
    st = [s for s in r.get('stati', []) if s.get('mcap') and s.get('bp') is not None]
    if (r.get('launchpad') or '').startswith('pump'):
        sol = [s['mcap'] / mcap_sol_pump(s['bp']) for s in st if 2 < s['bp'] < 98]
        if sol:
            su = statistics.median(sol)
            return lambda t, m: max(0.0, min(100.0, bp_pump(m / su))) if m else None
    pts = sorted((math.log(s['mcap']), s['bp']) for s in st if s['mcap'] > 0)
    xs = [p[0] for p in pts]
    def f(t, m):
        if m and len(pts) >= 2 and xs[0] <= math.log(m) <= xs[-1]:
            x = math.log(m); i = max(1, bisect.bisect_left(xs, x)); (x0, y0), (x1, y1) = pts[i - 1], pts[i]
            return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
        vic = min(st, key=lambda s: abs(s['t'] - t), default=None)
        return vic['bp'] if vic and abs(vic['t'] - t) <= 600 else None
    return f

# ---- qualita' dell'autore al momento della chiusura del token ----
def lettura(uid, fine):
    L = (A.get(uid) or {}).get('letture') or []
    prima = [l for l in L if l['t'] <= fine]
    if prima: return prima[-1], False
    return (L[0], True) if L else (None, False)
def bravo(uid, h, fine):
    if (h or '').lower() in STUDIATI: return 'studiato', False
    l, dopo = lettura(uid, fine)
    if l and l.get('r30') and l['r30'] <= RANK and (l.get('p30') or 0) > 0 and (l.get('pnl') or 0) > 0: return 'classifica', dopo
    return None, dopo

# ---- token chiusi ----
chiusi, aperti_n, non_scaricati = [], 0, 0
for m, ix in I.items():
    if ix['stato'] == 'bonding': aperti_n += 1; continue
    if not ix.get('finito'): non_scaricati += 1; continue
    r = leggi(f'tesi/token/{m}.json', None)
    if not r: continue
    fine = r.get('grad_at') if r['stato'] == 'graduato' else r.get('chiuso_at')
    fine = fine or r.get('chiuso_at')
    bpf = stimatore(r)
    compra = collections.defaultdict(list)
    for f in r.get('feed', []):
        if f['tipo'] == 'b': compra[f['uid']].append(f['t'])
    tesi = []
    for t in r.get('tesi', []):
        if t['t'] is None or t['t'] >= fine: continue
        bp = bpf(t['t'], t.get('mcap'))
        b, dopo = bravo(t['uid'], t['h'], fine)
        tesi.append(dict(t, bp=bp, bravo=b, letto_dopo=dopo,
            comprato=any(x <= t['t'] + 120 for x in compra.get(t['uid'], [])),
            presto_curva=bp is not None and bp < SOGLIA,
            presto_min=bool(r.get('creato')) and t['t'] - r['creato'] <= MINUTI * 60))
    def aut(pred): return {t['uid'] for t in tesi if pred(t)}
    bv = lambda t: t['bravo'] is not None
    s = dict(mint=m, sym=r.get('sym'), lp=r.get('launchpad'), stato=r['stato'], grad=r['stato'] == 'graduato', fine=fine,
        creato=r.get('creato'), primo_visto=r['primo_visto'], prima_lista=r.get('prima_lista'), new=bool(r.get('campione_new')),
        bp_primo=(r['stati'][0]['bp'] if r.get('stati') else None), bp_max=r.get('bp_max'), tesi=tesi,
        autori_c=aut(lambda t: t['presto_curva']), bravi_c=aut(lambda t: t['presto_curva'] and bv(t)),
        bravi_c_comp=aut(lambda t: t['presto_curva'] and bv(t) and t['comprato']),
        autori_m=aut(lambda t: t['presto_min']), bravi_m=aut(lambda t: t['presto_min'] and bv(t)),
        bravi_tutti=aut(bv), senza_bp=sum(1 for t in tesi if t['bp'] is None),
        letto_dopo=any(t['letto_dopo'] and bv(t) for t in tesi))
    chiusi.append(s)

# ---- presentazione ----
def link(m): return f'[{m[:6]}…](https://fomo.family/tokens/solana/{m})'
def quota(g, n): return f'{g} su {n}' + (f' ({100 * g / n:.0f}%)' if n else '')
def fascia(n, tagli):
    for lo, hi, nome in tagli:
        if lo <= n <= hi: return nome
def tabella(righe, chiave, tagli, titolo):
    out = [f'**{titolo}**', '', '| gruppo | ' + ' | '.join(n for _, _, n in tagli) + ' |', '|---|' + '---|' * len(tagli)]
    for nome, sel in righe:
        c = collections.Counter(); g = collections.Counter()
        for s in sel:
            f = fascia(chiave(s), tagli); c[f] += 1; g[f] += s['grad']
        out.append(f'| {nome} | ' + ' | '.join(quota(g[n], c[n]) if c[n] else '-' for _, _, n in tagli) + ' |')
    return out + ['']
def h(uid, t=None): return '@' + ((A.get(uid) or {}).get('h') or (t or {}).get('h') or uid[:8])
def ora(t): return datetime.fromtimestamp(t, timezone.utc).strftime('%d/%m %H:%M') if t else '?'

L = []
oggi = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')
L += [f'# Tesi e graduation dei token in bonding — {oggi} UTC', '']
st = collections.Counter(s['stato'] for s in chiusi)
L += [f'Token chiusi e scaricati: **{len(chiusi)}** ({", ".join(f"{k} {v}" for k, v in st.most_common())}); '
      f'ancora aperti {aperti_n}, chiusi da scaricare {non_scaricati}. Tesi prima della chiusura: '
      f'{sum(len(s["tesi"]) for s in chiusi)} (senza curva stimata: {sum(s["senza_bp"] for s in chiusi)}). '
      f'Autori con lettura di rank: {len(A)}.', '',
      f'Tesi **presto** = sotto il {SOGLIA:.0f}% della curva (o, nell\'ultima tabella, nei primi {MINUTI} minuti dalla nascita). '
      f'Autore **bravo** = uno dei {len(STUDIATI)} studiati (i migliori del {os.path.basename(mf[-1])[9:19] if mf else "?"} e i cinque indicati) '
      f'oppure rank 30 giorni <= {RANK} con pnl 30 giorni e di sempre positivi, letto prima della chiusura del token. '
      f'Token in cui un autore bravo e\' stato giudicato con una lettura successiva alla chiusura: {sum(s["letto_dopo"] for s in chiusi)}.', '',
      '"graduati X su Y" = token graduati sul totale del gruppo; percentuale solo accanto al numero.', '']
if not chiusi:
    L += ['Nessun token chiuso ancora: il report si riempie quando tesi.js ha chiuso e scaricato i primi token.']
else:
    liste = [s for s in chiusi if not s['new']]
    gruppi = [('tutti', chiusi), (f'dalle liste, prima vista < {SOGLIA:.0f}%', [s for s in liste if (s['bp_primo'] or 0) < SOGLIA]),
              (f'dalle liste, prima vista >= {SOGLIA:.0f}%', [s for s in liste if (s['bp_primo'] or 0) >= SOGLIA]),
              ('campione dei nuovi (10%)', [s for s in chiusi if s['new']])]
    L += ['## Graduation per tesi arrivate presto', '',
          'La riga che conta e\' "prima vista < 60%": li\' l\'esito era ancora aperto quando le tesi presto sono arrivate. '
          'I token visti la prima volta gia\' oltre il 60% sono entrati nello studio perche\' erano andati avanti.', '']
    L += tabella(gruppi, lambda s: len(s['bravi_c']), [(0, 0, '0 bravi'), (1, 1, '1 bravo'), (2, 2, '2 bravi'), (3, 10 ** 6, '>=3 bravi')],
                 f'Autori bravi distinti con una tesi sotto il {SOGLIA:.0f}%')
    L += tabella(gruppi, lambda s: len(s['autori_c']), [(0, 0, '0'), (1, 2, '1-2'), (3, 5, '3-5'), (6, 10 ** 6, '>=6')],
                 f'Autori distinti (tutti) con una tesi sotto il {SOGLIA:.0f}%')
    L += tabella(gruppi, lambda s: 2 if s['bravi_c_comp'] else 1 if s['bravi_c'] else 0,
                 [(0, 0, 'nessun bravo presto'), (1, 1, 'bravi presto, nessuno aveva comprato'), (2, 2, 'almeno un bravo presto che aveva comprato')],
                 'Il bravo aveva comprato prima della tesi (feed fomo)?')
    L += tabella(gruppi, lambda s: len(s['bravi_m']), [(0, 0, '0 bravi'), (1, 1, '1 bravo'), (2, 2, '2 bravi'), (3, 10 ** 6, '>=3 bravi')],
                 f'Autori bravi distinti con una tesi nei primi {MINUTI} minuti dalla nascita')

    # caso per caso
    def riga_tesi(t): return (f'{h(t["uid"], t)} {ora(t["t"])} a {t["bp"]:.0f}%' if t['bp'] is not None else f'{h(t["uid"], t)} {ora(t["t"])} a ?%') + \
        f' (${(t.get("mcap") or 0) / 1000:.0f}k{", comprato" if t["comprato"] else ""}{", " + t["bravo"] if t["bravo"] else ""})'
    def scheda(s):
        presto = [t for t in s['tesi'] if t['presto_curva'] and t['bravo']]
        dur = f', {((s["fine"] - s["primo_visto"]) / 3600):.1f} h dalla prima vista' if s['fine'] else ''
        return f'- **{s["sym"]}** {link(s["mint"])} {s["lp"]}, {s["stato"]}{dur}, prima vista a {s["bp_primo"] or 0:.0f}%, ' \
               f'{len(s["tesi"])} tesi, {len(s["autori_c"])} autori presto di cui {len(s["bravi_c"])} bravi: ' + '; '.join(riga_tesi(t) for t in presto[:8])
    g_b = sorted([s for s in chiusi if s['grad'] and s['bravi_c']], key=lambda s: -len(s['bravi_c']))
    n_b = sorted([s for s in chiusi if not s['grad'] and s['bravi_c']], key=lambda s: -len(s['bravi_c']))
    L += ['## Caso per caso', '', f'**Graduati con almeno un bravo presto: {len(g_b)}**', ''] + [scheda(s) for s in g_b[:40]] + ['']
    L += [f'**Non graduati con almeno un bravo presto: {len(n_b)}** (i primi 25 per numero di bravi)', ''] + [scheda(s) for s in n_b[:25]] + ['']
    g0 = [s for s in chiusi if s['grad'] and not s['bravi_c']]
    L += [f'**Graduati senza nessun bravo presto: {len(g0)}** (i primi 15 per numero di autori presto)', '']
    L += [f'- **{s["sym"]}** {link(s["mint"])}, prima vista a {s["bp_primo"] or 0:.0f}%, {len(s["tesi"])} tesi, {len(s["autori_c"])} autori presto' for s in sorted(g0, key=lambda s: -len(s['autori_c']))[:15]] + ['']

    # concentrazione: quali bravi spiegano i graduati
    per = collections.defaultdict(lambda: [set(), set()])
    for s in chiusi:
        for u in s['bravi_c']:
            per[u][0].add(s['mint'])
            if s['grad']: per[u][1].add(s['mint'])
    ordine = sorted(per.items(), key=lambda kv: (-len(kv[1][1]), -len(kv[1][0])))
    tot_g = len(g_b)
    L += ['## Concentrazione', '',
          f'I {len(g_b)} graduati con un bravo presto, attribuiti agli autori (un token conta per ogni bravo che ci ha scritto presto).', '']
    for k in (1, 10, 50):
        cop = set().union(*[v[1] for _, v in ordine[:k]]) if ordine else set()
        L.append(f'- i primi {k} autori coprono {quota(len(cop), tot_g)} dei graduati con un bravo presto')
    L += ['', '| autore | perche\' bravo | token con sua tesi presto | di cui graduati |', '|---|---|---|---|']
    for u, (tt, gg) in ordine[:30]:
        hh = (A.get(u) or {}).get('h') or u[:8]
        perche = 'studiato' if hh.lower() in STUDIATI else 'classifica'
        L.append(f'| @{hh} | {perche} | {len(tt)} | {quota(len(gg), len(tt))} |')
    L += ['', 'Da leggere con le regole dello studio: un autore scelto perche\' ha vinto si misura dove non e\' stato scelto; '
          'le tesi sono dichiarazioni su fomo, la graduation e\' quella vista da fomo e dalla curva (bonding.js). Ogni token qui sopra ha il suo link.']

os.makedirs(os.path.join(DATI, 'risultati'), exist_ok=True)
out = os.path.join(DATI, 'risultati', f'tesi-{datetime.now(timezone.utc).strftime("%Y-%m-%d")}.md')
open(out, 'w').write('\n'.join(L) + '\n')
print(out)
print('\n'.join(L[:12]))
