# fomo.family: le classifiche il giorno dopo

**4 ottobre 2026, 07:31 UTC.** Seconda lettura delle classifiche, 10,6 ore dopo quella del 3
ottobre (`2026-10-03-fomo-top150.md`), con la pipeline `scripts/fomo/`. Report completo in
`dati/fomo/risultati/classifiche-2026-10-04T0731.md` (fuori da git).

## 1. Le classifiche di oggi, come se si chiudesse adesso

                                   24 ore              7 giorni            30 giorni
    PnL di classifica              +$20,7M             +$26,3M             +$71,1M
    gia' incassato                 4-7%                22-35%              21-57%
    posizioni aperte               $109,8M             $62,7M              $79,0M
    perso vendendole               30-55%              27-47%              30-48%
    PnL se vendessero adesso       −$39M … −$12M       −$3,1M … +$9,3M     +$33M … +$47M

Resa dei 150 a 30 giorni sul capitale investito nel mese, aperte vendute al prezzo ottenibile:
+4% … +7% (ieri +2% … +5%); Solana +14% … +18%, Robinhood −11% … −9%, Ethereum/Base/BSC +7% … +13%.
Robinhood e' negativa in entrambe le letture.

## 2. I 150 di ieri, misurati oggi

"Liquidabile" = contante stabile + posizioni vendute al prezzo ottenibile (tutti i pool), al netto
di depositi e prelievi in contante (USDC e SOL su Solana).

    classifica di ieri   ancora dentro   PnL da sempre (fomo)   liquidabile   positivi (liquidabile)
    24 ore               90 su 149       +$6,3M                 +$2,5M        100 su 149
    7 giorni             118 su 150      +$4,2M                 +$1,3M         84 su 150
    30 giorni            123 su 150      +$1,7M                 +$1,2M         86 su 150

Notte favorevole ai prezzi; il valore incassabile segue meno della meta' del guadagno mostrato da
fomo per la 24 ore e la 7 giorni. Dieci ore non bastano per parlare di bravura: da ripetere.

## 3. Controprove

- Saldi letti subito dopo lo scarico: la posizione maggiore di 245 utenti su 248 coincide con il
  wallet vero entro l'1% ($102M; Solana 122/125, Robinhood 67/67, Ethereum 42/42, Base 7/7, BSC 7/7).
- Coerenza interna: la variazione del patrimonio a prezzo di mercato (+$4,3M, +$2,4M, +$2,2M) e'
  dello stesso ordine di quella del PnL fomo.

## 4. Trappole incontrate

- Nei trasferimenti fomo il prelievo e' `WITHDRAWAL`; i "depositi" su Robinhood sono quasi tutti
  airdrop di spam valutati da fomo a prezzi assurdi ($31,5M in 10 ore per i 150 a 30 giorni). Come
  flussi si contano solo USDC e SOL su Solana.
- Il profilo di un utente si sovrascrive a ogni scarico: il confronto fra letture usa le fotografie
  in `dati/fomo/istantanee/`.
