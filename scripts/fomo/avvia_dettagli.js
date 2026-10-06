// Per browser_run_code_unsafe (filename: scripts/fomo/avvia_dettagli.js), con servi.py acceso.
// Per gli utenti di dati/fomo/dettagli_lista.json scarica dalla pagina: curva giornaliera di PnL e
// patrimonio a 30 giorni (/v2/userTokens/aggregatedSnapshot), posizioni di fomo con i commenti
// (/trades, aperte e chiuse degli ultimi 30 giorni) e trade migliori (/spotlight). Li manda al ponte,
// che li salva in dati/fomo/dettagli/<id>.json. Torna quando ha finito (pochi minuti).
async (page) => {
  // la scheda di lavoro e' quella col nome 'fomo-lavoro' (resta anche se la pagina cambia); se non
  // c'e', se ne apre una. Cosi' la persona puo' navigare nelle altre senza interrompere il lavoro.
  let lavoro = null;
  for (const p of page.context().pages()) { try { if (await p.evaluate(() => window.name) === 'fomo-lavoro') { lavoro = p; break; } } catch (e) {} }
  if (!lavoro) { lavoro = await page.context().newPage(); await lavoro.goto('https://fomo.family/leaderboard'); await lavoro.evaluate(() => { window.name = 'fomo-lavoro'; }); await lavoro.waitForTimeout(4000); }
  page = lavoro;
  // la scheda puo' essere stata spostata o ricaricata: si torna alla classifica e si ricattura l'accesso
  if (!page.url().includes('/leaderboard')) { await page.goto('https://fomo.family/leaderboard'); await page.waitForTimeout(4000); }
  await page.evaluate(async () => {
    if (!window.__fomoFetchAvvolto) {
      const of = window.fetch; window.__fomoFetchAvvolto = true;
      window.fetch = async function (input, init) {
        try { const u = typeof input === 'string' ? input : input.url;
          if (u.includes('prod-api.fomo.family') && init && init.headers) window.__fomoH = init.headers; } catch (e) {}
        return of.apply(this, arguments);
      };
    }
    for (let i = 0; i < 15 && !window.__fomoH; i++) {
      const bb = [...document.querySelectorAll('button')].filter(b => /^(24H|7D|30D|ALL)$/i.test(b.innerText.trim()));
      if (bb.length) bb[i % bb.length].click(); await new Promise(r => setTimeout(r, 1000));
    }
  });
  const S = 'http://127.0.0.1:8765';
  const lista = await (await fetch(S + '/dettagli_lista.json')).json();
  let fatti = 0;
  for (const id of lista) {
    const dati = await page.evaluate(async (id) => {
      const get = async p => { for (let t = 0; t < 5; t++) { try { const h = window.__fomoH; const H = h instanceof Headers ? Object.fromEntries(h.entries()) : { ...h };
        const r = await fetch('https://prod-api.fomo.family' + p, { headers: H }); if (r.status === 200) return (await r.json()).responseObject; } catch (e) {} await new Promise(z => setTimeout(z, 2000 * (t + 1))); } return null; };
      const da = new Date(Date.now() - 30 * 86400e3).toISOString();
      const curva = await get(`/v2/userTokens/aggregatedSnapshot?userId=${id}&timestamp=${da}`);
      const spotlight = await get(`/v2/users/${id}/spotlight`);
      const trades = { attivi: [], chiusi: [] }; let last = null;
      for (let n = 0; n < 40; n++) {
        const r = await get(`/trades?userId=${id}` + (last ? `&lastTradeId=${last}` : '')); if (!r) break;
        if (n === 0) trades.attivi = r.activeTrades || [];
        const c = r.closedTrades || []; trades.chiusiTotali = r.closedCount;
        // il parametro di pagina non e' documentato: se la pagina ripete la precedente ci si ferma
        if (c.length && trades.chiusi.some(x => x.trade?.id === c[0].trade?.id)) { trades.paginaRipetuta = true; break; }
        trades.chiusi.push(...c);
        if (!r.hasNextPage || !c.length) break;
        const ultimo = c.at(-1); last = ultimo.trade?.id;
        if (Date.parse(ultimo.trade?.closedAt || ultimo.trade?.createdAt || 0) < Date.parse(da)) break;
      }
      return { id, preso: new Date().toISOString(), curva, spotlight, trades };
    }, id);
    await fetch(S + '/dettagli', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dati) });
    fatti++;
  }
  return `dettagli scaricati: ${fatti} utenti`;
}
