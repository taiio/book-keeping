# WITHDRAW

                         SYSTEM REQUEST
                                │
                                ▼
                  ┌──────────────────────────┐
                  │ SystemTransactionHandler │
                  └────────────┬─────────────┘
                               │
                               ▼
                         AUTHORIZING
                               │
                     Check Amount + Fee
                               │
                    ┌──────────┴──────────┐
                    │                     │
               INSUFFICIENT           SUFFICIENT
                    │                     │
                    ▼                     ▼
                REJECTED              AUTHORIZED
                    │                     │
                 NO POST                  │
                                          │
                                   Double Entry
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                         Available              Reserved
                          -102                    +102
                                          │
                                          ▼
                                        SENT
                                          │
                                    Double Entry
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                        Submitting                  Sent
                          -102                    +102
                                          │
                                          ▼
                                     CONFIRMING
                                          │
                                    Double Entry
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                           Sent                  Confirming
                          -102                    +102
                                          │
                              ┌───────────┴───────────┐
                              │                       │
                              ▼                       ▼
                         CONFIRMED                  FAILED
                              │                       │
                        Double Entry            Double Entry
                              │                       │
                 ┌────────────┴─────────┐    ┌────────┴─────────┐
                 ▼                      ▼    ▼                  ▼
           Confirming              External  Confirming      Available
              -102                   +100       +100          -100
                                        │       |               |
                                        ▼       ▼               ▼
                                      FEE       FEE (-2 Avail)  FEE (+2 external)
                                        │       
                              ┌─────────┴─────────┐
                              ▼                   ▼
                       Fee Confirming        Fee External
                            -2                   +2