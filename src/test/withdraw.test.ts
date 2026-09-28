import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import { BLOCKCHAIN_TRANSACTION_STATUS, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE } from '../constants';
import type { BlockchainMessagePayload, BlockchainTransactionStatus, Withdraw } from '../interfaces';
import { BOOK, TEST_ACCOUNT, closeTestDatabase, createTestLedger, type TestLedger } from './support/inMemoryLedger';

const TRANSACTION_HASH = '0xwithdraw-1';
const SENDER_ADDRESS = 'addr-sender-1';
const RECIPIENT_ADDRESS = 'addr-external-1';

const INITIAL_BALANCE = '10000';
const AMOUNT = '1000';
const FEE = '10';

// Amount và fee cùng asset (cùng 1 book) — reserve phải kiểm tra số dư theo tổng (1010), không theo từng vế.
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

describe('WITHDRAW — happy path', () => {
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

  it('reserves amount + fee and reaches SENT (AUTHORIZING -> AUTHORIZED -> SENT)', async () => {
    const entity = await ledger.systemTransactionHandler.handle(withdraw);

    assert.equal(entity.type, 'WITHDRAW');
    assert.equal(entity.state, TRANSACTION_STATE.SENT.code);
    assert.equal(entity.journalTransactionState, JOURNAL_TRANSACTION_STATE.ACTIVE);
    assert.equal(entity.transactionHash, TRANSACTION_HASH);
    assert.equal(entity.errorMessage, undefined);

    // 1010 chuyển từ bucket khả dụng sang bucket AUTHORIZING; chưa có gì ra external.
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), '8990');
    assert.equal(ledger.amountOf(BOOK.custodyAuthorizing('BTC')), '1010');
    assert.equal(ledger.amountOf(BOOK.external('BTC')), undefined);

    // amount + fee = 2 movement độc lập = 4 posting (2 cặp đối nhau).
    assert.equal(ledger.tables.bookPostings.rows.length, 4);
    assert.equal(ledger.totalPosted(), 0n);

    assert.deepEqual(
      ledger.tables.journalHistories.rows.map((row) => row.historyTransactionTypeId),
      [HISTORY_EVENT_TYPE.CREATED, HISTORY_EVENT_TYPE.STATE_ADVANCED, HISTORY_EVENT_TYPE.STATE_ADVANCED],
    );
  });

  it('settles the reserved funds to the external book once the blockchain confirms (SENT -> CONFIRMING -> CONFIRMED)', async () => {
    const sent = await ledger.systemTransactionHandler.handle(withdraw);

    const confirming = await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    assert.equal(confirming.id, sent.id);
    assert.equal(confirming.state, TRANSACTION_STATE.CONFIRMING.code);
    assert.equal(confirming.journalTransactionState, JOURNAL_TRANSACTION_STATE.ACTIVE);
    assert.equal(ledger.amountOf(BOOK.custodyAuthorizing('BTC')), '1010', 'nothing settles before CONFIRMED');

    const confirmed = await ledger.blockchainEventHandler.handle(withdrawEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    assert.equal(confirmed.id, sent.id);
    assert.equal(confirmed.state, TRANSACTION_STATE.CONFIRMED.code);
    assert.equal(confirmed.journalTransactionState, JOURNAL_TRANSACTION_STATE.COMPLETED);

    // Bucket AUTHORIZING được chốt sạch sang external; số dư khả dụng giữ nguyên sau reserve.
    assert.equal(ledger.amountOf(BOOK.custodyAvailable('BTC')), '8990');
    assert.equal(ledger.amountOf(BOOK.custodyAuthorizing('BTC')), '0');
    assert.equal(ledger.amountOf(BOOK.external('BTC')), '1010');

    // 4 posting của reserve + 4 posting của settle; tiền không tự sinh ra hay mất đi.
    assert.equal(ledger.tables.bookPostings.rows.length, 8);
    assert.equal(ledger.totalPosted(), 0n);
    assert.equal(ledger.totalBalance(), BigInt(INITIAL_BALANCE));
    assert.equal(ledger.tables.journals.rows.length, 1);
  });
});
