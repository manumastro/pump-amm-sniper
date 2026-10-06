// Cosa dice fomo di un token Solana, per il controllo di narrativa: nome, descrizione, social, nascita,
// launchpad, e le tesi scritte dagli utenti fomo. Solo lettura (nessuno swap).
// Uso: FOMO_TOKEN_FILE=~/.config/fomo-mcp/token node scripts/fomo/narrativa_fomo.mjs <mint>
import os from 'os'; import path from 'path'; import { pathToFileURL } from 'url';
const { FomoClient } = await import(pathToFileURL(path.join(os.homedir(), 'fomo-mcp', 'dist', 'client.js')).href);  // URL file:// anche su Windows
const C = new FomoClient('x'), SOLN = 1399811149, mint = process.argv[2];
const prova = async f => { try { return await f(); } catch (e) { return { errore: e.message.slice(0, 100) }; } };
const [f] = (await prova(() => C.filterTokens([mint + ':' + SOLN]))) || [];
const t = f?.token || {};
// fomo a volte risponde senza i social: si riprova e si unisce con la ricerca per nome
const unisci = (a, b) => { for (const k of Object.keys(b || {})) if (!a[k] && b[k]) a[k] = b[k]; return a; };
const social = unisci({}, t.socialLinks);
for (let i = 0; i < 3 && !social.twitter && !social.website; i++) {
  const [g] = (await prova(() => C.filterTokens([mint + ':' + SOLN]))) || []; unisci(social, g?.token?.socialLinks);
  const S = await prova(() => C.searchTokens(t.name || t.symbol || mint)); for (const x of (Array.isArray(S) ? S : [])) if (x.token?.address === mint) unisci(social, x.token.socialLinks);
}
const tesi = await prova(() => C.tokenThesis(mint, SOLN, 20, 0));
const voci = (tesi?.items || []).map(x => ({ utente: x.userHandle, uid: x.userId, twitter: x.twitter, quando: x.createdAt,
  testo: String(x.comment?.comment || '').slice(0, 300), mcap_allora: x.comment?.marketCapAtCreation, posizione_usd: x.authorTrade?.usdValue }));
console.log(JSON.stringify({ mint, nome: t.name, simbolo: t.symbol, descrizione: t.description, social,
  nato: t.createdAt || t.created_at, launchpad: t.launchpad?.launchpadName, mcap: f?.marketCap, liquidita: f?.liquidity, holder: f?.holders ?? t.holdersCount,
  tesi_fomo: voci.length ? voci : (tesi?.errore ? tesi : Object.keys(tesi || {})) }, null, 1));
process.exit(0);
