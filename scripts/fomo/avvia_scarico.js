// Per browser_run_code_unsafe (filename: scripts/fomo/avvia_scarico.js), con servi.py acceso.
// Apre la classifica, prende dal server cosa e' gia' salvato e lancia lo scarico nella pagina.
async (page) => {
  // la scheda di lavoro e' quella col nome 'fomo-lavoro' (resta anche se la pagina cambia); se non
  // c'e', se ne apre una. Cosi' la persona puo' navigare nelle altre senza interrompere il lavoro.
  let lavoro = null;
  for (const p of page.context().pages()) { try { if (await p.evaluate(() => window.name) === 'fomo-lavoro') { lavoro = p; break; } } catch (e) {} }
  if (!lavoro) { lavoro = await page.context().newPage(); await lavoro.goto('https://fomo.family/leaderboard'); await lavoro.evaluate(() => { window.name = 'fomo-lavoro'; }); await lavoro.waitForTimeout(4000); }
  page = lavoro;
  const S = 'http://127.0.0.1:8765';
  const noti = await (await fetch(S + '/noti.json')).json();
  const extra = await (await fetch(S + '/extra.json')).json();
  const riempi = await (await fetch(S + '/riempi.json')).json();
  const src = await (await fetch(S + '/scarico_pagina.js')).text();
  return await page.evaluate(`(${src.slice(src.indexOf('async ({'))})(${JSON.stringify({ NOTI: noti, EXTRA: extra, RIEMPI: riempi })})`);
}
