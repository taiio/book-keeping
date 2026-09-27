# systemTransactionHandler Design

## 1. Purpose

`systemTransactionHandler` is the generic entry point for transactions initiated by the internal system.

Supported transaction types:

* `WITHDRAW`
* `STAKE`
* `UNSTAKE`
* `RESTAKE`

Do **not** create separate top-level handlers such as:

* `handleWithdraw()`
* `handleStake()`
* `handleUnstake()`
* `handleRestake()`

These transaction types share the same lifecycle. Reuse the generic transaction flow as much as possible.

Transaction-specific logic should exist only where validation, payload construction, or accounting semantics are actually different.

---

## 2. System Transaction Lifecycle

The common system-side lifecycle is:

```text
AUTHORIZING
    ↓
AUTHORIZED
    ↓
SENT
```

A transaction can be proactively rejected during the system-side lifecycle:

```text
AUTHORIZING ──► REJECTED
AUTHORIZED  ──► REJECTED
SENT        ──► REJECTED
```

`REJECTED` and `FAILED` have different meanings.

* `REJECTED`: system/business/provider processing rejected the transaction.
* `FAILED`: blockchain execution failed after blockchain processing.

Blockchain confirmation and blockchain failure are handled by `blockchainEventHandler`.

---

## 3. Current Books

The system currently has only two books:

```text
CUSTODY_ASSET_ACCOUNT
BLOCKCHIAN_EXTERNAL_ACCOUNT
```

Do not introduce additional books unless explicitly required later.

### CUSTODY_ASSET_ACCOUNT

Represents assets held in custody on behalf of clients.

### BLOCKCHIAN_EXTERNAL_ACCOUNT

Represents assets/accounts outside the custody ledger, such as external blockchain or settlement accounts.

---

## 4. Accounting Backbone

The accounting chain is:

```text
Transaction
    ↓
JournalTransaction
    ↓
BookPosting
    ↓
Book
    ↓
BookHistory
```

Transaction-level audit history is also maintained:

```text
JournalTransaction
    ↓
JournalTransactionHistory
```

The complete relationship is:

```text
Transaction
    │
    ├── AccountItem[]
    │
    └── FeeItem[]
            │
            ▼
    JournalTransaction
            │
            ▼
      BookPosting[]
            │
       ┌────┴────┐
       ▼         ▼
     Book      Book
       │         │
       └────┬────┘
            ▼
      BookHistory

JournalTransaction
        │
        ▼
JournalTransactionHistory
```

Do not bypass `JournalTransaction` and directly update `Book`.

---

## 5. AccountItem and FeeItem

A transaction can contain:

```text
AccountItem[]
FeeItem[]
```

Both are accounting items.

`FeeItem` is NOT metadata-only.

Every fee that affects the transaction must be resolved/created and included in bookkeeping.

Each item has its own asset identity, including fields such as:

```text
clientId
accountId
assetId
assetTypeId
assetTicker
walletTypeId
```

Do not assume that the fee asset is the same as the transaction asset.

Example:

```text
AccountItem:
    100 USDT

FeeItem:
    0.001 ETH
```

USDT and ETH must be validated independently.

If amount and fee use the same asset, their amounts may be aggregated for balance validation.

---

## 6. Accounting Examples

### Withdrawal

For:

```text
100 USDT
```

the accounting direction is:

```text
CUSTODY_ASSET_ACCOUNT
    -100 USDT

BLOCKCHIAN_EXTERNAL_ACCOUNT
    +100 USDT
```

For:

```text
100 USDT
fee = 2 USDT
```

the accounting is:

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

If the fee is another asset:

```text
100 USDT
fee = 0.001 ETH
```

then:

```text
USDT:
    CUSTODY_ASSET_ACCOUNT       -100
    BLOCKCHIAN_EXTERNAL_ACCOUNT +100

ETH:
    CUSTODY_ASSET_ACCOUNT       -0.001
    BLOCKCHIAN_EXTERNAL_ACCOUNT +0.001
```

---

## 7. Generic Flow

All system transaction types must reuse this lifecycle:

```text
System Transaction
       ↓
Validate Input
       ↓
Get/Create JournalTransaction
       ↓
Resolve AccountItem(s)
       ↓
Resolve FeeItem(s)
       ↓
AUTHORIZING
       ↓
Validate Business Rules
       ↓
Validate Required Balances
       ↓
Apply Required Accounting
       ↓
AUTHORIZED
       ↓
Call Blockchain Provider
       ↓
SENT
```

The implementation should not duplicate this flow for each transaction type.

---

## 8. Idempotency

Duplicate requests must resolve to the same logical transaction.

Do not rely only on:

```text
SELECT
if not found
INSERT
```

because concurrent requests can both observe that the record does not exist.

Use database constraints and transaction-safe locking.

A duplicate request must not create duplicate:

```text
JournalTransaction
AccountItem
FeeItem
BookPosting
BookHistory
JournalTransactionHistory
```

for the same logical operation/state transition.

---

## 9. Transaction Initialization

When a new system transaction is received:

1. Validate the input.
2. Validate the transaction type.
3. Resolve the logical transaction using the existing idempotency mechanism.
4. Get or create `JournalTransaction`.
5. Resolve/create `AccountItem`.
6. Resolve/create `FeeItem`.
7. Validate asset/account information.
8. Transition to `AUTHORIZING`.
9. Write `JournalTransactionHistory`.

