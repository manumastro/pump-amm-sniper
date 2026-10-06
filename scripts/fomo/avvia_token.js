// Per browser_run_code_unsafe (filename: scripts/fomo/avvia_token.js), con servi.py acceso e il login fatto.
// Ogni 15 minuti prende dalla scheda di lavoro il token d'accesso che l'app usa (si rinnova da solo
// nel browser loggato) e lo manda al ponte, che lo scrive in ~/.config/fomo-mcp/token per fomo-mcp.
async (page) => {
  // la scheda di lavoro e' quella col nome 'fomo-lavoro' (resta anche se la pagina cambia); se non
  // c'e', se ne apre una. Cosi' la persona puo' navigare nelle altre senza interrompere il lavoro.
  let lavoro = null;
  for (const p of page.context().pages()) { try { if (await p.evaluate(() => window.name) === 'fomo-lavoro') { lavoro = p; break; } } catch (e) {} }
  if (!lavoro) { lavoro = await page.context().newPage(); await lavoro.goto('https://fomo.family/leaderboard'); await lavoro.evaluate(() => { window.name = 'fomo-lavoro'; }); await lavoro.waitForTimeout(4000); }
  page = lavoro;
  const tab = page;
  const aggiorna = async (rifatto = false) => {
    if (!tab.url().includes('/leaderboard')) { await tab.goto('https://fomo.family/leaderboard'); await tab.evaluate(() => { window.name = 'fomo-lavoro'; }); await tab.waitForTimeout(4000); }
    const tok = await tab.evaluate(async () => {
      if (!window.__fomoH) {
        const of = window.fetch;
        window.fetch = async function (input, init) {
          try { const u = typeof input === 'string' ? input : input.url;
            if (u.includes('prod-api.fomo.family') && init && init.headers) window.__fomoH = init.headers; } catch (e) {}
          return of.apply(this, arguments);
        };
      }
      // si fa fare all'app una chiamata nuova: l'header catturato e' il token piu' recente
      window.__fomoH = null;
      for (let i = 0; i < 15 && !window.__fomoH; i++) {
        const bb = [...document.querySelectorAll('button')].filter(b => /^(24H|7D|30D|ALL)$/i.test(b.innerText.trim()));
        if (bb.length) bb[i % bb.length].click();
        await new Promise(r => setTimeout(r, 1000));
      }
      const h = window.__fomoH; if (!h) return null;
      const H = h instanceof Headers ? Object.fromEntries(h.entries()) : { ...h };
      const a = H.authorization || H.Authorization || ''; return a.replace(/^Bearer\s+/i, '');
    });
    // l'app in una scheda in secondo piano non rinnova il token: se scade entro 10 minuti si ricarica la pagina
    const scade = t => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).exp - Date.now() / 1000; } catch (e) { return 0; } };
    if (tok && scade(tok) < 600 && !rifatto) { await tab.reload(); await tab.evaluate(() => { window.name = 'fomo-lavoro'; }); await tab.waitForTimeout(6000); return aggiorna(true); }
    if (tok) await fetch('http://127.0.0.1:8765/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok }) });
    return !!tok;
  };
  const ok = await aggiorna();
  clearInterval(globalThis.__fomoToken);
  globalThis.__fomoToken = setInterval(() => aggiorna().catch(() => {}), 5 * 60 * 1000);
  return ok ? 'token scritto; rinnovo ogni 5 minuti' : 'nessun token: fare il login nella scheda di lavoro';
}
