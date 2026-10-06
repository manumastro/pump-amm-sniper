# Report dello studio bonding/graduation: dati/fomo/bonding/token/*.json (da bonding_studio.js) e il
# registro del tracciatore → dati/fomo/risultati/bonding-<data>.md. Caso per caso, con conteggi e
# concentrazione; niente medie. Le note scritte a mano stanno in dati/fomo/bonding/note.md (in testa).
import json, os, math, time
from comune import DATI, leggi
K = 30 * 1.073e9                      # curva pump.fun: SOL virtuali x token virtuali
fmt_t = lambda t: time.strftime('%d/%m %H:%M:%S', time.gmtime(t)) if t else '-'
corto = lambda w: f'[{w[:4]}…{w[-4:]}](https://solscan.io/account/{w})' if w else '-'
tx = lambda s, testo='tx': f'[{testo}](https://solscan.io/tx/{s})' if s else '-'
def x(a, b): return f'{a / b:.2f}x' if a and b else '-'
def bp_da_mcap(mcap_usd, solusd):
    if not mcap_usd or not solusd: return None
    p = mcap_usd / solusd / 1e9; vt = math.sqrt(K / p); return max(0, min(100, (1.073e9 - vt) / 7.931e8 * 100))
def usd(px, s): return f'${px * 1e9 * s / 1000:,.0f}k' if px and s else '-'

