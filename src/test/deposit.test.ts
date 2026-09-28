import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import { BLOCKCHAIN_TRANSACTION_STATUS, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE } from '../constants';

import type { BlockchainMessagePayload, BlockchainTransactionStatus } from '../interfaces';

import { BOOK, TEST_ACCOUNT, closeTestDatabase, createTestLedger, type TestLedger } from './support/inMemoryLedger';

const TRANSACTION_HASH = '0xdeposit-1';
const DEPOSIT_ADDRESS = 'addr-deposit-1';
const QUANTITY = '1000';

function depositEvent(status: BlockchainTransactionStatus): BlockchainMessagePayload {
  return {
    transactionHash: TRANSACTION_HASH,
    status,
    senders: [
      {
        address: 'addr-external-sender',
        assetTicker: TEST_ACCOUNT.assetTicker,
        quantity: QUANTITY,
      },
    ],
    recipients: [
      {
        address: DEPOSIT_ADDRESS,
        assetTicker: TEST_ACCOUNT.assetTicker,
        quantity: QUANTITY,
        type: 'AMOUNT',
      },
    ],
  };
}

describe('DEPOSIT — lifecycle', () => {
  let ledger: TestLedger;

  beforeEach(() => {
    ledger = createTestLedger();

    ledger.seedCustodyBook({
      address: DEPOSIT_ADDRESS,
      amount: '0',
    });
  });

  afterEach(() => ledger.restore());

  after(closeTestDatabase);

  it('creates an ACTIVE journal when the deposit enters CONFIRMING', async () => {
    const entity = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    assert.equal(entity.type, 'DEPOSIT');
    assert.equal(entity.state, TRANSACTION_STATE.CONFIRMING.code);
    assert.equal(entity.journalTransactionState, JOURNAL_TRANSACTION_STATE.ACTIVE);

    assert.equal(entity.transactionHash, TRANSACTION_HASH);
    assert.equal(entity.recipient.assetTicker, TEST_ACCOUNT.assetTicker);
    assert.equal(entity.recipient.quantity, QUANTITY);
    assert.equal(entity.recipient.address, DEPOSIT_ADDRESS);

    // CONFIRMING must not change balances.
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), '0');

    assert.equal(ledger.amountOf(BOOK.external('BTC')), '0');

    assert.equal(ledger.totalBalance(), 0n);

    // Journal exists, but no posting has been applied yet.
    assert.equal(ledger.tables.journals.rows.length, 1);
    assert.equal(ledger.tables.bookPostings.rows.length, 0);
    assert.equal(ledger.totalPosted(), 0n);

    // Only the journal creation history should exist.
    assert.deepEqual(
      ledger.tables.journalHistories.rows.map((row) => row.historyTransactionTypeId),
      [HISTORY_EVENT_TYPE.CREATED],
    );

    assert.equal(ledger.tables.bookHistories.rows.length, 0);
  });

  it('advances the same journal from CONFIRMING to CONFIRMED', async () => {
    const confirming = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    const confirmed = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    // The CONFIRMED event must advance the existing journal.
    assert.equal(confirmed.id, confirming.id);

    assert.equal(confirmed.state, TRANSACTION_STATE.CONFIRMED.code);

    assert.equal(confirmed.journalTransactionState, JOURNAL_TRANSACTION_STATE.COMPLETED);

    assert.equal(ledger.tables.journals.rows.length, 1);

    // Posting is applied only when the deposit becomes CONFIRMED.
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);

    assert.equal(ledger.amountOf(BOOK.external('BTC')), `-${QUANTITY}`);

    // Double-entry:
    // custody +1000
    // external -1000
    // total = 0
    assert.equal(ledger.totalBalance(), 0n);

    // Two sides of the deposit posting.
    assert.equal(ledger.tables.bookPostings.rows.length, 2);

    // Each posting creates one book history entry.
    const appliedHistories = ledger.tables.bookHistories.rows.filter((row) => row.historyTransactionTypeId === HISTORY_EVENT_TYPE.POSTING_APPLIED);

    assert.equal(appliedHistories.length, 2);

    // Journal history:
    // CREATED → STATE_ADVANCED
    assert.deepEqual(
      ledger.tables.journalHistories.rows.map((row) => row.historyTransactionTypeId),
      [HISTORY_EVENT_TYPE.CREATED, HISTORY_EVENT_TYPE.STATE_ADVANCED],
    );

    assert.equal(ledger.totalPosted(), 0n);
  });

  it('creates and completes the deposit when the first blockchain event is CONFIRMED', async () => {
    const confirmed = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    assert.equal(confirmed.type, 'DEPOSIT');
    assert.equal(confirmed.state, TRANSACTION_STATE.CONFIRMED.code);

    assert.equal(confirmed.journalTransactionState, JOURNAL_TRANSACTION_STATE.COMPLETED);

    assert.equal(confirmed.transactionHash, TRANSACTION_HASH);

    assert.equal(confirmed.recipient.assetTicker, TEST_ACCOUNT.assetTicker);

    assert.equal(confirmed.recipient.quantity, QUANTITY);

    assert.equal(confirmed.recipient.address, DEPOSIT_ADDRESS);

    // The handler may receive CONFIRMED directly if the
    // blockchain provider does not emit CONFIRMING.
    assert.equal(ledger.tables.journals.rows.length, 1);

    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);

    assert.equal(ledger.amountOf(BOOK.external('BTC')), `-${QUANTITY}`);

    assert.equal(ledger.totalBalance(), 0n);

    assert.equal(ledger.tables.bookPostings.rows.length, 2);

    const appliedHistories = ledger.tables.bookHistories.rows.filter((row) => row.historyTransactionTypeId === HISTORY_EVENT_TYPE.POSTING_APPLIED);

    assert.equal(appliedHistories.length, 2);

    assert.deepEqual(
      ledger.tables.journalHistories.rows.map((row) => row.historyTransactionTypeId),
      [HISTORY_EVENT_TYPE.CREATED, HISTORY_EVENT_TYPE.STATE_ADVANCED],
    );
  });
});

