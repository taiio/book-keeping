# blockchainEventHandler Design

## 1. Purpose

`blockchainEventHandler` is the generic entry point for blockchain-originated events.

It handles **all transaction types**, not only withdrawal confirmations.

Current supported types include:

```text
WITHDRAW
STAKE
UNSTAKE
RESTAKE
DEPOSIT
```

Future transaction types should reuse the same generic event-processing flow whenever possible.

Do NOT create separate top-level methods such as:

```text
handleWithdrawConfirmation()
handleStakeConfirmation()
handleUnstakeConfirmation()
handleRestakeConfirmation()
handleDepositConfirmation()
```

The handler must be generic.

---

## 2. Responsibility

The handler converts a blockchain fact/event into an internal transaction state change and, when required, an accounting change.

High-level flow:

```text
Blockchain Event
       ↓
Validate Event
       ↓
Correlate Existing Transaction
       ↓
If not found → Detect Valid Deposit
       ↓
Idempotency Check
       ↓
Lock Transaction + Relevant Books
       ↓
Validate State Transition
       ↓
Resolve AccountItem(s)
       ↓
Resolve FeeItem(s)
       ↓
Apply Accounting
       ↓
Update Transaction State
       ↓
Write Histories
       ↓
COMMIT
```

---

## 3. System Transaction Correlation

System-originated blockchain transactions are correlated using:

```text
sender(s)
+
transaction hash
```

The incoming blockchain event must match the expected sender information and exact transaction hash stored for the internal system transaction.

Do not identify a system transaction using only transaction hash if sender validation is required by the existing domain.

Conceptually:

```text
Blockchain Event
      │
      ├── txHash
      └── sender(s)
             │
             ▼
       Existing Transaction
```

If the combination does not match an existing system transaction, do not automatically treat the event as a system transaction.

---

## 4. Transaction Classification

`blockchainEventHandler` receives blockchain events that have already been
filtered upstream.

Therefore, every incoming event is already known to represent a valid
blockchain transaction.

The responsibility of `blockchainEventHandler` is **not to detect whether
the event is a transaction**.

Its responsibility is to:

1. Correlate the blockchain transaction with an existing system transaction.
2. Classify the transaction.
3. Process the transaction according to its type and current state.

Flow:

```text
Blockchain Transaction Event
       ↓
Classify / Correlate Transaction
       │
       ├── Matches existing system transaction
       │       ↓
       │   Process existing transaction
       │
       └── No matching system transaction
               ↓
          Process as blockchain-originated transaction
               │
               └── DEPOSIT
```

### Existing System Transaction

For system-originated transactions, correlate the blockchain event using:

```text
sender(s) + transaction hash
```

If the sender(s) and transaction hash match an existing internal transaction,
process that transaction according to its current lifecycle.

Supported system-originated transaction types include:

```text
WITHDRAW
STAKE
UNSTAKE
RESTAKE
```

Example:

```text
Blockchain Event
      ↓
sender(s) + txHash
      ↓
Existing JournalTransaction
      ↓
Process current lifecycle
```

The handler must validate the current transaction state before applying the
next state transition.

For example:

```text
SENT
  ↓
CONFIRMING
  ↓
CONFIRMED
```

or:

```text
CONFIRMING
  ↓
FAILED
```

### No Matching System Transaction

If the blockchain transaction does not match an existing system transaction,
it should be classified as a blockchain-originated transaction.

Currently, the supported blockchain-originated transaction type is:

```text
DEPOSIT
```

The handler should then:

```text
Blockchain Transaction
       ↓
No matching system transaction
       ↓
Classify as DEPOSIT
       ↓
Create internal JournalTransaction
       ↓
Process deposit lifecycle
       ↓
Apply accounting
```

For a deposit, the transaction is created internally because the transaction
originated from the blockchain rather than from an internal system request.

### Important Boundary

The upstream blockchain event pipeline has already filtered blockchain data
and only sends valid transaction events to this handler.

Therefore, this handler must NOT:

