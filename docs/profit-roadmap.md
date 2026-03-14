# Profit Roadmap

Obiettivo: aumentare il profitto senza distruggere il profilo di rischio del run live.

## 1. Winner Management

Priorita massima.

Motivo:
- i runner grossi arrivano gia dal flow core
- gli audit `winner-management-*` mostrano upside perso materiale
- e il punto con il miglior rapporto tra profitto aggiuntivo e rischio operativo

Piano:
- continuare a raccogliere dati su `winner-management-ambitious`
- continuare a raccogliere dati su `winner-management-aggressive`
- continuare a raccogliere dati su `winner-management-ultra`
- domani scegliere un nuovo profilo live basato sul confronto testa-a-testa sui winner reali

Criterio di promozione:
- delta medio positivo robusto
- pochi o nessun caso peggiorativo
- miglioramento confermato sui winner `18%+`

## 2. Filtri Creator-Risk Da Allentare Selettivamente

Non aprire tutto. Allentare solo i bucket che nello shadow audit stanno mostrando upside netto.

Ordine di priorita:
1. `creator-risk-cashout`
2. `creator-risk-standard-pool-outbound-heavy`
3. `creator-risk-standard-pool-micro-burst` solo con cautela

Da non aprire:
- `creator-risk-burner-profile`
- `post-buy-creator-risk-unique-counterparties` come priorita
- `creator-risk-rapid-dispersal`

Approccio corretto:
- prima fail-open solo in paper path o con soglie meno dure
- poi verificare delta PnL e rug-loss
- solo dopo promuovere nel live path

## 3. Scoring Invece Di Filtri Binari

Medio termine.

Problema attuale:
- molti controlli sono si/no
- i trade buoni e quelli borderline a volte finiscono nello stesso bucket

Direzione:
- assegnare uno score al setup
- usare lo score per modulare:
  - aggressivita del winner management
  - durata hold
  - probation vs hard skip
  - size

Effetto atteso:
- piu profitto dai setup migliori
- meno apertura indiscriminata di casi sporchi

## 4. Size Dinamica

Solo dopo che selezione e exit sono stabili.

Motivo:
- con `TRADE_AMOUNT_SOL=0.01` il profitto assoluto resta limitato
- aumentare size moltiplica sia upside sia errori

Direzione:
- tenere size base per setup normali
- aumentare solo sui setup con score alto
- introdurre cap rigidi su esposizione simultanea e drawdown

## 5. Audit Continuo

Lo shadow audit non deve restare un esercizio manuale.

Da rendere standard:
- delta PnL dei winner audit
- delta PnL dei bucket creator-risk piu rilevanti
- confronto live vs profili shadow su sample comuni

Obiettivo:
- fare tuning dai dati
- evitare modifiche guidate da singoli esempi o impressioni

## Sequenza Consigliata

1. finire la raccolta dati stanotte su `ambitious`, `aggressive`, `ultra`
2. promuovere un nuovo winner management live
3. allentare `creator-risk-cashout`
4. valutare `outbound-heavy`
5. lasciare `micro-burst` per ultimo
6. solo dopo valutare size piu alta o size dinamica