def main():
    R = leggi('bonding/registro.json', {})
    d = os.path.join(DATI, 'bonding/token'); T = [json.load(open(os.path.join(d, f))) for f in sorted(os.listdir(d)) if f.endswith('.json')]
    T = [t for t in T if t.get('riassunto', {}).get('compratori')]   # storie rotte (nessun acquisto ricostruito) fuori
    G = sorted([t for t in T if t.get('grad')], key=lambda t: -t['grad']['t']); NG = [t for t in T if not t.get('grad')]
    out = [f"# Bonding e graduation su fomo — {time.strftime('%d/%m/%Y %H:%M', time.gmtime())} UTC", '']
    note = os.path.join(DATI, 'bonding/note.md')
    if os.path.exists(note): out += [open(note).read(), '']
    # il quadro dal registro
    reg = list(R.values()); grad = [r for r in reg if r['stato'] == 'graduato']
    ist = [r for r in grad if r.get('graduato_at') and r.get('creato') and r['graduato_at'] - r['creato'] < 10]
    seg = [r for r in reg if r.get('prima_lista') == 'bonding']
    out += ['## Il registro del tracciatore', '',
            f"- Token visti: **{len(reg)}** (dal {fmt_t(min(r['primo_visto'] for r in reg))}); graduati {len(grad)}, ancora in bonding {sum(r['stato'] == 'bonding' for r in reg)}, morti (curva ferma da 6 ore) {sum(r['stato'] == 'morto' for r in reg)}.",
            f"- Graduati **istantanei** (nati e graduati entro 10 secondi: la curva l'ha riempita chi lancia, in bonding non c'e' stato nulla da comprare): **{len(ist)} su {len(grad)}** — " + ', '.join(sorted({r['sym'] for r in ist}))[:400] + '.',
            f"- Seguiti dalla lista \"Bonding\" (quasi graduati, sopra ~75%): **{len(seg)}**; di questi graduati {sum(r['stato'] == 'graduato' for r in seg)}, morti {sum(r['stato'] == 'morto' for r in seg)}, ancora in bonding {sum(r['stato'] == 'bonding' for r in seg)}.", '']
    vecchi = [r for r in seg if r['stato'] == 'bonding' and r.get('creato') and time.time() - r['creato'] > 86400]
    if vecchi: out += [f"- Nella lista \"Bonding\" stanno anche token nati da piu' di un giorno e mai graduati: **{len(vecchi)} su {sum(r['stato'] == 'bonding' for r in seg)}** di quelli ancora in bonding (fermi fra il 75% e il 99%).", '']
    chiamate = sum(t.get('chiamate_helius', 0) for t in T)
    out += [f"Studiati sulla catena: **{len(G)} graduati** e **{len(NG)} non graduati**; chiamate Helius registrate nei file: {chiamate} (100 tx complete per chiamata).", '']
    # la strategia: entrare a 80% / 90% della curva, uscire alla graduation o dopo
    out += ['## La regola "compra in bonding, vendi dopo la graduation", token per token', '',
            "Prezzo d'ingresso = primo scambio sulla curva oltre la soglia; uscita = prezzo mediano del pool all'ora indicata. Multipli lordi, senza commissioni (~1% pump.fun, ~1-2% fomo per lato).", '',
            '| token | bonding | ingresso 80% | 90% | fine curva | +5m | +30m | +1h | adesso | da 90% a +5m | da 90% a +1h | da 90% adesso |', '|---|---|---|---|---|---|---|---|---|---|---|---|']
    for t in G:
        p, s = t['px'], t.get('soglie', {})
        e80, e90 = (s.get('80') or {}).get('px'), (s.get('90') or {}).get('px')
        f = lambda v: f'{v * 1e9:.0f}' if v else '-'   # SOL di capitalizzazione (prezzo x 1 miliardo)
        out.append(f"| {t.get('sym')} | {round(t['grad']['durata_s'] / 60)} min | {f(e80)} | {f(e90)} | {f(p.get('curva_fine'))} | {f(p.get('m5'))} | {f(p.get('m30'))} | {f(p.get('h1'))} | {f(p.get('ora'))} | {x(p.get('m5'), e90)} | {x(p.get('h1'), e90)} | {x(p.get('ora'), e90)} |")
    out += ['', "_Valori in SOL di capitalizzazione (prezzo x 1 miliardo di token); la curva finisce sempre a ~411 SOL._", '']
    for k, nome in [('m5', '+5 minuti'), ('h1', '+1 ora'), ('ora', 'adesso')]:
        ok = [t for t in G if t['px'].get(k) and (t.get('soglie', {}).get('90') or {}).get('px')]
        su = [t for t in ok if t['px'][k] > t['soglie']['90']['px']]
        sopra = [t for t in ok if t['px'][k] > (t['px'].get('curva_fine') or 1)]
        if ok: out.append(f"- Entrando al 90% e uscendo a {nome}: in guadagno **{len(su)} su {len(ok)}**; prezzo sopra la fine della curva {len(sopra)} su {len(ok)}.")
    if NG:
        out += ['', 'I non graduati studiati (chi e\' entrato al 80-90% non ha avuto la graduation):', '']
        for t in NG:
            s = t.get('soglie', {}); e90 = (s.get('90') or {}).get('px'); e80 = (s.get('80') or {}).get('px')
            out.append(f"- **{t.get('sym')}** ({t['mint'][:6]}…): curva al massimo {(t.get('registro') or {}).get('bp_max') or t.get('bp_max_catena', 0):.0f}%, adesso {x(t['px'].get('ora'), e80)} rispetto all'ingresso all'80%" + (f", {x(t['px'].get('ora'), e90)} rispetto al 90%" if e90 else '') + f"; ultima tx {fmt_t(t.get('ultima_tx'))}.")
    out.append('')
    # caso per caso
    out += ['## Caso per caso', '']
    for t in G + NG:
        s, p, ra, g = t.get('sol_usd'), t['px'], t.get('riassunto', {}), t.get('grad')
        out += [f"### {t.get('sym')} — {t.get('nome')}", '',
                f"`{t['mint']}` · [fomo](https://fomo.family/tokens/solana/{t['mint']}) · nato {fmt_t(t.get('nascita'))} da {corto(t.get('creatore'))}"
                + (f" · **graduato {fmt_t(g['t'])}** dopo {round(g['durata_s'] / 60)} min ({tx(g['sig'], 'migrazione')})" if g else f" · **non graduato** (massimo {(t.get('registro') or {}).get('bp_max') or t.get('bp_max_catena', 0):.0f}% nella lista)")
                + (f" · storia parziale: {t['parziale']}" if t.get('parziale') else ''), '']
        n = t.get('narrativa', {}); desc = (t.get('desc') or '').replace('\n', ' ')[:220]
        out += [f"**Narrativa:** {', '.join(n.get('tipi', []))} ({', '.join(n.get('segnali', []))}). " + (f"\"{desc}\" " if desc else '') + ' '.join(f'[{k}]({v})' for k, v in [('X', t.get('twitter')), ('sito', t.get('sito'))] if v), '']
        if g: out += [f"**Prezzo** (capitalizzazione, SOL a ${s:.0f} dagli scambi fomo): fine curva {usd(p.get('curva_fine'), s)}, +5m {usd(p.get('m5'), s)}, +30m {usd(p.get('m30'), s)}, +1h {usd(p.get('h1'), s)}, adesso {usd(p.get('ora'), s)} ({x(p.get('ora'), p.get('curva_fine'))} la fine curva)." if s else f"**Prezzo**: {p}", '']
        if ra:
            f = ra.get('fasce', {})
            out += [f"**Compratori in bonding: {ra['compratori']}**, {ra['sol_in_tot']:.1f} SOL entrati. In utile (al prezzo di riferimento) **{ra['in_utile']} su {ra['compratori']}**; utile totale {ra['utile_tot']:.1f} SOL, perdite {ra['perdita_tot']:.1f} SOL. Il primo pesa {100 * (ra.get('quota_primo') or 0):.0f}% dell'utile, i primi 10 il {100 * (ra.get('quota_primi10') or 0):.0f}%.",
                    (f"Token passati senza pagare (trasferimenti) prima della graduation: " + '; '.join(f"{corto(d['da'])}{' (creatore)' if d['creatore'] else ''} → {d['wallet']} wallet, {d['tok'] / 1e6:.1f}M token ({100 * d['quota_offerta']:.1f}% dell'offerta), dal {fmt_t(d['primo'])}" for d in ra['distribuzioni']) + f". Wallet che hanno solo ricevuto: {ra.get('solo_ricevuti', 0)}.") if ra.get('distribuzioni') else 'Nessuna distribuzione di token a piu\' di 2 wallet prima della graduation.',
                    'Per punto d\'ingresso sulla curva: ' + '; '.join(f"{k}% → {v['n']} wallet, {v['in_utile']} in utile, {v['sol_in']:.1f} SOL dentro, {v['pnl']:+.1f} SOL" for k, v in sorted(f.items())) + '.', '']
        top = [c for c in t.get('conti', [])][:6]
        if top:
            out += ['Chi ha guadagnato di piu\' fra i compratori in bonding:', '', '| wallet | fomo | ingresso | curva | SOL dentro | venduto in bonding | dopo la graduation | risultato (SOL) | tx ingresso |', '|---|---|---|---|---|---|---|---|---|']
            for c in top:
                ing = f"+{c['prima'] // 60}m{c['prima'] % 60:02d}s" + (' (blocco della nascita)' if c.get('nel_blocco_nascita') else '') + (' **creatore**' if c.get('creatore') else '')
                u = c.get('uscite') or []; vd = c.get('vendite_d') or []
                dopo = (f"{c.get('incasso_dopo', 0):+.2f} SOL" + (f", ultima {fmt_t((u or vd)[-1]['t'])}" if (u or vd) else '') + (f", tiene {c['tok_ora'] / 1e6:.1f}M" if c.get('tok_ora') else ', uscito')) if c.get('pnl_vero') is not None or vd else f"tiene {c['tok_alla_grad'] / 1e6:.1f}M (non seguito)"
                ris = f"**{c['pnl_vero']:+.2f}** (vero)" if c.get('pnl_vero') is not None else f"{c['pnl_mark']:+.2f} (a +1h)"
                fo = (c.get('handle') or 'si') + (' ★' if c.get('migliore') else '') if c.get('fomo') else ''
                out.append(f"| {corto(c['w'])} | {fo} | {ing} | {c['bp_ingresso']}% | {c['sol_in']:.2f} | {c['sol_out_b']:.2f} | {dopo} | {ris} | {tx(c['compre'][0]['sig'])} |")
            out.append('')
        cr = next((c for c in t.get('conti', []) + t.get('perdenti', []) if c.get('creatore')), None)
        if cr: out += [f"Il creatore ha comprato {cr['sol_in']:.2f} SOL alla nascita, ne ha venduti in bonding per {cr['sol_out_b']:.2f} SOL, alla graduation teneva {cr['tok_alla_grad'] / 1e6:.1f}M token.", '']
        F = t.get('fomo') or {}; fc = t.get('fomo_conti', [])
        if fc or F.get('feed'):
            fr = ra.get('fomo', {})
            primi = sorted(fc, key=lambda c: c['compre'][0]['t'])[:5]
            out += [f"**fomo:** {fr.get('wallet', len(fc))} wallet fomo hanno comprato in bonding (in utile {fr.get('in_utile', '-')}, {fr.get('pnl', 0):+.1f} SOL in tutto); detentori fomo adesso {(F.get('top') or {}).get('fomo_detentori', '-')}; scambi fomo nel feed {len(F.get('feed', []))}, tesi {len(F.get('tesi', []))}."]
            if primi: out.append('I primi utenti fomo a entrare: ' + '; '.join(f"{c.get('handle') or corto(c['w'])}{' ★' if c.get('migliore') else ''} a +{c['prima'] // 60} min, curva {c['bp_ingresso']}%, {c['sol_in']:.2f} SOL → {c['pnl_vero'] if c.get('pnl_vero') is not None else c['pnl_mark']:+.2f} SOL" for c in primi) + '.')
            m = t.get('migliori_fomo') or []
            out.append(('Fra i 29 migliori: ' + '; '.join(f"{x['h']} ({len(x['swap'])} scambi, il primo {fmt_t(min(s['t'] for s in x['swap']))})" for x in m) + '.') if m else 'Nessuno dei 29 migliori ha scambiato questo token.')
            tesi = sorted(F.get('tesi', []), key=lambda z: z['t'])
            prima = [z for z in tesi if not g or z['t'] <= g['t']]
            if tesi:
                out.append(f"Tesi scritte prima della graduation: {len(prima)} su {len(tesi)}. Le prime: " + ' · '.join(f"{z['h']} a curva ~{(bp_da_mcap(z['mcap'], s) or 0):.0f}%: \"{z['testo'][:90]}\"" for z in prima[:4]) + '.')
            out.append('')
    os.makedirs(os.path.join(DATI, 'risultati'), exist_ok=True)
    f = os.path.join(DATI, 'risultati', f"bonding-{time.strftime('%Y-%m-%d', time.gmtime())}.md")
    open(f, 'w').write('\n'.join(out)); print(f, len(G), 'graduati', len(NG), 'non graduati')

if __name__ == '__main__': main()
