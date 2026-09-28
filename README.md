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

## History Tracking

Two history tables record the flow. Both are written **inside the same DB transaction** as the change they
describe, and only through `LedgerPipeline` → repositories.

```text
JournalTransaction ──► journal_transaction_history      (history of STATE)
        │
        ▼
   BookPosting ──► Book ──► book_history                (history of BALANCE)
```

| Event                                          | Table                         | `history_transaction_type`    |
| ---------------------------------------------- | ----------------------------- | ----------------------------- |
| Journal created (`openJournal`)                | `journal_transaction_history` | `CREATED`                     |
| Journal state changed (`transition`)           | `journal_transaction_history` | `STATE_ADVANCED`              |
| Out-of-sequence transition (journal cancelled) | `journal_transaction_history` | `REJECTED_INVALID_TRANSITION` |
| Book created (`getOrCreateBook`)               | `book_history`                | `CREATED` (amount = 0)        |
| Posting applied to a book                      | `book_history`                | `POSTING_APPLIED`             |

Rules:

- `journal_transaction_history` stores a **snapshot** of the journal after the event (state, detailed state, hash).
- `book_history` stores the book balance **after** the event and links to `book_posting_id`.
- Duplicate requests / events (same idempotency token, or a replayed transition) write **no** posting and **no** history.
- A posting without a `book_history` row, or a state change without a `journal_transaction_history` row, must never exist.

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
├── constants/              # Single source of truth for every state / type / purpose
│
├── di/
│   └── container.ts
│
├── handler/                # Pure classes only — no exported functions / constants
│   ├── LedgerPipeline.ts             # The only place that touches journal, postings, books and both history tables
│   ├── SystemTransactionHandler.ts
│   └── BlockchainEventHandler.ts
│
├── helpers/                # Pure, stateless functions shared by handlers
│   ├── accounting.ts                 # getAccountingLegs, collectDebitAndFeeMovements
│   ├── book.ts                       # custodyBookParams, externalBookParams
│   ├── entity.ts                     # mapDbStateToEntityState, toTransactionEntity, toDepositEntity
│   ├── blockchainSubmitter.ts        # NOT_WIRED_SUBMITTER (null-object for IBlockchainSubmitter)
│   ├── correlation.ts                # source-content parsing / sender matching
│   ├── idempotency.ts                # idempotency keys
│   └── quantity.ts                   # quantity math
│
├── interfaces/             # ALL interfaces and types, grouped by concern
│   ├── transaction.ts                # AccountItem / FeeItem, Withdraw / Stake / Unstake / Restake, entities, state types
│   ├── blockchain.ts                 # blockchain payload, IBlockchainSubmitter, deposit matching
│   ├── persistence.ts                # IUnitOfWork, Book / BookPosting / BookHistory / Journal* params and results
│   └── ledger.ts                     # LedgerPipeline params, movements, transitions
│
├── models/
│
├── repositories/
│   ├── Book.ts
│   ├── BookHistory.ts                # only writer of book_history
│   ├── BookPosting.ts
│   ├── JournalTransaction.ts
│   └── JournalTransactionHistory.ts  # only writer of journal_transaction_history
│
└── test/                   # node:test, in-memory ledger (see `npm test`)
```

Conventions:

- Interfaces and types live in `interfaces/` only. Types that mirror a constant are **derived** from it
  (`typeof TRANSACTION_STATE`, `typeof TRANSACTION_TYPE`, ...) — never re-declared by hand.
- States, sequences and lookup tables are defined once in `constants/`.
- Files in `handler/` contain a single class each. Functions shared by handlers (or needed by only one of them
  but not tied to its state) live in `helpers/`.
- Every `AccountItem` / `FeeItem` carries its own `assetTicker`; books are created from it directly (no ticker lookup / placeholder).

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
│ AUTHORIZED  → SENT               │
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