The initialization must be idempotent.

---

## 10. Balance Validation

Before authorization succeeds, validate the required balances.

Balance validation must be performed per asset.

Example:

```text
Transaction:
    100 USDT

Fee:
    2 USDT
```

Required USDT:

```text
102 USDT
```

But:

```text
Transaction:
    100 USDT

Fee:
    0.001 ETH
```

must validate:

```text
USDT >= 100
ETH  >= 0.001
```

Do not combine different assets.

---

## 11. Pessimistic Locking

Bookkeeping balance operations should use pessimistic locking.

Lock the relevant `Book` rows before validating and changing balances.

Conceptually:

```text
BEGIN

SELECT relevant Book rows
FOR UPDATE

validate balance

create BookPosting
update Book
create BookHistory

COMMIT
```

Concurrent withdrawals must serialize on the same relevant balance/book rows.

Never allow the custody balance to become negative.

If the required balance is insufficient:

```text
AUTHORIZING
    ↓
REJECTED
```

The rejection reason must be persisted according to the existing transaction/history model.

---

## 12. JournalTransaction → BookPosting → Book → History

Whenever accounting is applied, follow this chain:

```text
JournalTransaction
        ↓
BookPosting
        ↓
Book
        ↓
BookHistory
```

For example:

```text
JournalTransaction: WITHDRAW 100 USDT

BookPosting:
    CUSTODY_ASSET_ACCOUNT       -100 USDT
    BLOCKCHIAN_EXTERNAL_ACCOUNT +100 USDT

Book:
    update current balances

BookHistory:
    record the balance change
```

Do not update the `Book` without creating the corresponding `BookPosting`.

Do not create a posting without recording the required history.

---

## 13. AUTHORIZING

`AUTHORIZING` means the system is validating and preparing the transaction.

Typical operations:

```text
validate input
resolve transaction
resolve AccountItem
resolve FeeItem
validate business rules
lock relevant books
validate balances
```

If everything succeeds:

```text
AUTHORIZING
    ↓
AUTHORIZED
```

If validation or balance checks fail:

```text
AUTHORIZING
    ↓
REJECTED
```

State changes and related database changes must be atomic.

---

## 14. AUTHORIZED

`AUTHORIZED` means the transaction has passed system authorization and is ready for blockchain submission.

Persist:

```text
JournalTransaction.state = AUTHORIZED
```

and:

```text
JournalTransactionHistory
```

according to the existing model.

Do not call the blockchain provider while the database transaction is open.

---

## 16. SENT

When submission succeeds:

```text
AUTHORZIED
    ↓
SENT
```

Persist the blockchain information available at that point, such as:

```text
transaction hash
sender
network/chain
provider metadata
```

Then commit.

The system handler should not wait for blockchain confirmation.

The blockchain lifecycle is handled by:

```text
blockchainEventHandler
```

---

## 17. Rejection

The implementation must support proactive rejection during the system lifecycle.

Possible transitions:

```text
AUTHORIZING → REJECTED
AUTHORIZED  → REJECTED
SENT        → REJECTED
```

The exact business reason must be recorded.

Do not silently change state.

Do not use `FAILED` when the actual reason is a system/business rejection.

---

## 18. UnitOfWork

All operations belonging to one atomic database transition must use the existing `UnitOfWork`.

Example:

```text
BEGIN
    lock JournalTransaction
    lock relevant Book rows

    validate current state
    validate balance

    resolve AccountItem
    resolve FeeItem

    create/update JournalTransaction
    create BookPosting
    update Book
    create BookHistory
    create JournalTransactionHistory

COMMIT
```

If any operation fails:

```text
ROLLBACK EVERYTHING
```

Never allow partial accounting.

Invalid examples:

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

## 19. State Transition Validation

Do not blindly update the state.

Validate:

```text
current state
+
requested transition
```

Core transitions:

```text
AUTHORIZING → AUTHORIZED
AUTHORIZING → REJECTED

AUTHORIZED → REJECTED

AUTHORIZED → SENT
AUTHORIZED → REJECTED
```

Invalid transitions must fail.

Examples:

```text
SENT → AUTHORIZED
AUTHORIZED → AUTHORIZING
CONFIRMED → AUTHORIZED
```

must not be accepted.

---

## 20. Reuse Requirement

The same generic lifecycle must be reused for:

```text
WITHDRAW
STAKE
UNSTAKE
RESTAKE
```

Shared logic includes:

```text
input validation
idempotency
JournalTransaction
AccountItem
FeeItem
state transition
locking
balance validation
BookPosting
Book
BookHistory
JournalTransactionHistory
UnitOfWork
blockchain submission
error handling
```

Transaction-specific code should only contain actual differences in:

```text
business validation
blockchain payload
asset/account semantics
accounting semantics
```

Do not create four copies of the same lifecycle.

---

## 21. Implementation Constraints

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

Do not create `Command` classes.

Do not create separate handler methods for every transaction type unless there is a real transaction-specific operation that cannot be shared.

Do not add new books.

Do not introduce a new architectural layer unless necessary.

The target design is:

```text
Generic system transaction lifecycle
+
Reusable accounting pipeline
+
Transaction-specific logic only where required
```
