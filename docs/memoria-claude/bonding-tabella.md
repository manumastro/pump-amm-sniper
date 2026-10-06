---
name: bonding-tabella
description: "Scope attuale (dal 2026-10-04): analisi dei token in bonding su fomo, sempre nella stessa tabella; pagina locale bonding_live.mjs"
metadata:
  node_type: memory
  type: feedback
  originSessionId: aaec7737-03b5-47cc-aed9-8e1cbfc18d41
  modified: 2026-10-04T17:32:01.780Z
---

Dal 2026-10-04 lo scope della persona e' **l'analisi dei token in bonding su fomo** (scripts/fomo/bonding_ora.mjs): token nati da <= 48h con almeno 5 holder fomo (nessun massimo), qualunque % di curva, dalle liste filtered-bonding, bonding e new (senza 'new' le gemme nate e graduate in 20 minuti, es. Agent Capital, non si vedevano). La cosa piu' importante per la persona: scovare presto queste gemme. L'output va dato **sempre nella stessa forma**: tabella markdown con colonne curva | token (link fomo) | app (sì/no) | età | mcap | holder fomo | +5 min | valore fomo | ≤30% | bravi | tesi, **in ordine di ritmo** (holder fomo entrati negli ultimi 5 min; dal 4/10 sera la persona non vuole piu' in cima i token con la curva piu' alta, `--curva` per il vecchio ordine), poi poche righe caso per caso sui token notevoli.

In diretta: `bonding_live.mjs` (pagina http://127.0.0.1:8787, bonding_live.html; un processo, un Chrome, giro ogni 5-8 s, max 4 chiamate insieme o arrivano i 429; stato in dati/fomo/tesi/live/stato.json); quando la persona chiede la situazione: `python3 scripts/fomo/bonding_tabella.py` (stessa tabella con Δ holder).

**Prop firm (5/10):** la persona trada su una prop firm dove "Only pump/bonk/bags/brrr tokens are tradeable": si mostrano per default solo i mint che finiscono in pump/bonk/BAGS/brrr (campo `prop` = si), piu' i token sul programma pump.fun con mint senza 'pump' segnati `pump?` (da verificare con la prop firm); `--tutti` per vedere anche gli altri.

**Prima analisi (5/10, 347 segnali):** con candele da 1 minuto l'esito di "entra al primo giro con >=5 holder fomo" va da +$3.5k a -$3.4k su 338 giri da $100 a seconda del prezzo preso dentro il minuto del segnale: il vantaggio non e' dimostrato, serve il prezzo esatto dalle transazioni on-chain.

**Potenziali runner (5/10):** la persona vuole in cima l'incrocio dei segnali (token giovani che crescono in holder fomo, tesi, bravi, soldi entrati): sezione della pagina e righe "potenziali runner" sopra la tabella di bonding_tabella.py.

**Axiom (6/10):** la persona ha fatto il login ad Axiom nel browser Playwright; `avvia_axiom.js` (browser_run_code_unsafe) porta callout Axiom e post X sul contratto nella pagina live (segnali 'tesi' e 'x'). Va rilanciato con avvia_token.js a ogni nuova sessione. GMGN: niente tesi, X/TG tracker solo con login (non fatto).

**Why:** la persona l'ha detto esplicitamente ("l'output deve essere sempre cosi', lo scope ora è questo").
**How to apply:** non cambiare colonne/ordine; studio su X sospeso finche' non lo richiede. Vedi [[fomo-family]], [[coda-non-media]].
