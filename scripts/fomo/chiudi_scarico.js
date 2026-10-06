// Per browser_run_code_unsafe (filename: scripts/fomo/chiudi_scarico.js), con servi.py acceso.
// Aspetta fino a 9 minuti la fine dello scarico; se e' finito lo manda al server, che lo importa.
// Se non e' finito restituisce lo stato: rilanciare.
async (page) => {
  // la scheda di lavoro e' quella col nome 'fomo-lavoro' (resta anche se la pagina cambia); se non
  // c'e', se ne apre una. Cosi' la persona puo' navigare nelle altre senza interrompere il lavoro.
  let lavoro = null;
  for (const p of page.context().pages()) { try { if (await p.evaluate(() => window.name) === 'fomo-lavoro') { lavoro = p; break; } } catch (e) {} }
  if (!lavoro) { lavoro = await page.context().newPage(); await lavoro.goto('https://fomo.family/leaderboard'); await lavoro.evaluate(() => { window.name = 'fomo-lavoro'; }); await lavoro.waitForTimeout(4000); }
  page = lavoro;
  for (let i = 0; i < 54; i++) {
    const st = JSON.parse(await page.evaluate('window.__fomoStato ? window.__fomoStato() : "{}"'));
    if (st.fine) {
      const corpo = await page.evaluate('JSON.stringify(window.__fomoScarico)');
      const r = await fetch('http://127.0.0.1:8765/scarico', { method: 'POST', headers: { 'content-type': 'application/json' }, body: corpo });
      return 'importato: ' + await r.text();
    }
    if (i === 53) return 'in corso: ' + JSON.stringify(st);
    await page.waitForTimeout(10000);
  }
}
