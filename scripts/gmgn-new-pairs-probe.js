const { chromium } = require('playwright');
const fs = require('fs');
// Probe del feed nuove pair di gmgn.ai.
// Serve un browser headless: device_id/tab_id/client_id sono generati dal client JS,
// con curl l'endpoint non risponde. Uso: OUT=logs/x.json node scripts/gmgn-new-pairs-probe.js
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
  const page = await ctx.newPage();
  let payload = null;
  page.on('response', async r => {
    if (/\/api\/v1\/pairs\/sol\/new_pairs\//.test(r.url()) && !payload) {
      try { payload = await r.json(); } catch(e){}
    }
  });
  await page.goto('https://gmgn.ai/new-pair?chain=sol', { waitUntil:'domcontentloaded', timeout:45000 }).catch(()=>{});
  await page.waitForTimeout(12000);
  if (!payload) { console.log('nessun payload'); await b.close(); return; }
  fs.writeFileSync((process.env.OUT || 'logs/gmgn-new-pairs.json'), JSON.stringify(payload));
  const pairs = payload.data.pairs || [];
  console.log('pairs ricevute:', pairs.length);
  console.log('campi disponibili:', Object.keys(pairs[0]).join(', '));
  await b.close();
})();
