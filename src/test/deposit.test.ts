import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import { BLOCKCHAIN_TRANSACTION_STATUS, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE } from '../constants';

import type { BlockchainMessagePayload, BlockchainTransactionStatus } from '../interfaces';

import { BOOK, TEST_ACCOUNT, closeTestDatabase, createTestLedger, type TestLedger } from './support/inMemoryLedger';

const TRANSACTION_HASH = '0xdeposit-1';
const DEPOSIT_ADDRESS = 'addr-deposit-1';
const QUANTITY = '1000';

function depositEvent(
  status: BlockchainTransactionStatus,
  extra: Partial<BlockchainMessagePayload['recipients'][number]> = {},
): BlockchainMessagePayload {
  return {
    transactionHash: TRANSACTION_HASH,
    status,
    idempotencyToken: `deposit-${status}`,
    senders: [{ address: 'addr-external-sender', assetTicker: TEST_ACCOUNT.assetTicker, quantity: QUANTITY }],
    recipients: [{ address: DEPOSIT_ADDRESS, assetTicker: TEST_ACCOUNT.assetTicker, quantity: QUANTITY, type: 'AMOUNT', ...extra }],
  };
}

const appliedHistories = (ledger: TestLedger) =>
  ledger.tables.bookHistories.rows.filter((row) => row.historyTransactionTypeId === HISTORY_EVENT_TYPE.POSTING_APPLIED);

describe('DEPOSIT — lifecycle', () => {
  let ledger: TestLedger;

  beforeEach(async () => {
    ledger = createTestLedger();
    // Book của recipient phải tồn tại TRƯỚC khi deposit xảy ra.
    await ledger.createRecipientBooks({ address: DEPOSIT_ADDRESS });
  });

  afterEach(() => ledger.restore());
  after(closeTestDatabase);

  it('reuses the recipient books created beforehand — only the shared External book is added', async () => {
    const before = await ledger.createRecipientBooks({ address: DEPOSIT_ADDRESS }); // get-or-create: trả lại đúng book đã có
    const booksBefore = ledger.tables.books.rows.length;

    assert.equal(booksBefore, 2, 'Available + Confirming');
    assert.equal(ledger.tables.bookHistories.rows.filter((row) => row.historyTransactionTypeId === HISTORY_EVENT_TYPE.CREATED).length, 2);

    await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    assert.equal(ledger.tables.books.rows.length, booksBefore + 1, 'only External is created by the deposit');
    assert.equal(ledger.tables.books.find(BOOK.custodyAvailable('BTC'))?.id, before.available.id);
    assert.equal(ledger.tables.books.find(BOOK.custodyConfirming('BTC'))?.id, before.confirming.id);
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);
  });

  it('CONFIRMING: External -1000 / Confirming +1000 (available untouched)', async () => {
    const entity = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    assert.equal(entity.type, 'DEPOSIT');
    assert.equal(entity.state, TRANSACTION_STATE.CONFIRMING.code);
    assert.equal(entity.journalTransactionState, JOURNAL_TRANSACTION_STATE.ACTIVE);
    assert.equal(entity.transactionHash, TRANSACTION_HASH);
    assert.equal(entity.recipient.quantity, QUANTITY);
    assert.equal(entity.recipient.address, DEPOSIT_ADDRESS);

    assert.equal(ledger.amountOf(BOOK.external('BTC')), `-${QUANTITY}`);
    assert.equal(ledger.amountOf(BOOK.custodyConfirming('BTC')), QUANTITY);
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), '0', 'confirming funds are not spendable');

    assert.equal(ledger.tables.journals.rows.length, 1);
    assert.equal(ledger.tables.bookPostings.rows.length, 2);
    assert.equal(ledger.totalPosted(), 0n);
    assert.equal(ledger.totalBalance(), 0n);
    assert.equal(appliedHistories(ledger).length, 2);

    assert.deepEqual(
      ledger.tables.journalHistories.rows.map((row) => row.historyTransactionTypeId),
      [HISTORY_EVENT_TYPE.CREATED],
    );
  });

  it('CONFIRMED: Confirming -1000 / Available +1000, on the same journal', async () => {
    const confirming = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));
    const confirmed = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    assert.equal(confirmed.id, confirming.id);
    assert.equal(confirmed.state, TRANSACTION_STATE.CONFIRMED.code);
    assert.equal(confirmed.journalTransactionState, JOURNAL_TRANSACTION_STATE.COMPLETED);

    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);
    assert.equal(ledger.amountOf(BOOK.custodyConfirming('BTC')), '0');
    assert.equal(ledger.amountOf(BOOK.external('BTC')), `-${QUANTITY}`);

    assert.equal(ledger.tables.journals.rows.length, 1);
    assert.equal(ledger.tables.bookPostings.rows.length, 4);
    assert.equal(ledger.totalPosted(), 0n);
    assert.equal(ledger.totalBalance(), 0n);
    assert.equal(appliedHistories(ledger).length, 4);

    assert.deepEqual(
      ledger.tables.journalHistories.rows.map((row) => row.historyTransactionTypeId),
      [HISTORY_EVENT_TYPE.CREATED, HISTORY_EVENT_TYPE.STATE_ADVANCED],
    );
  });

  it('CONFIRMED as first event still goes through Confirming (External -> Confirming -> Available)', async () => {
    const confirmed = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    assert.equal(confirmed.state, TRANSACTION_STATE.CONFIRMED.code);
    assert.equal(confirmed.journalTransactionState, JOURNAL_TRANSACTION_STATE.COMPLETED);

    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);
    assert.equal(ledger.amountOf(BOOK.custodyConfirming('BTC')), '0');
    assert.equal(ledger.amountOf(BOOK.external('BTC')), `-${QUANTITY}`);
    assert.equal(ledger.tables.journals.rows.length, 1);
    assert.equal(ledger.tables.bookPostings.rows.length, 4);
    assert.equal(ledger.totalBalance(), 0n);
  });

  it('FAILED: Confirming -1000 / External +1000 — deposit fully reversed', async () => {
    const confirming = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));
    const failed = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.FAILED));

    assert.equal(failed.id, confirming.id);
    assert.equal(failed.journalTransactionState, JOURNAL_TRANSACTION_STATE.FAILED);

    assert.equal(ledger.amountOf(BOOK.custodyConfirming('BTC')), '0');
    assert.equal(ledger.amountOf(BOOK.external('BTC')), '0');
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), '0');

    assert.equal(ledger.tables.bookPostings.rows.length, 4);
    assert.equal(ledger.totalPosted(), 0n);
  });

  it('a late FAILED after CONFIRMED is ignored (journal is terminal)', async () => {
    await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));
    const late = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.FAILED));

    assert.equal(late.journalTransactionState, JOURNAL_TRANSACTION_STATE.COMPLETED);
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);
    assert.equal(ledger.tables.bookPostings.rows.length, 4);
  });
});

