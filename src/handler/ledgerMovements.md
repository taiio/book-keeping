# COMPLETE ARCHITECTURE

                         ┌─────────────────┐
                         │    BLOCKCHAIN   │
                         └────────┬────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ Blockchain Listener      │
                    │                          │
                    │ Validate                 │
                    │ Detach                   │
                    │ Classify                  │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    BlockchainEventHandler
                                 │
                                 ▼
                     Find Journal by Hash
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
              SYSTEM TX                      NO SYSTEM TX
                 │                               │
                 ▼                               ▼
       Match Transaction                   Valid Deposit
                 │                               │
                 │                               ▼
                 │                       Find Deposit Book
                 │                               │
                 │                     ┌─────────┴─────────┐
                 │                     │                   │
                 │                   FOUND              NOT FOUND
                 │                     │                   │
                 │                     │                   ▼
                 │                     │                  RETURN
                 │                     │                  
                 │                     |
                 │                     |
                 └───────────────┬─────┘
                                 │
                                 ▼
                         LedgerPipeline
                                 │
                                 ▼
                         State Transition
                                 │
                                 ▼
                         Double Entry
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
                BookPosting              BookPosting
                    │                         │
                  AMOUNT                     FEE
                    │                         │
                    ▼                         ▼
                  Book A                    Book B
                    │                         │
                    └────────────┬────────────┘
                                 │
                                 ▼
                           Book History
                                 │
                                 ▼
                         Journal History