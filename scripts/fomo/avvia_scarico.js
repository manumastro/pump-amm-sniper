// Per browser_run_code_unsafe (filename: scripts/fomo/avvia_scarico.js), con servi.py acceso.
// Apre la classifica, prende dal server cosa e' gia' salvato e lancia lo scarico nella pagina.
async (page) => {
  const S = 'http://127.0.0.1:8765';
  const noti = await (await fetch(S + '/noti.json')).json();
  const extra = await (await fetch(S + '/extra.json')).json();
  const src = await (await fetch(S + '/scarico_pagina.js')).text();
  if (!page.url().includes('/leaderboard')) { await page.goto('https://fomo.family/leaderboard'); await page.waitForTimeout(3000); }
  return await page.evaluate(`(${src.slice(src.indexOf('async ({'))})(${JSON.stringify({ NOTI: noti, EXTRA: extra })})`);
}