describe('DEPOSIT — Find / Create Deposit Book (fallback when the recipient has no book yet)', () => {
  let ledger: TestLedger;

  beforeEach(() => {
    ledger = createTestLedger();
  });

  afterEach(() => ledger.restore());
  after(closeTestDatabase);

  it('creates the deposit book when the address is unknown but the recipient identifies the account', async () => {
    const { clientId, accountId, assetId, assetTypeId, walletTypeId } = TEST_ACCOUNT;
    const account = { clientId, accountId, assetId, assetTypeId, walletTypeId };

    await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED, { account }));

    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);
    assert.equal(ledger.tables.books.find({ ...BOOK.custodyAvailable('BTC') })?.address, DEPOSIT_ADDRESS);
    assert.equal(ledger.totalBalance(), 0n);

    // Event sau đó tìm lại đúng book vừa tạo, không tạo thêm.
    const booksBefore = ledger.tables.books.rows.length;

    await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED, { account }));

    assert.equal(ledger.tables.books.rows.length, booksBefore);
  });

  it('rejects a deposit to an unknown address that carries no account identity', async () => {
    await assert.rejects(() => ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING)), /DepositAddress/);
    assert.equal(ledger.tables.bookPostings.rows.length, 0);
  });
});

describe('DEPOSIT — idempotency', () => {
  let ledger: TestLedger;

  beforeEach(async () => {
    ledger = createTestLedger();
    // Book của recipient phải tồn tại TRƯỚC khi deposit xảy ra.
    await ledger.createRecipientBooks({ address: DEPOSIT_ADDRESS });
  });

  afterEach(() => ledger.restore());
  after(closeTestDatabase);

  it('duplicate CONFIRMING events create no second journal and no second posting', async () => {
    const first = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));
    const second = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    assert.equal(second.id, first.id);
    assert.equal(second.state, TRANSACTION_STATE.CONFIRMING.code);
    assert.equal(ledger.tables.journals.rows.length, 1);
    assert.equal(ledger.amountOf(BOOK.custodyConfirming('BTC')), QUANTITY);
    assert.equal(ledger.amountOf(BOOK.external('BTC')), `-${QUANTITY}`);
    assert.equal(ledger.tables.bookPostings.rows.length, 2);
    assert.equal(ledger.tables.journalHistories.rows.filter((row) => row.historyTransactionTypeId === HISTORY_EVENT_TYPE.CREATED).length, 1);
  });

  it('duplicate CONFIRMED events do not apply the deposit twice', async () => {
    const first = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));
    await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));
    const duplicate = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.state, TRANSACTION_STATE.CONFIRMED.code);
    assert.equal(duplicate.journalTransactionState, JOURNAL_TRANSACTION_STATE.COMPLETED);

    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);
    assert.equal(ledger.amountOf(BOOK.custodyConfirming('BTC')), '0');
    assert.equal(ledger.amountOf(BOOK.external('BTC')), `-${QUANTITY}`);
    assert.equal(ledger.tables.bookPostings.rows.length, 4);
    assert.equal(appliedHistories(ledger).length, 4);
    assert.equal(ledger.totalBalance(), 0n);

    assert.deepEqual(
      ledger.tables.journalHistories.rows.map((row) => row.historyTransactionTypeId),
      [HISTORY_EVENT_TYPE.CREATED, HISTORY_EVENT_TYPE.STATE_ADVANCED],
    );
  });

  it('repeated CONFIRMED as the only event stays a single journal with a single set of postings', async () => {
    const first = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));
    const third = await (async () => {
      await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

      return ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));
    })();

    assert.equal(third.id, first.id);
    assert.equal(ledger.tables.journals.rows.length, 1);
    assert.equal(ledger.tables.bookPostings.rows.length, 4);
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), QUANTITY);
    assert.equal(ledger.totalBalance(), 0n);
  });
});
