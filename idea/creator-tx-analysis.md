# Creator TX Analysis

Data di riferimento: 2026-03-08

Obiettivo: analizzare solo le transazioni recenti dei creator associati agli eventi paper trade finiti con `-100%` per cercare pattern anomali utili come filtro anti-rug.

## Rug events analizzati

1. `evt-000044`
   Token: `EzAchBqjVf5oQrEkVvNwHJNBwZHzQBqEzpL458hLKxWn`
   Creator: `AwtPoZLvMvV6ZxPxLoYFWUJVWy63MqZD1RFhjWecnh7k`

2. `evt-000048`
   Token: `HiSaGY4oqi3bN5vCS4zGF9Z4n1r5kgm9YNkraEUVXGgM`
   Creator: `4ZRrkpVA9iJoGGTB4aUsH9igFUgmY948m59AzaRMSxRu`

3. `evt-000060`
   Token: `5AsZjbXwG1d98w2WWYLxFWhgA3GQ5gxhGEnwg71Y1uJc`
   Creator: `7Ws71LC6s1YadgAzmdVNXg8tXdc1H2spbGMVdcFoKbPE`

4. `evt-000081`
   Token: `4pExfgrGDi9softpwRzLagRASMhmo6osBbq1tjbEZ1Nj`
   Creator: `CSi3oJDtBbojb8xG2ptm9c4q1LcYNwEEGnATRQgKcM8A`

5. `evt-000098`
   Token: `GKtiFn1QTcY8dGiWDjd8qfqq8RWSj78CBBtkKadm4FCs`
   Creator: `J8ktgC6TQyHbESq9zhKy9WCiJZEDE28TEe35YXnFGE7b`

## Metodo

- Campione: fino a 25 signature recenti per creator
- Parsing: fino a 15 parsed transaction per creator
- Metriche osservate:
  - numero trasferimenti SOL in ingresso
  - numero trasferimenti SOL in uscita
  - volume SOL in ingresso
  - volume SOL in uscita
  - controparti uniche
  - link diretti verso altri creator del gruppo
  - finestra temporale delle tx osservate

## Risultati

### 1. `AwtPoZLvMvV6ZxPxLoYFWUJVWy63MqZD1RFhjWecnh7k`

- `solInTransfers`: 67
- `solOutTransfers`: 21
- `solInSOL`: 0.136632
- `solOutSOL`: 801.791223
- `uniqueCounterparties`: 88
- `linksToOtherCreators`: `4ZRrkpVA9iJoGGTB4aUsH9igFUgmY948m59AzaRMSxRu`
- finestra osservata: ~35 secondi

Lettura:
- numero altissimo di controparti uniche in poco tempo
- forte attività di uscita SOL
- collegamento diretto con un altro creator rug

### 2. `4ZRrkpVA9iJoGGTB4aUsH9igFUgmY948m59AzaRMSxRu`

- `solInTransfers`: 55
- `solOutTransfers`: 21
- `solInSOL`: 0.323338
- `solOutSOL`: 801.831312
- `uniqueCounterparties`: 76
- `linksToOtherCreators`: nessuno diretto nel campione
- finestra osservata: ~99 secondi

Lettura:
- pattern molto simile al wallet sopra
- alto numero di controparti e movimenti ravvicinati
- comportamento da wallet operativo, non retail

### 3. `7Ws71LC6s1YadgAzmdVNXg8tXdc1H2spbGMVdcFoKbPE`

- `solInTransfers`: 52
- `solOutTransfers`: 1
- `solInSOL`: 0.617005
- `solOutSOL`: 879.810925
- `uniqueCounterparties`: 53
- `linksToOtherCreators`: nessuno diretto nel campione
- finestra osservata: ~18 secondi

Lettura:
- moltissime controparti in una finestra estremamente breve
- volume SOL in uscita enorme rispetto all'ingresso
- altro wallet fortemente sospetto

### 4. `CSi3oJDtBbojb8xG2ptm9c4q1LcYNwEEGnATRQgKcM8A`

- `solInTransfers`: 0
- `solOutTransfers`: 2
- `solInSOL`: 0
- `solOutSOL`: 575.460347
- `uniqueCounterparties`: 2
- `linksToOtherCreators`: nessuno
- finestra osservata: ~26 secondi

