// NON USARE (6/10): Axiom ha chiuso la sessione e bloccato la rete dopo questo ponte; la persona ha deciso di non
// riprovare per non rischiare il ban dell'account. Resta solo come documentazione dell'API.
// Per browser_run_code_unsafe (filename: scripts/fomo/avvia_axiom.js), con bonding_live.mjs acceso e il login ad Axiom
// fatto dalla persona nel browser Playwright (serve una scheda axiom.trade aperta). Solo letture: nessun callout, voto o trade.
//  - Callout, in tempo reale: WebSocket wss://horn.axiom.trade/ws (lo stesso della sezione Callouts di Axiom), aperto
//    dentro la scheda loggata (i cookie di sessione restano nel browser). Ci si iscrive ai token con
//    {type:'view', view:[{chain, tokenAddress}]}; arrivano 'replay' (lo storico di ogni token) e 'post' (i nuovi), da
//    quattro fonti: axiom (callout Axiom), gmgn (callout GMGN, con KOL e follower), pumpfun (commenti pump.fun),
//    fomo (non usati: le tesi fomo le legge gia' bonding_live).
//  - Post su X che citano il contratto: GET api8.axiom.trade/x-tweets, un token alla volta, solo per i primi 15 della
//    lista, ogni 2 minuti (il 6/10 con 40 token ogni 45 s Axiom ha risposto 429 e poi ha chiuso la sessione).
// Prudenza: un solo WebSocket; se Axiom risponde 401/403 o chiude con 4401/4403 il ponte si ferma da solo (niente
// tentativi a vuoto su una sessione scaduta: va rifatto il login e rilanciato lo script); dopo 5 chiusure di fila si ferma.
// La lista dei token viene da bonding_live (GET /axiom-lista) ogni 30 secondi; ogni 15 secondi i token cambiati
// vanno a bonding_live (POST /axiom). Se il WebSocket cade si riapre da solo.
async (page) => {
  let ax = null;
  for (const p of page.context().pages()) { try { if (p.url().startsWith('https://axiom.trade')) { ax = p; break; } } catch (e) {} }
  if (!ax) return 'nessuna scheda axiom.trade aperta: aprirne una e fare il login';
  const LIVE = 'http://127.0.0.1:8787';
  // dentro la pagina: WebSocket, archivio dei callout per token, lettura dei post su X
  const avvio = await ax.evaluate(() => {
    const G = window.__hornLive ||= { per: {}, x: {}, sporchi: new Set(), lista: [], ws: null, stato: 'nuovo', aperture: 0, ultimoFrame: 0, fermo: null, cadute: 0 };
    G.fermo = null; G.cadute = 0;
    // un callout di qualsiasi fonte nella stessa forma
    const norm = p => {
      const c = p.callout || {}, s = p.source;
      if (s === 'axiom') return { id: c.id, src: 'axiom', t: c.createdAt, h: c.callerHandle || c.xHandle || '(anonimo)', body: c.body, mc: c.marketCapUsdAtPost, pos: c.verifiedHoldingUsd ?? c.holdingUsd, picco: c.peakMultiple, wr: c.caller?.winRate, ncall: c.caller?.calloutCount, pnl_caller: c.caller?.realizedPnlUsd, verified: !!c.caller?.verified, voti: (c.agreeCount || 0) - (c.disagreeCount || 0) };
      if (s === 'gmgn') return { id: c.id, src: 'gmgn', t: c.createdAt, h: c.callerHandle || c.callerName || (c.callerWallet || '').slice(0, 6), body: c.body, mc: c.callMarketCapUsd, pos: c.currentHoldingUsd, picco: c.multiplier, kol: !!c.isKol, follower: c.callerFollowerCount, verified: !!c.isBlueVerified };
      if (s === 'pumpfun') return { id: c.id, src: 'pump', t: c.createdAt, h: c.traderHandle || (c.traderWallet || '').slice(0, 6), x: c.traderXUsername, body: c.body, mc: c.marketCapUsd, pos: c.positionUsd, picco: c.maxMultiple, verified: !!c.isVerified, likes: c.likes || 0 };
      return null;
    };
    const metti = p => {
      if (!p || p.source === 'fomo') return;
      const n = norm(p); const tok = p.callout?.tokenAddress; if (!n || !n.id || !tok) return;
      n.body = String(n.body || '').slice(0, 200);
      for (const k of ['mc', 'pos']) if (n[k] != null) n[k] = Math.round(n[k]);
      if (n.picco != null) n.picco = +(+n.picco).toFixed(2);
      const A = (G.per[tok] ||= {});
      if (!A[n.id]) { A[n.id] = n; G.sporchi.add(tok); }
    };
    const vista = () => { if (G.ws?.readyState === 1) G.ws.send(JSON.stringify({ type: 'view', view: G.lista.map(t => ({ chain: 'sol', tokenAddress: t })) })); };
    G.vista = vista;
    const apri = () => {
      const ws = new WebSocket('wss://horn.axiom.trade/ws'); G.ws = ws; G.stato = 'apertura'; G.aperture++;
      ws.onopen = () => { G.stato = 'aperto'; G.cadute = 0; vista(); };
      ws.onmessage = e => { G.ultimoFrame = Date.now(); let j; try { j = JSON.parse(e.data); } catch (x) { return; }
        if (j.type === 'replay') (j.posts || []).forEach(metti); else if (j.type === 'post') metti(j.post); };
      ws.onclose = e => { G.stato = 'chiuso ' + e.code; if (G.ws !== ws || G.fermo) return;
        if (e.code === 4401 || e.code === 4403) { G.fermo = 'WebSocket rifiutato (' + e.code + '): login da rifare'; return; }
        if (++G.cadute >= 5) { G.fermo = 'WebSocket caduto 5 volte di fila (ultimo codice ' + e.code + ')'; return; }
        setTimeout(apri, 5000 * 2 ** G.cadute); };
    };
    if (!G.ws || G.ws.readyState > 1) apri();
    clearInterval(G.ping); G.ping = setInterval(() => { if (G.ws?.readyState === 1) G.ws.send(JSON.stringify({ type: 'ping' })); }, 25000);
    // post su X (REST): ogni 60 secondi per la lista corrente
    G.leggiX = async () => {
      if (G.fermo) return;
      for (const tok of G.lista.slice(0, 15)) {
        try { const r = await fetch('https://api8.axiom.trade/x-tweets?tokenAddress=' + tok + '&limit=50&all=1', { credentials: 'include' });
          if (r.status === 401 || r.status === 403) { G.fermo = 'Axiom risponde ' + r.status + ': login da rifare'; G.ws?.close(); return; }
          if (r.status === 429) { await new Promise(z => setTimeout(z, 60000)); return; }
          if (!r.ok) continue;
          const x = await r.json();
          G.x[tok] = (x.tweets || []).map(w => ({ t: w.tweet?.createdAt, id: w.tweet?.id, handle: w.tweet?.author?.handle, followers: w.tweet?.author?.followers || 0, verified: w.tweet?.author?.verified || null, text: String(w.tweet?.text || '').slice(0, 200), spam: !!w.spam, promo: !!w.promo }));
          G.sporchi.add(tok);
        } catch (e) {}
        await new Promise(z => setTimeout(z, 1500)); }
    };
    // cosa mandare: i token cambiati, con tutti i loro callout (al massimo i 80 piu' recenti) e i post su X
    G.prendi = () => { const out = {}; for (const tok of G.sporchi) { const c = Object.values(G.per[tok] || {}).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 80); out[tok] = { callouts: c, tweets: G.x[tok] || [] }; } G.sporchi.clear(); return out; };
    G.setLista = l => { const nuova = JSON.stringify(l) !== JSON.stringify(G.lista); G.lista = l; if (nuova) vista(); };
    return G.stato;
  });
  const lista = async () => { try { const l = await (await fetch(LIVE + '/axiom-lista')).json(); await ax.evaluate(l => window.__hornLive.setLista(l), l); } catch (e) {} };
  const manda = async () => {
    const dati = await ax.evaluate(() => window.__hornLive.prendi());
    const st = await ax.evaluate(() => ({ stato: window.__hornLive.fermo ? 'fermo: ' + window.__hornLive.fermo : window.__hornLive.stato, aperture: window.__hornLive.aperture, ultimo: window.__hornLive.ultimoFrame }));
    await fetch(LIVE + '/axiom', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: Date.now() / 1000, ws: st, dati }) });
    return Object.keys(dati).length;
  };
  for (const k of ['__axL', '__axM', '__axX', '__axiomLive']) clearInterval(globalThis[k]);
  await lista(); await ax.evaluate(() => window.__hornLive.leggiX());
  await new Promise(r => setTimeout(r, 4000));
  const n = await manda();
  globalThis.__axL = setInterval(() => lista().catch(() => {}), 30 * 1000);
  globalThis.__axM = setInterval(() => manda().catch(() => {}), 15 * 1000);
  globalThis.__axX = setInterval(() => ax.evaluate(() => window.__hornLive.leggiX()).catch(() => {}), 120 * 1000);
  return `axiom: WebSocket ${avvio}, ${n} token mandati; callout in tempo reale, post su X ogni 2 min`;
}
