// Funzione eseguita DENTRO la pagina fomo.family dopo il login (la lancia avvia_scarico.js).
// Non contiene credenziali: usa l'header che l'app stessa manda, catturato avvolgendo window.fetch,
// e lo rilegge a ogni chiamata (il token di sessione dura ~1 ora). NOTI: id -> ora dell'ultimo swap
// gia' salvato (si scarica solo il nuovo); EXTRA: id da scaricare oltre alle classifiche; RIEMPI: id
// di cui riscaricare tutti i 30 giorni (storie tagliate dal vecchio tetto di 1.500 swap).
// Avvia lo scarico e torna subito; lo stato si legge con window.__fomoStato().
async ({ NOTI, EXTRA, RIEMPI = [] }) => {
  const GIORNI = 30;
  if (!window.__fomoH) {
    const of = window.fetch;
    window.fetch = async function (input, init) {
      try { const u = typeof input === 'string' ? input : input.url;
        if (u.includes('prod-api.fomo.family') && init && init.headers) window.__fomoH = init.headers; } catch (e) {}
      return of.apply(this, arguments);
    };
  }
  // l'app ha la classifica in memoria: per farle fare una chiamata (e catturarne l'header) si
  // cambiano i periodi uno dopo l'altro e si scorre la pagina, fino a 15 secondi
  const bottoni = () => [...document.querySelectorAll('button')].filter(b => /^(24H|7D|30D|ALL)$/i.test(b.innerText.trim()));
  const clic = () => { const bb = bottoni(); if (bb.length) bb[Math.floor(Math.random() * bb.length)].click(); window.scrollTo(0, document.body.scrollHeight); };
  for (let i = 0; i < 15 && !window.__fomoH; i++) { clic(); await new Promise(r => setTimeout(r, 1000)); }
  if (!window.__fomoH) return 'nessun header: fare il login e aprire la classifica';
  clearInterval(window.__fomoRinnovo); window.__fomoRinnovo = setInterval(clic, 240000);
  const get = async p => {
    for (let t = 0; t < 5; t++) {
      const h = window.__fomoH; const H = h instanceof Headers ? Object.fromEntries(h.entries()) : { ...h };
      const r = await fetch('https://prod-api.fomo.family' + p, { headers: H });
      if (r.status === 200) return r.json();
      await new Promise(z => setTimeout(z, 1500 * (t + 1)));
    }
    return null;
  };
  const S = window.__fomoScarico = { inizio: new Date().toISOString(), classifiche: {}, utenti: {}, fatti: 0, falliti: [], fine: false };
  for (const p of ['24h', '7d', '30d', '']) {
    const j = await get('/v2/leaderboard' + (p ? '/' + p : ''));
    S.classifiche[p || 'sempre'] = (j?.responseObject?.leaderboard || []).map(u => { const o = { ...u }; delete o.profilePictureLink; delete o.description; delete o.thumbhash; return o; });
  }
  const ids = RIEMPI.length ? RIEMPI : [...new Set([...Object.values(S.classifiche).flat().map(u => u.id), ...EXTRA])];
  S.totale = ids.length;
  const limite = Date.now() - GIORNI * 86400e3;
  const uno = async id => {
    let fallito = false; const g = async p => { const j = await get(p); if (!j) fallito = true; return j; };
    const fino = NOTI[id] && !RIEMPI.includes(id) ? Date.parse(NOTI[id]) : limite;
    const l = (await g(`/v2/users/${id}/leaderboard`))?.responseObject || {};
    const sw = []; let last = null, more = true, n = 0;
    while (more && n < 600) { const j = await g(`/v2/users/${id}/swaps` + (last ? `?lastSwapIdV2=${last}` : '')); const ro = j?.responseObject; if (!ro?.swaps?.length) break;
      sw.push(...ro.swaps); more = ro.hasNextPage; last = ro.swaps.at(-1).id; n++; if (Date.parse(ro.swaps.at(-1).createdAt) <= fino) break; }
    const tr = []; last = null; more = true; let m = 0;
    while (more && m < 20) { const j = await g(`/v2/users/${id}/transfers` + (last ? `?lastTransferId=${last}` : '')); const ro = j?.responseObject; if (!ro?.transfers?.length) break;
      tr.push(...ro.transfers); more = ro.hasNextPage; last = ro.transfers.at(-1).id; m++; if (Date.parse(ro.transfers.at(-1).createdAt) <= fino) break; }
    const bro = (await g(`/v2/users/${id}/balances`))?.responseObject || {};
    S.utenti[id] = { fallito, preso: new Date().toISOString(), troncato: n >= 600 && Date.parse(sw.at(-1)?.createdAt || 0) > fino,
      profilo: { handle: l.userHandle, createdAt: l.createdAt, followers: l.followers, swapCount: l.swapCount, numTrades: l.numTrades, totalVolume: l.totalVolume, rank: l.rank, rank24h: l.rank24h, rank7d: l.rank7d, rank30d: l.rank30d },
      altro: { otherPnl: bro.otherPnl, livePerpPnl: bro.livePerpPnl, otherEquity: bro.otherEquity },
      bal: (bro.balances || []).map(b => ({ tok: b.balance?.tokenAddress, q: b.balance?.shiftedBalance, net: b.tokenFilterResult?.token?.networkId ?? b.userToken?.networkId, sym: b.tokenFilterResult?.token?.symbol,
        px: +b.tokenFilterResult?.priceUSD, mcap: +b.tokenFilterResult?.marketCap, vol24: +b.tokenFilterResult?.volume24, nato: b.tokenFilterResult?.createdAt,
        ut: b.userToken && { rem: b.userToken.humanAmountRemaining, avg: b.userToken.averageEntryPriceUsd, realC: b.userToken.currentRealizedPnlUsd, realT: b.userToken.totalRealizedPnlUsd, costC: b.userToken.currentCostBasisUsd, costT: b.userToken.totalCostBasisUsd, dal: b.userToken.holdingSince },
        val: b.valuation })),
      swaps: sw.filter(s => Date.parse(s.createdAt) > fino).map(s => ({ id: s.id, a: s.address, net: s.networkId, i: s.inTokenAddress, o: s.outTokenAddress, ia: s.inHumanAmount, oa: s.outHumanAmount, ui: s.humanUsdAmountIn, uo: s.humanUsdAmountOut, t: s.createdAt, p: s.provider, off: s.isOffPlatform, inet: s.inNetworkId, onet: s.outNetworkId })),
      transfers: tr.filter(t => Date.parse(t.createdAt) > fino).map(t => ({ type: t.type, tokenAddress: t.tokenAddress, usdAmount: t.usdAmount, humanAmount: t.humanAmount, createdAt: t.createdAt, net: t.networkId, from: t.fromAddress, to: t.toAddress })) };
    S.fatti++; if (fallito) S.falliti.push(id);
  };
  (async () => {
    let i = 0; const w = async () => { while (i < ids.length) { await uno(ids[i++]); await new Promise(z => setTimeout(z, 150)); } };
    await Promise.all([w(), w(), w()]);
    for (let giro = 0; giro < 3 && S.falliti.length; giro++) { const ff = S.falliti; S.falliti = []; for (const id of ff) await uno(id); }
    S.fine = new Date().toISOString();
  })();
  window.__fomoStato = () => JSON.stringify({ fatti: S.fatti, totale: S.totale, falliti: S.falliti.length, fine: S.fine });
  return `avviato: ${ids.length} utenti (${Object.keys(NOTI).length} gia' noti)`;
}
