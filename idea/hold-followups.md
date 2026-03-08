# Hold Follow-ups

1. Estendere durante hold il controllo `inbound collector / spray`
- Riutilizzare la stessa logica del pre-buy.
- Attivarlo solo sui recheck creator-risk gia esistenti.
- Obiettivo: uscire se il creator inizia a ricevere molti inbound simili da molte source dopo il buy.

2. Aggiungere un recheck leggero `seed-vs-current-liquidity`
- Riutilizzare il `creatorSeedSol` estratto dalla `create_pool`.
- Durante hold confrontarlo con la liquidity corrente gia letta dal loop di exit.
- Non aggiungere nuove RPC dedicate: usare solo lo stato pool gia disponibile.
- Obiettivo: aumentare il rischio se la pool cresce molto oltre il seed iniziale del creator.
