# Bookkeeping Service

## Architecture Overview

```text
                         ┌──────────────────────┐
                         │   System Request     │
                         └──────────┬───────────┘
                                    │
                                    ▼
                     ┌───────────────────────────┐
                     │ systemTransactionHandler  │
                     └─────────────┬─────────────┘
                                   │
                     WITHDRAW / STAKE / UNSTAKE
                              / RESTAKE
                                   │
                                   ▼
                    AUTHORIZING → AUTHORIZED
                                   │
                                   ▼
                              SUBMITTING
                                   │
                                   ▼
                                  SENT
                                   │
                                   │
                         Blockchain Transaction
                                   │
                                   ▼
                     ┌───────────────────────────┐
                     │ blockchainEventHandler    │
                     └─────────────┬─────────────┘
                                   │
                         classify / correlate
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
          Existing System Tx              No System Tx
                    │                             │
                    │                             ▼
                    │                          DEPOSIT
                    │                             │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                              CONFIRMING
                              /        \
                             /          \
                            ▼            ▼
                       CONFIRMED       FAILED
```

---

## Accounting Architecture

Both handlers use the same accounting pipeline.

```text
                    Transaction
                         │
                         ▼
                JournalTransaction
                         │
                         ▼
                   BookPosting
                         │
                         ▼
                       Book
                         │
                         ▼
                   BookHistory


                JournalTransaction
                         │
                         ▼
              JournalTransactionHistory
```

No handler should bypass `JournalTransaction` to directly update `Book`.

---

## Books

Only two books are currently used:

```text
┌──────────────────────────────┐
│ CUSTODY_ASSET_ACCOUNT        │
│ Client custody assets        │
└──────────────────────────────┘

┌──────────────────────────────┐
│ BLOCKCHIAN_EXTERNAL_ACCOUNT  │
│ External blockchain assets   │
└──────────────────────────────┘
```

---

## Repository Structure

```text
.
├── common/
│   ├── errors.ts
│   └── UnitOfWork.ts
│
├── config/
│   ├── database.ts
│   └── env.ts
│
├── constants/
│
├── di/
│   └── container.ts
│
├── handler/
│   ├── systemTransactionHandler.ts
│   └── blockchainEventHandler.ts
│
├── interfaces/
│
├── models/
│   ├── JournalTransaction.ts
│   ├── JournalTransactionHistory.ts
│   ├── BookPosting.ts
│   ├── Book.ts
│   ├── BookHistory.ts
│   └── ...
│
├── repositories/
│
└── test/
```

---

## Handler Responsibility

```text
┌──────────────────────────────────┐
│ systemTransactionHandler         │
├──────────────────────────────────┤
│ System initiated transactions    │
│                                  │
│ WITHDRAW                         │
│ STAKE                            │
│ UNSTAKE                          │
│ RESTAKE                          │
│                                  │
│ AUTHORIZING → AUTHORIZED         │
│ AUTHORIZED  → SUBMITTING         │
│ SUBMITTING  → SENT               │
└──────────────────────────────────┘


┌──────────────────────────────────┐
│ blockchainEventHandler           │
├──────────────────────────────────┤
│ Blockchain transactions           │
│                                  │
│ Correlation                      │
│ Classification                   │
│ State transition                 │
│ Accounting                       │
│ History                          │
│                                  │
│ SENT → CONFIRMING                │
│ CONFIRMING → CONFIRMED / FAILED │
│                                  │
│ Also creates DEPOSIT transactions│
│ when no system transaction exists│
└──────────────────────────────────┘
```

---

## Transaction Lifecycle

```text
System side:

AUTHORIZING
     │
     ▼
AUTHORIZED
     │
     ▼
SUBMITTING
     │
     ▼
SENT
```

```text
Blockchain side:

SENT
 │
 ▼
CONFIRMING
 ├──────────────► CONFIRMED
 │
 └──────────────► FAILED
```

Rejection can happen during the system lifecycle:

```text
AUTHORIZING ──► REJECTED
AUTHORIZED  ──► REJECTED
SUBMITTING  ──► REJECTED
SENT        ──► REJECTED
```

---

## Blockchain Event Classification

The blockchain event pipeline has already filtered blockchain data.

Therefore, `blockchainEventHandler` receives a valid blockchain transaction
event.

Its responsibility is to classify and process it:

```text
             Blockchain Transaction
                       │
                       ▼
                Correlate / Classify
                       │
              ┌────────┴────────┐
              │                 │
              ▼                 ▼
      Existing System Tx    No System Tx
              │                 │
              ▼                 ▼
      WITHDRAW / STAKE      DEPOSIT
      UNSTAKE / RESTAKE
```

---

## Concurrency

Bookkeeping balance updates use pessimistic locking:

```text
BEGIN
  │
  ├── Lock JournalTransaction
  │
  ├── Lock relevant Book rows
  │
  ├── Validate state / balance
  │
  ├── Create BookPosting
  │
  ├── Update Book
  │
  ├── Create History
  │
COMMIT
```

All related accounting changes must be atomic.

---

## Design Principle

Keep the architecture:

```text
              Handlers
                  │
                  ▼
        Generic Transaction Flow
                  │
                  ▼
          JournalTransaction
                  │
                  ▼
             BookPosting
                  │
                  ▼
                Book
                  │
                  ▼
               History
```

Reuse the same flow across transaction types.

Only specialize business rules that are genuinely different.

Avoid unnecessary abstractions, duplicated handlers, and additional books.
