import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import { BLOCKCHAIN_TRANSACTION_STATUS, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE } from '../constants';
import type { BlockchainMessagePayload, BlockchainTransactionStatus, Withdraw } from '../interfaces';
import { BOOK, TEST_ACCOUNT, closeTestDatabase, createTestLedger, type TestLedger } from './support/inMemoryLedger';

const TRANSACTION_HASH = '0xwithdraw-1';
const SENDER_ADDRESS = 'addr-sender-1';
const RECIPIENT_ADDRESS = 'addr-external-1';

// Design example: amount 100 + fee 2 => 102 di chuyển qua từng bucket.
const INITIAL_BALANCE = '10000';
const AMOUNT = '100';
const FEE = '2';

// Amount và fee cùng asset (cùng 1 book) — kiểm tra số dư phải theo tổng (102), không theo từng vế.
const withdraw: Withdraw = {
  type: 'WITHDRAW',
  idempotencyToken: 'idem-withdraw-1',
  uuidToken: 'uuid-withdraw-1',
  sender: [{ ...TEST_ACCOUNT, quantity: AMOUNT, address: SENDER_ADDRESS }],
  recipient: [{ assetId: TEST_ACCOUNT.assetId, assetTicker: TEST_ACCOUNT.assetTicker, quantity: AMOUNT, address: RECIPIENT_ADDRESS }],
  fee: { ...TEST_ACCOUNT, quantity: FEE },
};

function withdrawEvent(status: BlockchainTransactionStatus): BlockchainMessagePayload {
  return {
    transactionHash: TRANSACTION_HASH,
    status,
    senders: [{ address: SENDER_ADDRESS, assetTicker: TEST_ACCOUNT.assetTicker, quantity: AMOUNT, feePaid: FEE }],
    recipients: [{ address: RECIPIENT_ADDRESS, assetTicker: TEST_ACCOUNT.assetTicker, quantity: AMOUNT, type: 'AMOUNT' }],
  };
}

/** Số dư tất cả bucket của BTC — để assert "tiền đang nằm ở đâu". */
function buckets(ledger: TestLedger) {
  return {
    available: ledger.amountOf(BOOK.custodyAvailable('BTC')),
    reserved: ledger.amountOf(BOOK.custodyReserved('BTC')),
    authorized: ledger.amountOf(BOOK.custodyAuthorized('BTC')),
    sent: ledger.amountOf(BOOK.custodySent('BTC')),
    confirming: ledger.amountOf(BOOK.custodyConfirming('BTC')),
    feeConfirming: ledger.amountOf(BOOK.feeConfirming('BTC')),
    feeRevenue: ledger.amountOf(BOOK.feeRevenue('BTC')),
    external: ledger.amountOf(BOOK.external('BTC')),
  };
}

describe('WITHDRAW — lifecycle', () => {
  let ledger: TestLedger;

  beforeEach(() => {
    ledger = createTestLedger();
    ledger.seedCustodyBook({ amount: INITIAL_BALANCE });
    ledger.systemTransactionHandler.blockchainSubmitter = {
      submit: async () => ({ transactionHash: TRANSACTION_HASH, senderAddress: SENDER_ADDRESS }),
    };
  });

  afterEach(() => ledger.restore());
  after(closeTestDatabase);

  it('AUTHORIZING -> AUTHORIZED -> SENT: 102 walks Available -> Reserved -> Authorized -> Sent', async () => {
    const entity = await ledger.systemTransactionHandler.handle(withdraw);

    assert.equal(entity.type, 'WITHDRAW');
    assert.equal(entity.state, TRANSACTION_STATE.SENT.code);
    assert.equal(entity.journalTransactionState, JOURNAL_TRANSACTION_STATE.ACTIVE);
    assert.equal(entity.transactionHash, TRANSACTION_HASH);
    assert.equal(entity.errorMessage, undefined);

    const b = buckets(ledger);

    assert.equal(b.available, '9898');
    assert.equal(b.sent, '102');
    assert.equal(b.reserved, '0');
    assert.equal(b.authorized, '0');
    assert.equal(b.external, undefined);

    // 3 bước (AUTHORIZING, AUTHORIZED, SENT) × (amount + fee) × 2 dòng = 12 posting; mỗi bước là 1 bút toán đúp cân bằng.
    assert.equal(ledger.tables.bookPostings.rows.length, 12);
    assert.equal(ledger.totalPosted(), 0n);

    assert.deepEqual(
      ledger.tables.journalHistories.rows.map((row) => row.historyTransactionTypeId),
      [HISTORY_EVENT_TYPE.CREATED, HISTORY_EVENT_TYPE.STATE_ADVANCED, HISTORY_EVENT_TYPE.STATE_ADVANCED],
    );
  });

  it('CONFIRMING moves Sent -> Confirming; CONFIRMED settles amount to External and fee to Fee Revenue', async () => {
    const sent = await ledger.systemTransactionHandler.handle(withdraw);

    const confirming = await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    assert.equal(confirming.id, sent.id);
    assert.equal(confirming.state, TRANSACTION_STATE.CONFIRMING.code);
    assert.equal(confirming.journalTransactionState, JOURNAL_TRANSACTION_STATE.ACTIVE);
    assert.equal(buckets(ledger).sent, '0');
    assert.equal(buckets(ledger).confirming, '102');
    assert.equal(buckets(ledger).external, undefined, 'nothing settles before CONFIRMED');

    const confirmed = await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    assert.equal(confirmed.id, sent.id);
    assert.equal(confirmed.state, TRANSACTION_STATE.CONFIRMED.code);
    assert.equal(confirmed.journalTransactionState, JOURNAL_TRANSACTION_STATE.COMPLETED);

    const b = buckets(ledger);

    assert.equal(b.available, '9898');
    assert.equal(b.confirming, '0');
    assert.equal(b.external, '100');
    assert.equal(b.feeConfirming, '0', 'fee passes through Fee Confirming and lands in Fee Revenue');
    assert.equal(b.feeRevenue, '2');

    assert.equal(ledger.totalPosted(), 0n);
    assert.equal(ledger.totalBalance(), BigInt(INITIAL_BALANCE));
    assert.equal(ledger.tables.journals.rows.length, 1);
  });

  it('duplicate CONFIRMED / CONFIRMING events post nothing twice', async () => {
    await ledger.systemTransactionHandler.handle(withdraw);
    await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));
    await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    const postings = ledger.tables.bookPostings.rows.length;
    const before = buckets(ledger);

    await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));
    await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    assert.equal(ledger.tables.bookPostings.rows.length, postings);
    assert.deepEqual(buckets(ledger), before);
  });

  it('FAILED from CONFIRMING: Confirming -102 / Available +102', async () => {
    await ledger.systemTransactionHandler.handle(withdraw);
    await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    const failed = await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.FAILED));

    assert.equal(failed.journalTransactionState, JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED);

    const b = buckets(ledger);

    assert.equal(b.available, INITIAL_BALANCE);
    assert.equal(b.confirming, '0');
    assert.equal(b.external, undefined);
    assert.equal(b.feeRevenue, undefined);
    assert.equal(ledger.totalPosted(), 0n);
  });

  it('FAILED straight from SENT releases the Sent bucket back to Available', async () => {
    await ledger.systemTransactionHandler.handle(withdraw);
    await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.FAILED));

    const b = buckets(ledger);

    assert.equal(b.available, INITIAL_BALANCE);
    assert.equal(b.sent, '0');
    assert.equal(ledger.totalPosted(), 0n);
  });
});

