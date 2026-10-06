# Tabella dell'ultimo giro di bonding_live.mjs (dati/fomo/tesi/live/stato.json), in markdown, in ordine di ritmo
# (holder fomo entrati negli ultimi 5 minuti, poi holder per minuto di vita). Colonne: curva, token (link fomo),
# app (si vede nell'app), eta', mcap, holder fomo, +5 min, valore fomo, entrati entro il 30% della curva, bravi, tesi.
# Uso: python3 scripts/fomo/bonding_tabella.py [min_curva] [--curva] [--tutti]  (--curva: ordine per % di curva decrescente;
# per default solo i token tradabili sulla prop firm, mint in pump/bonk/bags/brrr, e i 'pump?' da verificare; --tutti: tutti)
import json, os, sys
from datetime import datetime, timezone
S = json.load(open(os.path.join(os.path.dirname(__file__), '../../dati/fomo/tesi/live/stato.json')))
A = [x for x in sys.argv[1:] if not x.startswith('--')]
MIN = float(A[0]) if A else 0
k = lambda v: '$%dk' % round(v / 1000) if v >= 1000 else '$%d' % v
fa = (datetime.now(timezone.utc) - datetime.fromisoformat(S['aggiornato'].replace('Z', '+00:00'))).total_seconds() / 60
print('giro delle %s UTC (%.0f min fa), %d token%s' % (S['aggiornato'][11:19], fa, S['candidati'], (' · errore: ' + S['errore']) if S.get('errore') else ''))
if S.get('usciti'): print("usciti nell'ultima ora: " + ', '.join('%s (%s, %d min, %d holder)' % (t['sym'], t['motivo'], t['eta_min'], t['holder_fomo']) for t in S['usciti']))
run = sorted([t for t in S['dati'] if t.get('runner') and ('--tutti' in sys.argv or t.get('prop') != 'no')], key=lambda t: (-len(t['segnali']), -(t['in5'] or 0)))
if run:
    print('potenziali runner (nati da < 6 ore, almeno 2 segnali su 4):')
    for t in run[:12]:
        v = dict(holder='holder %+d/5min' % (t['in5'] or 0), tesi='tesi %+d/10min' % (t['tesi10'] or 0), bravi='bravi %d' % len(set([x.split(' ')[0] for x in t['bravi_holder']] + t['bravi_tesi'])), soldi='$%+d/5min' % (t['valore5'] or 0))
        print('  %d/4 [%s](https://fomo.family/tokens/solana/%s)%s %s min, %s: %s' % (len(t['segnali']), t['sym'].strip(), t['tok'], ' pump?' if t.get('prop') == 'forse' else '', round(t['eta_min']), k(round(t['mcap'])), ', '.join(v[x] for x in t['segnali'])))
print('\n| curva | token | app | età | mcap | holder fomo | +5 min | valore fomo | ≤30% | bravi | tesi |\n|---|---|---|---|---|---|---|---|---|---|---|')
ritmo = lambda t: (-(t['in5'] if t.get('in5') is not None else -1), -t['al_min'])
for t in sorted(S['dati'], key=(lambda t: (-t['curva'], -t['valore_fomo'])) if '--curva' in sys.argv else ritmo):
    if t['curva'] < MIN or ('--tutti' not in sys.argv and t.get('prop') == 'no'): continue
    d = t.get('in5'); ore = t['ore'] if t['ore'] < 1 else round(t['ore'])
    print('| %d%% | [%s](https://fomo.family/tokens/solana/%s)%s | %s | %sh | %s | %d | %s | %s | %d | %d | %d |' % (
        round(t['curva']), t['sym'].strip(), t['tok'], (' pump?' if t.get('prop') == 'forse' else '') + (' 🆕' if t.get('nuovo') else ''), 'sì' if t['nell_app'] else 'no', ore,
        k(round(t['mcap'])), t['holder_fomo'], '' if d is None else '%+d' % d, k(t['valore_fomo']), t['primi_presto'],
        len(t['bravi_holder']), len(t['tesi'])))
