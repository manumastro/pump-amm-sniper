// Funzione eseguita DENTRO la pagina fomo (la lancia avvia_segui.js): ogni 3 minuti legge l'ultima
// pagina di swap di ogni utente della lista e manda al ponte locale quelli nuovi. L'header resta
// nella pagina; i nuovi vanno in window.__fomoSeguiCoda, che avvia_segui.js svuota verso il ponte.
// Si ferma con window.__fomoSeguiStop().
async ({ LISTA }) => {
  const get = async p => {
    for (let t = 0; t < 3; t++) {
      const h = window.__fomoH; if (!h) return null;
      const H = h instanceof Headers ? Object.fromEntries(h.entries()) : { ...h };
      const r = await fetch('https://prod-api.fomo.family' + p, { headers: H });
      if (r.status === 200) return r.json();
      await new Promise(z => setTimeout(z, 2000 * (t + 1)));
    }
    return null;
  };
  const visti = window.__fomoSeguiVisti = window.__fomoSeguiVisti || {};
  const giro = async () => {
    const nuovi = [];
    for (const { id, h } of LISTA) {
      const j = await get(`/v2/users/${id}/swaps`); const sw = j?.responseObject?.swaps || [];
      const primo = !(id in visti);
      for (const s of sw) {
        if (visti[id] && visti[id].includes(s.id)) continue;
        if (!primo) nuovi.push({ u: id, h, s: { id: s.id, net: s.networkId, i: s.inTokenAddress, o: s.outTokenAddress, ia: s.inHumanAmount, oa: s.outHumanAmount, ui: s.humanUsdAmountIn, uo: s.humanUsdAmountOut, t: s.createdAt, p: s.provider, inet: s.inNetworkId, onet: s.outNetworkId } });
      }
      visti[id] = sw.map(s => s.id).concat(visti[id] || []).slice(0, 200);
      await new Promise(z => setTimeout(z, 300));
    }
    window.__fomoSeguiStato = { ultimo: new Date().toISOString(), nuovi: nuovi.length, totale: (window.__fomoSeguiStato?.totale || 0) + nuovi.length };
    (window.__fomoSeguiCoda = window.__fomoSeguiCoda || []).push(...nuovi);
  };
  clearInterval(window.__fomoSeguiTimer);
  await giro();
  window.__fomoSeguiTimer = setInterval(giro, 180000);
  window.__fomoSeguiStop = () => clearInterval(window.__fomoSeguiTimer);
  return `seguo ${LISTA.length} utenti, ogni 3 minuti`;
}
