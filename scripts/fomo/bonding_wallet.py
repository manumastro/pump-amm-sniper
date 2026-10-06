# Chi guadagna in bonding/graduation, wallet per wallet, su tutti i token studiati da bonding_studio.js (schema 2:
# tutti i compratori in bonding + quelli della prima ora dopo la graduation, risultato vero). Caso per caso, con
# conteggi e concentrazione; niente medie. Blocco della nascita e creatore stanno a parte (non sono strategie
# replicabili). Le storie recenti dei wallet (bonding_studio.js wallet ...) in coda.
# Uscita: dati/fomo/risultati/bonding-wallet-<data>.md
import json, os, time
from collections import defaultdict
from comune import DATI, leggi
fmt_t = lambda t: time.strftime('%d/%m %H:%M', time.gmtime(t)) if t else '-'
acc = lambda w: f'[`{w}`](https://solscan.io/account/{w})'
tx = lambda s, testo='tx': f'[{testo}](https://solscan.io/tx/{s})' if s else '-'
TAGLIO = " (tagliata: il wallet e' piu' attivo di cosi')"
FASCE = ['0-25', '25-50', '50-80', '80-95', '95-100', 'dopo']
def fascia(b): return 'dopo' if b == 'dopo' else '?' if b is None else '0-25' if b < 25 else '25-50' if b < 50 else '50-80' if b < 80 else '80-95' if b < 95 else '95-100'
# risultato certo, stimato (tiene a fine finestra senza essere seguito: valutato a adesso) o ignoto (token passati altrove)
def segno(e): return '?' if e['uscita'] == 'trasferito' else '≈' if e['uscita'] in ('tiene (non seguito)',) or (e.get('seguito') and e.get('completo') is False and e['tok_ora'] > 1) else ''
def ingresso(e): return f"dopo +{e['min_dopo']:.1f}m" if e['bp'] == 'dopo' else f"{e['bp']}% a +{e['dt'] // 60}m" if e['bp'] is not None else '?'
def riga(e): return (f"{e['sym']} ({e['stato']}) entra {ingresso(e)} con {e['sol_in']:.2f} SOL ({tx(e['sig_in'])}), esce: {e['uscita']}"
                     + (f" {fmt_t(e.get('t_uscita'))} ({tx(e.get('sig_uscita'))})" if e.get('sig_uscita') else '')
                     + (f", tiene {100 * e['quota_tenuta']:.0f}% ({e['valore_ora']:.2f} SOL adesso)" if e['tok_ora'] > 1 else '')
                     + f" → **{e['pnl']:+.2f}{segno(e)}**" + (f" _(entra nello stesso slot di altri {e['gruppo'] - 1} wallet)_" if e.get('gruppo', 0) >= 4 else ''))