Lettura:
- wallet molto più semplice
- quasi solo uscite
- pattern compatibile con wallet burner o wallet dedicato a una singola operazione

### 5. `J8ktgC6TQyHbESq9zhKy9WCiJZEDE28TEe35YXnFGE7b`

- `solInTransfers`: 0
- `solOutTransfers`: 1
- `solInSOL`: 0
- `solOutSOL`: 469.87001
- `uniqueCounterparties`: 1
- `linksToOtherCreators`: nessuno
- finestra osservata: ~30 secondi

Lettura:
- ancora più estremo del caso 4
- wallet quasi one-shot
- molto sospetto come wallet usa-e-getta

## Segnali strani comuni

### A. Troppe controparti in poco tempo

`88`, `76`, `53` controparti uniche in finestre di pochi secondi o pochi minuti sono valori anomali per creator retail normali.

Interpretazione:
- wallet orchestrati
- cluster bot/sybil
- attività di funding/distribuzione coordinata

### B. Forte compressione temporale

Le tx osservate sono molto ravvicinate.

Interpretazione:
- operazioni preparate e lanciate in blocco
- non comportamento organico

### C. SOL out enorme

I creator analizzati mostrano uscite SOL molto elevate.

Interpretazione:
- drenaggio / redistribuzione verso altri wallet
- uscita rapida di fondi dal wallet creator

### D. Link tra creator

È stato osservato un collegamento diretto:

- `AwtPoZLvMvV6ZxPxLoYFWUJVWy63MqZD1RFhjWecnh7k`
  ->
- `4ZRrkpVA9iJoGGTB4aUsH9igFUgmY948m59AzaRMSxRu`

Interpretazione:
- almeno parte del cluster non è indipendente

### E. Wallet burner / one-shot

Alcuni creator hanno pochissime controparti e solo uscite SOL.

Interpretazione:
- wallet creati per operazioni isolate
- possibile tentativo di separare il rischio reputazionale tra deploy diversi

## Conclusione

Questi creator non hanno pattern da utenti normali.

I casi 1, 2 e 3 sono i più fortemente sospetti come cluster coordinato.
I casi 4 e 5 sembrano burner wallet dedicati a singole operazioni.

Nel complesso, il pattern osservato è coerente con:

- creator collegati da funding chain
- wallet ad alta automazione
- distribuzione o movimentazione fondi non organica
- forte probabilità di operatività opportunistica / rug-prone

## Come usare questa analisi nel bot

### Filtro 1: creator counterparty count

Idea:
- guarda le ultime N tx del creator
- conta le controparti uniche

Regola iniziale:
- skip se `uniqueCounterparties >= 25` nelle ultime `15-25` tx

Motivo:
- creator normali appena nati raramente toccano così tanti wallet subito

### Filtro 2: creator-to-creator funding link

Idea:
- se un creator è finanziato da un wallet già visto in rug o da un altro creator rug, skip

Regola iniziale:
- blacklist di `creator` e `funder`
- skip immediato se match

Motivo:
- è il segnale più forte e più difendibile

### Filtro 3: compressed activity window

Idea:
- misura la differenza temporale tra la tx più recente e quella meno recente del campione

Regola iniziale:
- se il creator ha `> 20` controparti in `< 120s`, skip

Motivo:
- riduce i wallet orchestrati senza colpire troppo i creator normali

### Filtro 4: burner profile

Idea:
- wallet con pochissime controparti ma uscite SOL molto alte e quasi nessun ingresso

Regola iniziale:
- se `solInTransfers == 0`
- e `solOutTransfers <= 3`
- e `solOutSOL > X`
- allora aumenta risk score o skip

Motivo:
- identifica wallet monouso

### Filtro 5: risk score combinato

Più robusto di un singolo gate.

Esempio:
- +40 punti se funder è in blacklist
- +25 punti se controparti uniche > 25
- +20 punti se attività compressa < 120s con molte tx
- +20 punti se profilo burner
- +15 punti se nome token ricorrente già visto in rug

Soglia:
- `score >= 50 => SKIP`

## Implementazione consigliata

Ordine di priorità:

1. `creator/funder blacklist`
2. `unique counterparties`
3. `compressed activity window`
4. `burner profile`

Questo approccio evita molti rug quasi certi senza dipendere da euristiche deboli come il solo nome del token.