- re-detect whether the blockchain data is a transaction;
- perform generic transaction discovery;
- ignore the event simply because there is no existing system transaction;
- create accounting before classifying the transaction.

Instead, the handler must classify every received blockchain transaction
into a supported transaction flow.

Conceptually:

```text
Blockchain Listener / Event Filter
              ↓
      Valid Blockchain Tx
              ↓
   blockchainEventHandler
              ↓
      Correlation / Classification
          /                 \
         /                   \
Existing System Tx       Blockchain-Originated Tx
      ↓                         ↓
WITHDRAW / STAKE / ...       DEPOSIT
      ↓                         ↓
Continue Lifecycle          Create Internal Tx
```

The main responsibility of `blockchainEventHandler` is therefore:

```text
Correlation
    ↓
Classification
    ↓
Transaction Processing
    ↓
State Transition
    ↓
Accounting
    ↓
History
```

Do not add another transaction-detection layer inside
`blockchainEventHandler`.

---

## 5. Lifecycle

System-originated transactions follow:

```text
AUTHORIZING
    ↓
AUTHORIZED
    ↓
SENT
    ↓
CONFIRMING
    ↓
CONFIRMED
```

Blockchain failure:

```text
CONFIRMING
    ↓
FAILED
```

System/business rejection is separate:

```text
AUTHORIZING → REJECTED
AUTHORIZED  → REJECTED
SENT        → REJECTED
```

The important distinction is:

```text
REJECTED
```

means the transaction was actively rejected by system/business/provider processing.

```text
FAILED
```

means blockchain execution failed.

Do not collapse the two states.

---

## 6. SENT → CONFIRMING

When a blockchain event indicates that a submitted system transaction has reached the blockchain processing stage:

```text
SENT
    ↓
CONFIRMING
```

Before changing the state:

1. Lock the transaction.
2. Read the current state.
3. Validate that `SENT → CONFIRMING` is allowed.
4. Apply the transition.
5. Write `JournalTransactionHistory`.
6. Commit.

Do not process the same transition multiple times.

---

## 7. CONFIRMING → CONFIRMED

When the blockchain confirms successful execution:

```text
CONFIRMING
    ↓
CONFIRMED
```

Apply the required final accounting atomically.

For a withdrawal:

```text
CUSTODY_ASSET_ACCOUNT
    - amount

BLOCKCHIAN_EXTERNAL_ACCOUNT
    + amount
```

For a deposit:

```text
BLOCKCHIAN_EXTERNAL_ACCOUNT
    - amount

CUSTODY_ASSET_ACCOUNT
    + amount
```

For:

```text
STAKE
UNSTAKE
RESTAKE
```

use the transaction's existing accounting semantics while reusing the same accounting pipeline.

---

## 8. CONFIRMING → FAILED

If the blockchain reports that the transaction failed:

```text
CONFIRMING
    ↓
FAILED
```

The handler must apply the required failure/reversal behavior atomically.

For example, if the system previously reserved/locked an amount:

```text
reserved/locked amount
        ↓
blockchain FAILED
        ↓
release/revert according to existing bookkeeping rules
```

Do not create a new book to represent failure.

Use the existing books and existing posting/history mechanism.

---

## 9. Current Books

Only these books exist:

```text
CUSTODY_ASSET_ACCOUNT
BLOCKCHIAN_EXTERNAL_ACCOUNT
```

Do not introduce:

```text
FEE_BOOK
REVENUE_BOOK
SETTLEMENT_BOOK
RESERVE_BOOK
STAKING_BOOK
```

unless explicitly required later.

---

## 10. AccountItem and FeeItem

Both `AccountItem` and `FeeItem` are accounting items.

They must be resolved/created as required by the transaction.

Each item has its own asset identity:

```text
clientId
accountId
assetId
assetTypeId
assetTicker
walletTypeId
```

Do not assume:

```text
fee asset == transaction asset
```

Example:

```text
Withdrawal:
    100 USDT

Fee:
    0.001 ETH
```

The USDT and ETH accounting effects must be handled independently.

---

## 11. Accounting Backbone

Every accounting effect follows:

