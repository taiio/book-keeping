import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';

import { BroadcastRejectedError } from '../common/errors';
import { createLogger, errorMeta } from '../common/logger';
import { sequelize } from '../config/database';
import { container } from '../config/container';
import {
  BLOCKCHAIN_TRANSACTION_STATE_ID,
  BOOK_PURPOSE,
  INBOX_EVENT_KIND,
  INBOX_EVENT_STATUS,
  INBOX_SOURCE,
  JOURNAL_TRANSACTION_STATE,
  OUTBOX_EVENT_TYPE,
  TRANSACTION_STATE,
  TRANSACTION_TYPE,
} from '../constants';
import { BlockchainEventHandler } from '../handlers/BlockchainEventHandler';
import { SystemTransactionHandler } from '../handlers/SystemTransactionHandler';
import { InboxProcessor } from '../messaging/InboxProcessor';
import { InboxService } from '../messaging/InboxService';
import { OutboxRelay } from '../messaging/OutboxRelay';
import { Book, InboxEvent, JournalTransaction } from '../models';
import { BLOCKCHAIN_SUBMITTER } from '../ports';
import type { IBlockchainSubmitter } from '../ports';
import type { AccountIdentity, BlockchainMessagePayload, TransitionResult, Withdraw } from '../types';
import { direct } from './support/direct';
import type { DirectHandler } from './support/types';

const S = TRANSACTION_STATE;
const USDT = { assetTypeId: 1, assetId: 1, ticker: 'USDT' };
const ETH = { assetTypeId: 2, assetId: 2, ticker: 'ETH' };

const identity = (accountId: number, asset: { assetTypeId: number; assetId: number }): AccountIdentity => ({
  clientId: 1,
  accountId,
  walletTypeId: 1,
  assetTypeId: asset.assetTypeId,
  assetId: asset.assetId,
});

async function amountOf(accountId: number, assetTypeId: number, stateId: number | null): Promise<bigint> {
  const bookPurposeId = stateId === null ? BOOK_PURPOSE.BLOCKCHAIN_EXTERNAL_ACCOUNT.id : BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id;
  const book = await Book.findOne({ where: { accountId, assetTypeId, bookPurposeId, transactionStateId: stateId } });

  return BigInt(book?.amount ?? '0');
}

async function fund(
  blockchain: DirectHandler<BlockchainMessagePayload, TransitionResult[]>,
  account: AccountIdentity,
  ticker: string,
  quantity: string,
): Promise<void> {
  const payload: BlockchainMessagePayload = {
    transactionHash: randomBytes(32).toString('hex'),
    status: S.CONFIRMING.id,
    senders: [{ address: randomBytes(12).toString('hex'), assetTicker: ticker, quantity }],
    recipients: [{ idempotencyToken: randomUUID(), address: randomBytes(12).toString('hex'), assetTicker: ticker, quantity, account }],
    networkFee: { idempotencyToken: randomUUID(), payerAddress: randomBytes(12).toString('hex'), assetTicker: ticker, quantity: '0' },
  };

  await blockchain.handle(payload);
  await blockchain.handle({ ...payload, status: S.CONFIRMED.id });
}

function scenario(user: AccountIdentity, feePayer: AccountIdentity) {
  const uuidToken = randomUUID();
  const senderToken = randomUUID();
  const feeToken = randomUUID();
  const transactionHash = randomBytes(32).toString('hex');

  const withdraw = (transactionStateId: number): Withdraw => ({
    type: TRANSACTION_TYPE.WITHDRAW,
    uuidToken,
    transactionStateId,
    sender: [{ idempotencyToken: senderToken, address: 'user-address', assetTicker: USDT.ticker, quantity: '600', account: user }],
    recipient: [{ idempotencyToken: randomUUID(), address: 'outside-address', assetTicker: USDT.ticker, quantity: '600' }],
    fee: { idempotencyToken: feeToken, assetTicker: ETH.ticker, quantity: '10', account: feePayer },
  });

  const chain = (status: BlockchainMessagePayload['status'], realFee = '8'): BlockchainMessagePayload => ({
    transactionHash,
    blockNumber: randomInt(1_000_000),
    status,
    senders: [{ idempotencyToken: senderToken, address: 'user-address', assetTicker: USDT.ticker, quantity: '600', account: user }],
    recipients: [{ address: 'outside-address', assetTicker: USDT.ticker, quantity: '600' }],
    networkFee: { idempotencyToken: feeToken, payerAddress: 'fee-address', assetTicker: ETH.ticker, quantity: realFee, account: feePayer },
  });

  return { withdraw, chain, transactionHash, uuidToken };
}