describe('WITHDRAW — rejection paths', () => {
  let ledger: TestLedger;

  beforeEach(() => {
    ledger = createTestLedger();
  });

  afterEach(() => ledger.restore());
  after(closeTestDatabase);

  it('INSUFFICIENT: REJECTED with NO posting (amount + fee is checked as a sum)', async () => {
    ledger.seedCustodyBook({ amount: '101' }); // đủ amount (100) hoặc fee (2) riêng lẻ, nhưng thiếu tổng 102
    ledger.systemTransactionHandler.blockchainSubmitter = {
      submit: async () => {
        throw new Error('must not be called');
      },
    };

    const entity = await ledger.systemTransactionHandler.handle(withdraw);

    assert.equal(entity.journalTransactionState, JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED);
    assert.match(entity.errorMessage ?? '', /Insufficient balance/);
    assert.equal(ledger.tables.bookPostings.rows.length, 0);
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), '101');
  });

  it('AUTHORIZING posts Available -> Reserved as its own step (visible if the next step is stopped)', async () => {
    ledger.seedCustodyBook({ amount: INITIAL_BALANCE });
    ledger.systemTransactionHandler.blockchainSubmitter = {
      submit: async () => ({ transactionHash: TRANSACTION_HASH, senderAddress: SENDER_ADDRESS }),
    };

    await ledger.systemTransactionHandler.handle(withdraw);

    const reservePostings = ledger.tables.bookPostings.rows.filter((row) => row.idempotencyToken.includes(':ADV:AUTHORIZING:'));

    assert.equal(reservePostings.length, 4, 'amount + fee, 2 legs each');
    assert.equal(
      reservePostings.reduce((sum, row) => sum + BigInt(row.amount), 0n),
      0n,
    );
  });

  it('provider submit failure releases Authorized back to Available', async () => {
    ledger.seedCustodyBook({ amount: INITIAL_BALANCE });
    ledger.systemTransactionHandler.blockchainSubmitter = {
      submit: async () => {
        throw new Error('provider down');
      },
    };

    const entity = await ledger.systemTransactionHandler.handle(withdraw);

    assert.equal(entity.journalTransactionState, JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED);
    assert.equal(entity.errorMessage, 'provider down');

    const b = buckets(ledger);

    assert.equal(b.available, INITIAL_BALANCE);
    assert.equal(b.authorized, '0');
    assert.equal(b.reserved, '0');
    assert.equal(ledger.totalPosted(), 0n);
  });

  it('a replayed request (same idempotencyToken) does not reserve again', async () => {
    ledger.seedCustodyBook({ amount: INITIAL_BALANCE });
    ledger.systemTransactionHandler.blockchainSubmitter = {
      submit: async () => ({ transactionHash: TRANSACTION_HASH, senderAddress: SENDER_ADDRESS }),
    };

    await ledger.systemTransactionHandler.handle(withdraw);
    await ledger.systemTransactionHandler.handle(withdraw);

    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), '9898');
    assert.equal(ledger.tables.bookPostings.rows.length, 12);
  });
});