def main():
    d = os.path.join(DATI, 'bonding/token'); T = []
    for f in sorted(os.listdir(d)):
        t = json.load(open(os.path.join(d, f)))
        if t.get('versione') == 2 and t.get('tutti'): T.append(t)
    R = leggi('bonding/registro.json', {})
    MIG = {}
    fm = sorted(x for x in os.listdir(os.path.join(DATI, 'risultati')) if x.startswith('migliori-') and x.endswith('.json'))
    if fm: MIG = json.load(open(os.path.join(DATI, 'risultati', fm[-1])))
    per_sol = {v['sol']: u for u, v in leggi('wallet.json', {}).items() if v.get('sol')}
    pacchetti = [r for r in R.values() if r.get('stato') == 'graduato' and r.get('fonte') == 'pumpfun' and r.get('graduato_at') and r.get('creato') and r['graduato_at'] - r['creato'] < 10]
    altre_fonti = [r for r in R.values() if r.get('stato') == 'graduato' and r.get('fonte') != 'pumpfun']
    G = [t for t in T if t.get('grad') and t['grad']['durata_s'] >= 10]
    E = []   # una riga per wallet e token
    GRUPPI = []   # slot in cui comprano per la prima volta 4+ wallet (fuori dal blocco della nascita): un solo operatore, di solito
    for t in G:
        stato = 'graduato'
        try: slot = {a['sig']: a['slot'] for a in json.load(open(os.path.join(DATI, 'bonding/grezzi', t['mint'] + '.json')))['righe']}
        except FileNotFoundError: slot = {}
        ns = defaultdict(list)
        for c in t['tutti']:
            if slot.get(c['sig_in']) and not c.get('blocco') and not c.get('fomo'): ns[slot[c['sig_in']]].append(c)
        for k in list(ns):   # nello slot si tiene il gruppo piu' grande di importi simili (il massimo entro 1,5 volte il minimo): un token caldo fa 5-10 acquisti a slot di suo
            cs = sorted(ns[k], key=lambda c: c['sol_in']); best = []
            for i in range(len(cs)):
                j = i
                while j < len(cs) and cs[j]['sol_in'] <= 1.5 * cs[i]['sol_in']: j += 1
                if j - i > len(best) and cs[i]['sol_in'] > 0.05: best = cs[i:j]
            ns[k] = cs = best
            if len(cs) >= 4:
                usc = defaultdict(int)
                for c in cs:
                    if slot.get(c.get('sig_uscita')): usc[slot[c['sig_uscita']]] += 1
                GRUPPI.append({'sym': (t.get('sym') or '').strip(), 'mint': t['mint'], 'slot': k, 'n': len(cs), 'bp': [c['bp'] for c in cs], 'sol_in': sum(c['sol_in'] for c in cs),
                               'pnl': sum(c['pnl'] for c in cs), 'sig': cs[0]['sig_in'], 'escono_insieme': max(usc.values()) if usc else 0, 'dt': cs[0]['dt'], 'min_dopo': cs[0].get('min_dopo')})
        for c in t['tutti']:
            uid = c.get('fomo_id') or per_sol.get(c['w'])
            E.append({**c, 'sym': (t.get('sym') or t['mint'][:6]).strip(), 'mint': t['mint'], 'stato': stato, 'fascia': fascia(c['bp']),
                      'uid': uid, 'handle': c.get('handle') or (MIG.get(uid) or {}).get('h'), 'migliore': bool((MIG.get(uid) or {}).get('migliore')),
                      'insider': bool(c.get('blocco') or c.get('creatore')), 'gruppo': len(ns.get(slot.get(c['sig_in']), [])) if any(x is c for x in ns.get(slot.get(c['sig_in']), [])) else 0})
    W = defaultdict(list)
    for e in E: W[e['w']].append(e)
    def tot(es): return sum(e['pnl'] for e in es)
    libere = {w: [e for e in es if not e['insider']] for w, es in W.items()}
    rank = sorted((w for w in libere if libere[w]), key=lambda w: -tot(libere[w]))
    chi = lambda w: next((f"**{e['handle']}**" + (' ★ fra i 29 migliori' if e['migliore'] else '') for e in W[w] if e.get('handle')), 'fomo (handle non trovato)' if any(e.get('fomo') for e in W[w]) else '')
    out = [f"# Chi guadagna in bonding e graduation, wallet per wallet — {time.strftime('%d/%m/%Y %H:%M', time.gmtime())} UTC", '']
    fin = [t['riassunto'].get('finestra_dopo_s') or 0 for t in G]
    out += ['## Su cosa si conta', '',
            f"- **{len(G)} token pump.fun graduati** studiati con lo schema completo (tutti i compratori in bonding e quelli della prima ora dopo la graduation); "
            f"esclusi **{len(pacchetti)} lanci a pacchetto** (nati e graduati in meno di 10 secondi: in bonding non c'era nulla da comprare) e {len(altre_fonti)} graduati di altre piattaforme (Raydium LaunchLab, Meteora DBC).",
            f"- {len(E)} righe wallet-token, **{len(W)} wallet** diversi; chiamate Helius registrate nei file: {sum(t.get('chiamate_helius', 0) for t in G)} getTransactionsForAddress + {sum(t.get('chiamate_altre', 0) for t in G)} altre.",
            f"- La storia dopo la graduation e' letta dal mint fino a +1 ora, al massimo 50 pagine: completa per {sum(1 for t in G if t['riassunto'].get('finestra_completa'))} token su {len(G)}; "
            f"sugli altri (token caldi, 20-120 tx al secondo sul pool) copre da {min(fin) // 60 if fin else 0} a {max(fin) // 60 if fin else 0} minuti. Chi a fine finestra tiene ancora token per almeno 0,3 SOL si segue dal suo conto token (i primi 60 per valore).",
            "- Risultato = SOL incassati − SOL spesi + quel che resta **venduto adesso** sulle riserve del pool (o della curva), ognuno come se vendesse da solo. "
            "**≈** = tiene a fine finestra e non e' stato seguito (o la lettura del conto e' incompleta): il resto e' valutato al prezzo di adesso, ma potrebbe aver venduto prima. **?** = ha passato i token ad altri wallet: risultato non noto. "
            "Prezzi dalla sede (curva o pool), commissioni pump.fun/pool comprese nel prezzo, commissioni fomo no.",
            "- Il **blocco della nascita** e il **creatore** stanno a parte: entrano insieme al lancio, non e' un ingresso che un altro possa replicare.", '']
    # 1. classifica
    out += ['## I primi 30 wallet per guadagno (fuori blocco della nascita e creatore)', '']
    pos = [w for w in rank if tot(libere[w]) > 0]
    somma_pos = sum(tot(libere[w]) for w in pos)
    out += [f"Wallet in utile {len(pos)} su {len(rank)}; utile totale {somma_pos:,.1f} SOL. Il primo pesa il {100 * tot(libere[rank[0]]) / somma_pos:.1f}%, i primi 10 il {100 * sum(tot(libere[w]) for w in rank[:10]) / somma_pos:.1f}%, i primi 50 il {100 * sum(tot(libere[w]) for w in rank[:50]) / somma_pos:.1f}%.", ''] if pos else []
    for i, w in enumerate(rank[:30], 1):
        es = sorted(libere[w], key=lambda e: -e['pnl']); v = sum(e['pnl'] > 0 for e in es)
        out += [f"{i}. {acc(w)} {chi(w)} — **{tot(es):+.2f} SOL** su {len(es)} token ({v} in utile)" + (f"; in piu' nel blocco della nascita/creatore: {len(W[w]) - len(es)}" if len(W[w]) > len(es) else '')]
        out += [f"   - {riga(e)}" for e in es]
    out.append('')
    # 2. ricorrenti
    ric = [w for w in rank if len(libere[w]) >= 2]
    out += ['## I wallet ricorrenti (2 o piu\' token)', '',
            f"{len(ric)} wallet compaiono in almeno 2 token; in utile in tutti {sum(1 for w in ric if all(e['pnl'] > 0 for e in libere[w]))}, in utile in totale {sum(1 for w in ric if tot(libere[w]) > 0)}. "
            f"Con 3 o piu' token: {sum(1 for w in ric if len(libere[w]) >= 3)}. Sotto i primi 40 per guadagno, con tutti i loro token (gli altri nel file JSON).", '']
    for w in ric[:40]:
        es = sorted(libere[w], key=lambda e: e['t0']); v = sum(e['pnl'] > 0 for e in es)
        fa = defaultdict(int)
        for e in es: fa[e['fascia']] += 1
        out += [f"- {acc(w)} {chi(w)} — **{tot(es):+.2f} SOL**, {len(es)} token, vince {v}; ingressi " + ', '.join(f"{k}: {n}" for k, n in sorted(fa.items()))]
        out += [f"   - {riga(e)}" for e in es]
    out.append('')
    # 3. per fascia di ingresso
    out += ['## Per punto di ingresso', '',
            "Ogni wallet-token conta una volta nella fascia del suo primo acquisto (% della curva; \"dopo\" = primo acquisto sul pool nella prima ora dopo la graduation). Fuori blocco della nascita e creatore.", '',
            '| fascia | wallet-token | in utile | SOL entrati | utile dei vincenti | perdite | primi 10 sull\'utile | risultati stimati (≈/?) |', '|---|---|---|---|---|---|---|---|']
    perf = defaultdict(list)
    for e in E:
        if not e['insider']: perf[e['fascia']].append(e)
    for k in FASCE + ['?']:
        es = perf.get(k)
        if not es: continue
        es.sort(key=lambda e: -e['pnl']); p = [e for e in es if e['pnl'] > 0]; sp = sum(e['pnl'] for e in p)
        out.append(f"| {k} | {len(es)} | {len(p)} ({100 * len(p) / len(es):.0f}%) | {sum(e['sol_in'] for e in es):,.1f} | {sp:+,.1f} | {sum(e['pnl'] for e in es if e['pnl'] < 0):+,.1f} | {100 * sum(e['pnl'] for e in p[:10]) / sp if sp else 0:.0f}% | {sum(1 for e in es if segno(e))} |")
    out.append('')
    for k in FASCE:
        es = perf.get(k)
        if not es: continue
        usc = defaultdict(int)
        for e in es: usc[e['uscita']] += 1
        tok = defaultdict(float)
        for e in es: tok[e['sym']] += e['pnl']
        tt = sorted(tok.items(), key=lambda x: -x[1])
        out += [f"### Ingresso {k}{'%' if k != 'dopo' else ''}", '',
                f"{len(es)} wallet-token su {len(set(e['mint'] for e in es))} token; uscite: " + ', '.join(f"{u} {n}" for u, n in sorted(usc.items(), key=lambda x: -x[1])) + '.',
                f"Per token, il risultato della fascia: i migliori " + ', '.join(f"{s} {v:+.1f}" for s, v in tt[:4]) + '; i peggiori ' + ', '.join(f"{s} {v:+.1f}" for s, v in tt[-3:]) + '.', '',
                'I 5 migliori:', ''] + [f"- {acc(e['w'])} {chi(e['w'])}: {riga(e)}" for e in es[:5]] + ['', 'I 5 peggiori:', ''] + [f"- {acc(e['w'])} {chi(e['w'])}: {riga(e)}" for e in es[-5:]] + ['']
    # 3b. gruppi nello stesso slot
    if GRUPPI:
        GRUPPI.sort(key=lambda g: -g['pnl'])
        out += ['## Gruppi: 4 o piu\' wallet che comprano per la prima volta nello stesso slot', '',
                f"{len(GRUPPI)} gruppi in {len(set(g['mint'] for g in GRUPPI))} token, {sum(g['n'] for g in GRUPPI)} wallet-token; in utile {sum(g['pnl'] > 0 for g in GRUPPI)} gruppi, {sum(g['pnl'] for g in GRUPPI if g['pnl'] > 0):+,.1f} SOL. "
                "Nello stesso slot (400 ms) con importi simili e' quasi sempre un solo operatore con molti wallet (bundle); se escono anche insieme, lo e' di sicuro. "
                "Nella classifica restano wallet per wallet, ma il guadagno va letto per gruppo. I primi 10:", '']
        out += [f"- {g['sym']}: **{g['n']} wallet** nello slot {g['slot']} ({ingresso({'bp': g['bp'][0], 'dt': g['dt'], 'min_dopo': g['min_dopo']})}, curva {min(b for b in g['bp'] if b != 'dopo' and b is not None) if any(b not in ('dopo', None) for b in g['bp']) else 'dopo'}…{max(b for b in g['bp'] if b != 'dopo' and b is not None) if any(b not in ('dopo', None) for b in g['bp']) else ''}%), {g['sol_in']:.1f} SOL, "
                f"escono insieme (stesso slot) {g['escono_insieme']} → **{g['pnl']:+.1f} SOL** ({tx(g['sig'], 'un ingresso')})" for g in GRUPPI[:10]] + ['']
    # 4. a parte: blocco della nascita e creatore
    ins = sorted([e for e in E if e['insider']], key=lambda e: -e['pnl'])
    if ins:
        out += ['## A parte: blocco della nascita e creatore', '',
                f"{len(ins)} righe (creatore {sum(1 for e in ins if e.get('creatore'))}, blocco della nascita {sum(1 for e in ins if e.get('blocco') and not e.get('creatore'))}); in utile {sum(e['pnl'] > 0 for e in ins)}, {sum(e['pnl'] for e in ins if e['pnl'] > 0):+,.1f} SOL di utile. I primi 10:", '']
        out += [f"- {acc(e['w'])} {'creatore' if e.get('creatore') else 'blocco della nascita'}: {riga(e)}" for e in ins[:10]] + ['']
    # 5. storie recenti dei wallet (fuori dai token scelti da noi)
    dw = os.path.join(DATI, 'bonding/wallet')
    S = [json.load(open(os.path.join(dw, f))) for f in sorted(os.listdir(dw)) if f.endswith('.json')] if os.path.isdir(dw) else []
    if S:
        out += ['## Gli stessi wallet sui token che non abbiamo scelto noi', '',
                "Storia recente di ogni wallet (Helius, ultimi 2 giorni, al massimo 1.500 transazioni): ogni token pump.fun comprato sulla curva in quel periodo, graduato o no; "
                "risultato = incassato − speso + quel che resta venduto adesso (curva o pool). Un token comprato prima dell'inizio della finestra non conta.", '']
        for s in sorted(S, key=lambda s: -sum(x['pnl'] for x in s['token'])):
            tk = s['token']; g = [x for x in tk if x.get('graduato')]; p = [x for x in tk if x['pnl'] > 0]; sp = sum(x['pnl'] for x in p)
            fa = defaultdict(int)
            for x in tk: fa[fascia(x['bp'])] += 1
            out += [f"### {acc(s['w'])} {chi(s['w']) if s['w'] in W else ''}", '',
                    f"Dal {fmt_t(s['da'])}: {s['tx']} transazioni{TAGLIO if not s['completa'] else ''}. **{len(tk)} token comprati sulla curva**, graduati {len(g)}, in utile **{len(p)}**; "
                    f"risultato {sum(x['pnl'] for x in tk):+.2f} SOL (utile {sp:+.2f}, perdite {sum(x['pnl'] for x in tk if x['pnl'] < 0):+.2f}); il token migliore pesa il {100 * p[0]['pnl'] / sp if sp else 0:.0f}% dell'utile. "
                    f"Ingressi: " + ', '.join(f"{k} {n}" for k, n in sorted(fa.items())) + f". Spesi in tutto {sum(x['sol_in'] for x in tk):.1f} SOL.", '']
            for x in tk[:5] + (tk[-3:] if len(tk) > 8 else tk[5:]):
                out.append(f"- `{x['mint']}` ({'graduato' if x.get('graduato') else 'in curva'}) entra al {x['bp']}% {fmt_t(x['t0'])} con {x['sol_in']:.2f} SOL ({tx(x['scambi'][0]['sig'])}), incassa {x['sol_out']:.2f}"
                           + (f", tiene {100 * x['quota_tenuta']:.0f}% ({x['valore_ora']:.2f} SOL adesso)" if x['tok_ora'] > 1 else '') + f" → **{x['pnl']:+.2f}**")
            out.append('')
    os.makedirs(os.path.join(DATI, 'risultati'), exist_ok=True)
    f = os.path.join(DATI, 'risultati', f"bonding-wallet-{time.strftime('%Y-%m-%d', time.gmtime())}.md")
    open(f, 'w').write('\n'.join(out))
    # i ricorrenti vincenti, per la storia recente (bonding_studio.js wallet ...)
    json.dump([w for w in ric if tot(libere[w]) > 0][:20], open(os.path.join(DATI, 'bonding/ricorrenti.json'), 'w'))
    print(f, len(G), 'token', len(W), 'wallet', len(ric), 'ricorrenti')

if __name__ == '__main__': main()