const log = createLogger('test:failure-and-replay');

async function main(): Promise<void> {
  const hashes = new Map<string, string>();
  const hashOf = (uuidToken: string) => hashes.get(uuidToken) ?? createHash('sha256').update(uuidToken).digest('hex');

  const rejected = new Set<string>();
  const submitter: IBlockchainSubmitter = {
    async submit(transaction) {
      if (rejected.has(transaction.uuidToken)) throw new BroadcastRejectedError('the node rejected the transaction');

      return { transactionHash: hashOf(transaction.uuidToken) };
    },
  };

  container.registerInstance(BLOCKCHAIN_SUBMITTER, submitter);

  const system = direct(container.resolve(SystemTransactionHandler));
  const blockchain = direct(container.resolve(BlockchainEventHandler));
  const broadcast = async () => {
    const summary = await container.resolve(OutboxRelay).drain(100, [OUTBOX_EVENT_TYPE.BROADCAST_REQUESTED]);

    assert.equal(summary.failed, 0);
  };

  const newCase = async () => {
    const user = identity(randomInt(1_000_000, 9_000_000), USDT);
    const feePayer = identity(randomInt(1_000_000, 9_000_000), ETH);

    await fund(blockchain, user, USDT.ticker, '1000');
    await fund(blockchain, feePayer, ETH.ticker, '100');

    const flow = scenario(user, feePayer);

    hashes.set(flow.uuidToken, flow.transactionHash);

    const externalBefore = {
      user: await amountOf(user.accountId, USDT.assetTypeId, null),
      feePayer: await amountOf(feePayer.accountId, ETH.assetTypeId, null),
    };

    return { user, feePayer, externalBefore, ...flow };
  };

  {
    const { user, feePayer, withdraw } = await newCase();

    await system.handle(withdraw(S.AUTHORIZING.id));
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.CONFIRMED.id), 400n);

    await system.handle(withdraw(S.AUTHORIZED.id));

    const first = await system.handle(withdraw(S.REJECTED.id));
    const replay = await system.handle(withdraw(S.REJECTED.id));

    assert.equal(first.processed, true);
    assert.equal(replay.processed, false);
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.CONFIRMED.id), 1000n);
    assert.equal(await amountOf(feePayer.accountId, ETH.assetTypeId, S.CONFIRMED.id), 100n);
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.AUTHORIZED.id), 0n);
    assert.equal(await amountOf(feePayer.accountId, ETH.assetTypeId, S.AUTHORIZED.id), 0n);

    log.info('A. rejected + replay: ok');
  }

  {
    const { user, feePayer, withdraw, chain, externalBefore } = await newCase();

    for (const state of [S.AUTHORIZING.id, S.AUTHORIZED.id, S.SENT.id]) await system.handle(withdraw(state));

    await broadcast();
    await blockchain.handle(chain(S.CONFIRMING.id));
    await blockchain.handle(chain(BLOCKCHAIN_TRANSACTION_STATE_ID.FAILED, '8'));

    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.CONFIRMED.id), 1000n);
    assert.equal(await amountOf(feePayer.accountId, ETH.assetTypeId, S.CONFIRMED.id), 92n);
    assert.equal((await amountOf(feePayer.accountId, ETH.assetTypeId, null)) - externalBefore.feePayer, 8n);
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.CONFIRMING.id), 0n);

    log.info('B. failed after mining: ok');
  }

  {
    const { user, feePayer, withdraw, chain, externalBefore } = await newCase();
    const inbox = container.resolve(InboxService);
    const processor = container.resolve(InboxProcessor);

    for (const state of [S.AUTHORIZING.id, S.AUTHORIZED.id, S.SENT.id]) {
      await inbox.ingest(INBOX_EVENT_KIND.SYSTEM_TRANSACTION, { eventId: randomUUID(), payload: withdraw(state) });
    }

    const confirming = { eventId: randomUUID(), payload: chain(S.CONFIRMING.id) };

    assert.equal(await inbox.ingest(INBOX_EVENT_KIND.BLOCKCHAIN_EVENT, confirming), INBOX_EVENT_STATUS.PENDING);

    await broadcast();
    await processor.drainParked();

    assert.equal((await InboxEvent.findOne({ where: { eventId: confirming.eventId } }))!.status, INBOX_EVENT_STATUS.APPLIED);

    const confirmed = { eventId: randomUUID(), payload: chain(S.CONFIRMED.id, '8') };

    for (let i = 0; i < 3; i++) await inbox.ingest(INBOX_EVENT_KIND.BLOCKCHAIN_EVENT, confirmed);

    const stored = (await InboxEvent.findOne({ where: { eventId: confirmed.eventId } }))!;

    assert.equal(stored.status, INBOX_EVENT_STATUS.APPLIED);
    assert.equal(stored.deliveryCount, 3);
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.CONFIRMED.id), 400n);
    assert.equal((await amountOf(user.accountId, USDT.assetTypeId, null)) - externalBefore.user, 600n);
    assert.equal(await amountOf(feePayer.accountId, ETH.assetTypeId, S.CONFIRMED.id), 92n);
    assert.equal((await amountOf(feePayer.accountId, ETH.assetTypeId, null)) - externalBefore.feePayer, 8n);

    await inbox.ingest(INBOX_EVENT_KIND.BLOCKCHAIN_EVENT, { eventId: randomUUID(), payload: chain(S.CONFIRMING.id) });
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.CONFIRMED.id), 400n);

    log.info('C. inbox out-of-order + replay: ok');
  }

  {
    const { user, feePayer, withdraw, uuidToken } = await newCase();

    rejected.add(uuidToken);

    for (const state of [S.AUTHORIZING.id, S.AUTHORIZED.id, S.SENT.id]) await system.handle(withdraw(state));

    await broadcast();

    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.CONFIRMED.id), 1000n);
    assert.equal(await amountOf(feePayer.accountId, ETH.assetTypeId, S.CONFIRMED.id), 100n);
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.SENT.id), 0n);
    assert.equal(await amountOf(feePayer.accountId, ETH.assetTypeId, S.SENT.id), 0n);

    const journals = await JournalTransaction.findAll({ where: { uuidToken } });

    assert.ok(journals.length > 0);
    assert.ok(journals.every((journal: JournalTransaction) => journal.journalTransactionState === JOURNAL_TRANSACTION_STATE.FAILED));

    const closing = await InboxEvent.findOne({ where: { source: INBOX_SOURCE.BROADCAST_RELAY, orderingKey: uuidToken } });

    assert.equal(closing!.status, INBOX_EVENT_STATUS.APPLIED);

    await broadcast();
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.CONFIRMED.id), 1000n);

    log.info('D. rejected broadcast closes the withdraw: ok');
  }

  {
    const { user, withdraw, chain } = await newCase();
    const inbox = container.resolve(InboxService);

    for (const state of [S.AUTHORIZING.id, S.AUTHORIZED.id, S.SENT.id]) await system.handle(withdraw(state));

    await broadcast();

    const tampered = chain(S.CONFIRMING.id);

    tampered.recipients = [{ ...tampered.recipients[0], quantity: '599' }];

    assert.equal(await inbox.ingest(INBOX_EVENT_KIND.BLOCKCHAIN_EVENT, { eventId: randomUUID(), payload: tampered }), INBOX_EVENT_STATUS.ERROR);
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.SENT.id), 600n);
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.CONFIRMING.id), 0n);

    assert.equal(
      await inbox.ingest(INBOX_EVENT_KIND.BLOCKCHAIN_EVENT, { eventId: randomUUID(), payload: chain(S.CONFIRMING.id) }),
      INBOX_EVENT_STATUS.APPLIED,
    );
    assert.equal(await amountOf(user.accountId, USDT.assetTypeId, S.CONFIRMING.id), 600n);

    log.info('E. conservation check: ok');
  }

  log.info('failure-and-replay flows completed');
  await sequelize.close();
}

main().catch((error) => {
  log.error('flow failed', errorMeta(error));
  process.exit(1);
});
