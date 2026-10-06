# Coda dei controlli di narrativa su X dopo ogni acquisto della simulazione (un sub-agente per acquisto).
# Legge da stdin l'uscita di aspetta_evento.sh, aggiunge alla coda gli acquisti nuovi (eventi 'entra'),
# solo se su fomo il token ha un link social (X, sito o telegram: letto con narrativa_fomo.mjs, che riprova
# perche' fomo a volte risponde senza social); gli altri vanno in narrativa/senza_link.jsonl.
# Stampa il prossimo da controllare (il piu' vecchio senza esito in narrativa/<tok>.json).
# Uso: python3 narrativa_coda.py < uscita   |   python3 narrativa_coda.py --prossimo
import sys, json, os, subprocess
D = os.path.join(os.path.dirname(__file__), '../../dati/fomo/simulazione/narrativa'); os.makedirs(D, exist_ok=True)
CODA = os.path.join(D, 'coda.jsonl')
def _autori():
    try: A = json.load(open(os.path.join(D, '../../tesi/autori.json')))
    except Exception: return {}
    R = {u: (x.get('letture') or [{}])[-1] for u, x in A.items()}
    # in aggiunta la classifica letta nel controllo one-shot del 4/10 (740 autori di tesi)
    try:
        for u, x in json.load(open(os.path.join(D, '../../tesi/oneshot/classifica_autori.json'))).items():
            R.setdefault(u, {'r30': x.get('pos30'), 'p30': x.get('m30')})
    except Exception: pass
    return R
AUT = _autori()
bravo = lambda uid: bool(uid) and (AUT.get(uid, {}).get('r30') or 1e9) <= 1000 and (AUT.get(uid, {}).get('p30') or 0) > 0
coda = [json.loads(l) for l in open(CODA)] if os.path.exists(CODA) else []
gia = {c['tok'] for c in coda}
if '--prossimo' not in sys.argv:
    for l in sys.stdin:
        if not l.strip().startswith('{'): continue
        e = json.loads(l)
        if e.get('tipo') == 'entra' and e['tok'] not in gia:
            c = {k: e.get(k) for k in ('t', 'binario', 'tok', 'sym', 'mcap', 'liq', 'lp', 'curva', 'motivo')}
            try:
                out = subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'narrativa_fomo.mjs'), e['tok']], capture_output=True, text=True, timeout=120,
                                     env={**os.environ, 'FOMO_TOKEN_FILE': os.path.expanduser('~/.config/fomo-mcp/token')}).stdout
                social = {k: v for k, v in (json.loads(out).get('social') or {}).items() if v}
            except Exception as ex:
                social = {'errore': str(ex)[:80]}
            c['social'] = social
            # dal 4/10 sera: il controllo su X solo se il token ha anche tesi di trader bravi (primi 1000 di fomo a 30 giorni,
            # guadagno positivo; classifica letta da tesi.js in dati/fomo/tesi/autori.json)
            try: tesi = json.loads(out).get('tesi_fomo') or []
            except Exception: tesi = []
            c['bravi'] = sorted({t.get('utente') for t in tesi if isinstance(t, dict) and bravo(t.get('uid'))} - {None})
            if not c['bravi']:
                open(os.path.join(D, 'senza_bravi.jsonl'), 'a').write(json.dumps(c, ensure_ascii=False) + '\n'); gia.add(e['tok']); continue
            if not any(social.get(k) for k in ('twitter', 'website', 'telegram')):
                open(os.path.join(D, 'senza_link.jsonl'), 'a').write(json.dumps(c, ensure_ascii=False) + '\n'); gia.add(e['tok']); continue
            coda.append(c); gia.add(e['tok'])
            open(CODA, 'a').write(json.dumps(c, ensure_ascii=False) + '\n')
fatti = {f[:-5] for f in os.listdir(D) if f.endswith('.json')}
attesa = [c for c in coda if c['tok'] not in fatti]
print(json.dumps({'in_attesa': len(attesa), 'prossimo': attesa[0] if attesa else None}, ensure_ascii=False))
