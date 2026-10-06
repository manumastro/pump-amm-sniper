// Per browser_run_code_unsafe (filename: scripts/axiom/avvia_sessione.js), con servi.py acceso e il login ad Axiom fatto
// dalla persona in una scheda axiom.trade del browser Playwright. E' l'equivalente di avvia_token.js per fomo: la pagina di
// Axiom rinnova da sola la sessione (refresh-access-token, ~ogni 15 minuti); a ogni rinnovo riuscito e comunque ogni
// 2 minuti si mandano a servi.py (POST /axiom-sessione -> ~/.config/axiom/sessione) il cookie d'accesso, i cookie di
// Cloudflare e lo user-agent della scheda. Il demone scripts/axiom/axiom_live.mjs li rilegge e fa solo letture REST.
// Il refresh token NON si esporta: lo usa solo la pagina, cosi' due rinnovi concorrenti non possono invalidare la sessione.
// Nessun valore passa dalla conversazione: i cookie vanno dal browser a servi.py e da li' al file. Nessun click.
async (page) => {
  // la scheda Axiom si cerca a ogni invio e i rinnovi si ascoltano su tutto il browser: chiudere o ricaricare la scheda
  // non ferma il ponte (prima restava agganciato a una scheda sola e si fermava senza dirlo)
  const ctx = page.context();
  const scheda = () => ctx.pages().find(p => { try { return !p.isClosed() && p.url().startsWith('https://axiom.trade'); } catch (e) { return false; } });
  if (!scheda()) return 'nessuna scheda axiom.trade aperta: aprirne una e fare il login';
  const NOMI = ['auth-access-token', 'cf_clearance', '__cf_bm'];
  const R = globalThis.__axRinnovi ||= { ok: 0, ko: 0, ultimo: null };
  let ua = null;
  const manda = async () => {
    const cookies = (await ctx.cookies('https://api8.axiom.trade')).filter(c => NOMI.includes(c.name));
    if (!cookies.some(c => c.name === 'auth-access-token')) return false;
    const ax = scheda(); if (ax) ua = await ax.evaluate(() => navigator.userAgent).catch(() => ua);
    if (!ua) return false;
    await fetch('http://127.0.0.1:8765/axiom-sessione', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: new Date().toISOString(), ua, cookies, rinnovi: { ...R } }) });
    return true;
  };
  if (globalThis.__axResp) { try { (globalThis.__axCtx || ctx).off('response', globalThis.__axResp); } catch (e) {} }
  globalThis.__axResp = r => {
    if (!r.url().includes('refresh-access-token')) return;
    if (r.status() < 400) R.ok++; else R.ko++;
    R.ultimo = new Date().toISOString() + ' ' + r.status();
    if (r.status() < 400) setTimeout(() => manda().catch(() => {}), 1500);
  };
  globalThis.__axCtx = ctx; ctx.on('response', globalThis.__axResp);
  clearInterval(globalThis.__axSess);
  globalThis.__axSess = setInterval(() => manda().catch(() => {}), 2 * 60 * 1000);
  return (await manda()) ? 'sessione axiom scritta; di nuovo a ogni rinnovo della pagina e ogni 2 minuti' : "nessun cookie d'accesso: fare il login ad Axiom nella scheda";
}