```text
JournalTransaction
    ↓
BookPosting
    ↓
Book
    ↓
BookHistory
```

Transaction audit history:

```text
JournalTransaction
    ↓
JournalTransactionHistory
```

Do not bypass this chain.

Do not directly update `Book` without the corresponding `BookPosting` and required history.

---

## 12. Generic Event Processing

The handler should follow this generic process:

```text
1. Validate blockchain event
2. Correlate existing transaction
3. If no existing transaction, check for valid deposit
4. Resolve/create JournalTransaction
5. Check idempotency
6. Lock JournalTransaction
7. Lock relevant Book rows
8. Validate current state
9. Resolve AccountItem(s)
10. Resolve FeeItem(s)
11. Determine next state
12. Apply required BookPosting(s)
13. Update Book balances
14. Create BookHistory
15. Update JournalTransaction
16. Create JournalTransactionHistory
17. Commit
```

All operations belonging to one atomic transition must use the same `UnitOfWork`.

---

## 13. Idempotency

Blockchain events may be delivered multiple times.

Example:

```text
CONFIRMED
CONFIRMED
CONFIRMED
```

The result must be equivalent to processing the event once.

A duplicate event must NOT create:

```text
duplicate BookPosting
duplicate balance changes
duplicate BookHistory
duplicate final accounting
```

Use:

```text
database constraints
+
transaction locking
+
state validation
```

Do not rely only on an in-memory duplicate check.

---

## 14. State Transition Validation

Every blockchain event must be validated against the current transaction state.

Valid examples:

```text
SENT → CONFIRMING
CONFIRMING → CONFIRMED
CONFIRMING → FAILED
```

Invalid examples:

```text
CONFIRMED → SENT
CONFIRMED → AUTHORIZED
FAILED → AUTHORIZED
```

must be rejected.

If an event represents an already-applied terminal transition, handle it idempotently and do not apply accounting again.

---

## 15. JournalTransaction Locking

Before applying a blockchain state transition:

```text
SELECT JournalTransaction
FOR UPDATE
```

Then:

```text
validate current state
```

This prevents concurrent blockchain events from processing the same transaction simultaneously.

Example:

```text
Event A: CONFIRMED
Event B: CONFIRMED

A locks transaction
B waits

A applies accounting
A commits

B reads final state
B sees that CONFIRMED has already been processed
B exits idempotently
```

---

## 16. Book Locking

When accounting affects a book:

```text
SELECT relevant Book rows
FOR UPDATE
```

Balance changes and validation must happen while the relevant book rows are locked.

This is especially important when multiple transactions affect the same client/asset balance concurrently.

Do not use optimistic version checks as the primary balance-protection mechanism.

The current bookkeeping design uses pessimistic locking.

---

## 17. Atomic Accounting Example

For a successful withdrawal confirmation:

```text
BEGIN

lock JournalTransaction

lock relevant CUSTODY_ASSET_ACCOUNT Book
lock relevant BLOCKCHIAN_EXTERNAL_ACCOUNT Book

validate:
    current state = CONFIRMING

resolve AccountItem
resolve FeeItem

create BookPosting(s)

update Book balances

create BookHistory

update JournalTransaction:
    CONFIRMING → CONFIRMED

create JournalTransactionHistory

COMMIT
```

If any step fails:

```text
ROLLBACK EVERYTHING
```

Never allow:

```text
JournalTransaction = CONFIRMED
Book = updated
BookHistory = missing
```

or:

```text
Book = updated
BookPosting = missing
```

---

## 18. Withdrawal Accounting

For:

```text
WITHDRAW
100 USDT
```

successful accounting:

```text
CUSTODY_ASSET_ACCOUNT
    -100 USDT

BLOCKCHIAN_EXTERNAL_ACCOUNT
    +100 USDT
```

For:

```text
WITHDRAW
100 USDT
fee = 2 USDT
```

apply:

```text
CUSTODY_ASSET_ACCOUNT
    -100 USDT
BLOCKCHIAN_EXTERNAL_ACCOUNT
    +100 USDT

CUSTODY_ASSET_ACCOUNT
    -2 USDT
BLOCKCHIAN_EXTERNAL_ACCOUNT
    +2 USDT
```

If fee is:

```text
0.001 ETH
```

then the fee posting is independently applied to ETH.

---

## 19. Deposit Accounting

For a recognized blockchain deposit:

```text
BLOCKCHIAN_EXTERNAL_ACCOUNT
    -amount

CUSTODY_ASSET_ACCOUNT
    +amount
```

The deposit must still create/use:

```text
JournalTransaction
AccountItem
BookPosting
Book
BookHistory
JournalTransactionHistory
```

according to the existing model.

The fact that a deposit is discovered from the blockchain does not bypass the bookkeeping architecture.

---

## 20. Failure/Reversal Accounting

When a transaction moves:

```text
CONFIRMING → FAILED
```

apply the existing failure/reversal rules atomically.

If a previous step created a reservation/lock:

```text
reservation
    ↓
FAILED
    ↓
release/revert
```

Do not invent a new accounting model.

Use the existing:

```text
JournalTransaction
BookPosting
Book
BookHistory
```

pipeline.

---

## 21. Transaction-Type Reuse

The generic blockchain event lifecycle must be shared across:

```text
WITHDRAW
STAKE
UNSTAKE
RESTAKE
DEPOSIT
```

Shared logic includes:

```text
event validation
correlation
idempotency
transaction lookup
JournalTransaction
locking
state validation
AccountItem resolution
FeeItem resolution
BookPosting
Book
BookHistory
JournalTransactionHistory
UnitOfWork
error handling
```

Only isolate actual differences:

```text
event validation
transaction-specific state mapping
asset movement
accounting semantics
blockchain-specific metadata
deposit detection rules
```

Do not duplicate the entire event flow for each transaction type.

---

## 22. Boundary With systemTransactionHandler

The responsibilities are:

```text
systemTransactionHandler
    ↓
creates/initiates system transaction
    ↓
AUTHORIZING
    ↓
AUTHORIZED
    ↓
SENT
```

Then:

```text
blockchainEventHandler
    ↓
observes blockchain
    ↓
CONFIRMING
    ↓
CONFIRMED / FAILED
```

`blockchainEventHandler` also handles blockchain-originated deposits.

The two handlers must share the same accounting model:

```text
JournalTransaction
    ↓
BookPosting
    ↓
Book
    ↓
BookHistory
```

and:

```text
JournalTransactionHistory
```

Do not implement a second bookkeeping mechanism inside `blockchainEventHandler`.

---

## 23. Implementation Constraints

Use the existing project structure:

```text
interfaces/
models/
repositories/
constants/
common/UnitOfWork.ts
di/
handler/
```

Do not introduce:

```text
commands/
```

Do not create separate confirmation handlers for each transaction type.

Do not introduce additional books.

Do not bypass the existing repositories/models.

Do not introduce a new architectural layer unless necessary.

The target architecture is:

```text
Generic blockchain event flow
+
Generic accounting pipeline
+
Transaction-specific logic only where actually required
```

---

## 24. Final Design Principle

The implementation must distinguish:

```text
Transaction Type
```

from:

```text
Transaction Flow
```

Transaction type describes:

```text
WITHDRAW
STAKE
UNSTAKE
RESTAKE
DEPOSIT
```

Transaction flow describes:

```text
validation
idempotency
correlation
locking
state transition
accounting
history
UnitOfWork
```

Therefore, do not duplicate the flow simply because the transaction type is different.

The desired design is:

```text
                  Transaction Type
                         │
             ┌───────────┴───────────┐
             │                       │
      Type-specific rules       Type-specific
      / validation              accounting
             │                       │
             └───────────┬───────────┘
                         ▼
                 Generic Flow
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
          Journal     Posting      State
              │          │          │
              └─────┬────┴──────────┘
                    ▼
                  Book
                    │
                    ▼
                 History
```

Keep the implementation simple, explicit, reusable, and consistent with the existing project structure.
