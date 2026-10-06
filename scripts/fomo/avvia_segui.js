// Per browser_run_code_unsafe (filename: scripts/fomo/avvia_segui.js), con servi.py acceso e il login fatto.
// Lancia segui_pagina.js nella pagina con la lista dei migliori (dal ponte) e un timer lato Playwright
// che ogni minuto svuota la coda della pagina verso il ponte, che salva la fotografia del token.
async (page) => {
  // la scheda di lavoro e' quella col nome 'fomo-lavoro' (resta anche se la pagina cambia); se non
  // c'e', se ne apre una. Cosi' la persona puo' navigare nelle altre senza interrompere il lavoro.
  let lavoro = null;
  for (const p of page.context().pages()) { try { if (await p.evaluate(() => window.name) === 'fomo-lavoro') { lavoro = p; break; } } catch (e) {} }
  if (!lavoro) { lavoro = await page.context().newPage(); await lavoro.goto('https://fomo.family/leaderboard'); await lavoro.evaluate(() => { window.name = 'fomo-lavoro'; }); await lavoro.waitForTimeout(4000); }
  page = lavoro;
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
  const lista = await (await fetch(S + '/segui_lista.json')).json();
  const src = await (await fetch(S + '/segui_pagina.js')).text();
  const msg = await page.evaluate(`(${src.slice(src.indexOf('async ({'))})(${JSON.stringify({ LISTA: lista })})`);
  clearInterval(globalThis.__fomoSvuota);
  globalThis.__fomoSvuota = setInterval(async () => {
    try {
      const coda = await page.evaluate('(() => { const c = window.__fomoSeguiCoda || []; window.__fomoSeguiCoda = []; return JSON.stringify(c); })()');
      if (coda !== '[]') await fetch(S + '/segui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: coda });
    } catch (e) { globalThis.__fomoSvuotaErrore = e.message; }
  }, 60000);
  return msg;
}
