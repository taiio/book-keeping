# DEPOSIT
```
                         BLOCKCHAIN EVENT
                                │
                                ▼
                  ┌──────────────────────────┐
                  │ Blockchain Listener      │
                  │                          │
                  │ Validate / Detach        │
                  │ Identify System Deposit  │
                  └────────────┬─────────────┘
                               │
                               ▼
                    BlockchainEventPayload
                               │
                               ▼
                  ┌──────────────────────────┐
                  │ BlockchainEventHandler   │
                  └────────────┬─────────────┘
                               │
                               ▼
                    Find Journal by Hash
                               │
                    ┌──────────┴──────────┐
                    │                     │
                  FOUND                NOT FOUND
                    │                     │
                    ▼                     ▼
             System Transaction        DEPOSIT
                    │                     │
                    │                     ▼
                    │           Find / Create Deposit Book
                    │                     │
                    │                     ▼
                    │              Open Journal
                    │                     │
                    │                     ▼
                    │                CONFIRMING
                    │                     │
                    │              Double Entry
                    │                     │
                    │          ┌──────────┴──────────┐
                    │          │                     │
                    │          ▼                     ▼
                    │     External Book         Confirming Book
                    │        -1000                  +1000
                    │
                    │                     │
                    │                     ▼
                    │                 CONFIRMED
                    │                     │
                    │              Double Entry
                    │                     │
                    │          ┌──────────┴──────────┐
                    │          │                     │
                    │          ▼                     ▼
                    │     Confirming Book         Confirmed Book
                    │        -1000                  +1000
                    │
                    │
                    │
                    └──────────────┐
                                   ▼
                         Existing Transaction
                                   │
                                   ▼
                          State Transition
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
               CONFIRMING      CONFIRMED       FAILED
                    │              │              │
                    ▼              ▼              ▼
               Double Entry    Double Entry    Double Entry
```


# DEPOSIT — FAILED

              CONFIRMING
                   │
                   │
                   ▼
                 FAILED
                   │
            Double Entry
                   │
          ┌────────┴────────┐
          ▼                 ▼
    Confrming Book       External Book
       -1000              +1000
                   │
                   │
                   ▼
Update Journal Transaction to CANCELED_OR_REJECTED.



# BLOCKCHAIN WITHDRAW EVENT

                         BLOCKCHAIN EVENT
                                │
                                ▼
                  ┌──────────────────────────┐
                  │ Blockchain Listener      │
                  │                          │
                  │ Validate / Detach        │
                  └────────────┬─────────────┘
                               │
                               ▼
                  BlockchainEventHandler
                               │
                               ▼
                    Find Journal by Hash
                               │
                               ▼
                         FOUND SYSTEM TX
                               │
                               ▼
                       Match Sender / TX
                               │
                               ▼
                      State Transition
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
         CONFIRMING         CONFIRMED         FAILED
              │                │                │
              ▼                ▼                ▼
        Double Entry      Double Entry      Double Entry