describe('DEPOSIT — idempotency', () => {
  let ledger: TestLedger;

  beforeEach(() => {
    ledger = createTestLedger();

    ledger.seedCustodyBook({
      address: DEPOSIT_ADDRESS,
      amount: '0',
    });
  });

  afterEach(() => ledger.restore());

  after(closeTestDatabase);

  it('does not create a second journal for duplicate CONFIRMING events', async () => {
    const first = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    const second = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    assert.equal(second.id, first.id);

    assert.equal(second.state, TRANSACTION_STATE.CONFIRMING.code);

    assert.equal(second.journalTransactionState, JOURNAL_TRANSACTION_STATE.ACTIVE);

    assert.equal(ledger.tables.journals.rows.length, 1);

    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), '0');

    assert.equal(ledger.amountOf(BOOK.external('BTC')), '0');

    assert.equal(ledger.tables.bookPostings.rows.length, 0);

    // Duplicate CONFIRMING must not create another CREATED history.
    assert.equal(ledger.tables.journalHistories.rows.filter((row) => row.historyTransactionTypeId === HISTORY_EVENT_TYPE.CREATED).length, 1);
  });

  it('does not apply the deposit twice for duplicate CONFIRMED events', async () => {
    const first = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    const confirmed = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    const duplicate = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    assert.equal(confirmed.id, first.id);
    assert.equal(duplicate.id, first.id);

    assert.equal(duplicate.state, TRANSACTION_STATE.CONFIRMED.code);

    assert.equal(duplicate.journalTransactionState, JOURNAL_TRANSACTION_STATE.COMPLETED);

    // The deposit must only be posted once.
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);

    assert.equal(ledger.amountOf(BOOK.external('BTC')), `-${QUANTITY}`);

    assert.equal(ledger.totalBalance(), 0n);

    // Exactly two postings:
    // custody +1000
    // external -1000
    assert.equal(ledger.tables.bookPostings.rows.length, 2);

    const appliedHistories = ledger.tables.bookHistories.rows.filter((row) => row.historyTransactionTypeId === HISTORY_EVENT_TYPE.POSTING_APPLIED);

    assert.equal(appliedHistories.length, 2);

    // No second STATE_ADVANCED should be generated.
    assert.deepEqual(
      ledger.tables.journalHistories.rows.map((row) => row.historyTransactionTypeId),
      [HISTORY_EVENT_TYPE.CREATED, HISTORY_EVENT_TYPE.STATE_ADVANCED],
    );
  });

  it('is idempotent when CONFIRMED is received repeatedly', async () => {
    const first = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    const second = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    const third = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    assert.equal(second.id, first.id);
    assert.equal(third.id, first.id);

    assert.equal(third.state, TRANSACTION_STATE.CONFIRMED.code);

    assert.equal(third.journalTransactionState, JOURNAL_TRANSACTION_STATE.COMPLETED);

    // Still only one journal.
    assert.equal(ledger.tables.journals.rows.length, 1);

    // Still only one double-entry posting.
    assert.equal(ledger.tables.bookPostings.rows.length, 2);

    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);

    assert.equal(ledger.amountOf(BOOK.external('BTC')), `-${QUANTITY}`);

    assert.equal(ledger.totalBalance(), 0n);
  });
});
