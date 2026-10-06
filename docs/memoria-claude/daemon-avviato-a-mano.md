---
name: daemon-avviato-a-mano
description: Un controllo di sintassi con `node -e require(...)` su uno script che e' un daemon lo avvia davvero e sopravvive a ogni reset
metadata:
  type: feedback
---

Il 2026-09-13 ho "verificato la sintassi" di `scripts/paper-report-daemon.js` con
`node -e "require('...')" & sleep 1; kill %1`. Il `kill` non ha avuto effetto e il daemon e' rimasto
vivo sull'host per 20 minuti, riscrivendo `logs/paper-report.json` col proprio stato in memoria dopo
ogni `./scripts/bot reset`. Ho cercato la causa in tre posti sbagliati prima di guardare `ps`.

**Why:** `require()` non e' un parser: esegue il modulo, e quel modulo apre un `setInterval` che
tiene vivo il processo. Su uno script che e' un servizio, "controllare la sintassi" cosi' significa
avviare un secondo servizio in concorrenza con quello in container, sullo stesso file di output.

**How to apply:** per la sintassi usare `node --check file.js`, che non esegue niente. Se un dato
ricompare dopo un reset e i log sono puliti, il primo controllo e' `ps aux | grep <daemon>`: deve
esserci solo il processo dentro il container. Vedi `docs/controls.md` sezione 46.
