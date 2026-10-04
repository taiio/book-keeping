import * as assert from 'node:assert/strict';

jest.mock('../../config/database', () => ({ sequelize: {} }));

import { ConservationError } from '../../common/errors';
import { BLOCKCHAIN_TRANSACTION_STATE_ID, TRANSACTION_STATE, TRANSACTION_TYPE, TRANSITION_OUTCOME } from '../../constants';
import type { TransitionOutcome } from '../../constants';
import { BlockchainEventHandler } from '../../handlers/BlockchainEventHandler';
import type { BlockchainMessagePayload } from '../../types';
import { FakeUnitOfWork } from './messagingFakes';

const HASH = 'a'.repeat(64);
const SENDER_TOKEN = '1c7a3d2f-9b55-4e2c-8d66-4b2e8f0a31d3';
const FEE_TOKEN = '2d8b4e3a-0c66-4f3d-9e77-5c3f9a1b42e4';
const account = { clientId: 1, accountId: 1, assetId: 1, assetTypeId: 1, walletTypeId: 1 };

const payload = (status: BlockchainMessagePayload['status']): BlockchainMessagePayload => ({
  transactionHash: HASH,
  status,
  senders: [{ idempotencyToken: SENDER_TOKEN, address: 'a', assetTicker: 'USDT', quantity: '100', account }],
  recipients: [
    { idempotencyToken: '3e9c5f4b-1d77-4a4e-8f88-6d4a0b2c53f5', address: 'x', assetTicker: 'USDT', quantity: '60', account: { ...account, accountId: 2 } },
    { address: 'outside', assetTicker: 'USDT', quantity: '40' },
  ],
  networkFee: { idempotencyToken: FEE_TOKEN, payerAddress: 'p', assetTicker: 'ETH', quantity: '1' },
});

function setup(outcome: TransitionOutcome, verifyFails = false) {
  const journalTransaction = { id: '1', idempotencyToken: SENDER_TOKEN, transactionTypeId: TRANSACTION_TYPE.WITHDRAW, fromAccountId: 1 };
  const verified: Array<{ external: unknown; context: string }> = [];

  const pipeline = {
    findByTransactionHash: async () => [journalTransaction],
    findByIdempotencyTokens: async () => [],
    processTransition: async () => [{ journalTransactionId: '1', outcome }],
  };
  const verifier = {
    verifyWithdrawSettlement: async (_journalTransactions: unknown, external: unknown, context: string) => {
      verified.push({ external, context });

      if (verifyFails) throw new ConservationError(context, 'USDT', 100n, 99n);
    },
  };

  return { handler: new BlockchainEventHandler(new FakeUnitOfWork() as never, pipeline as never, verifier as never), verified };
}

describe('BlockchainEventHandler settlement check', () => {
  it('verifies the settlement against the postings after an advancing event was applied', async () => {
    const { handler, verified } = setup(TRANSITION_OUTCOME.APPLIED);

    await handler.handle(payload(TRANSACTION_STATE.CONFIRMING.id));

    assert.equal(verified.length, 1);
    assert.deepEqual(verified[0].external, [{ address: 'outside', assetTicker: 'USDT', quantity: '40' }]);
  });

  it('skips a replay or a stale event, which changed nothing', async () => {
    for (const outcome of [TRANSITION_OUTCOME.DUPLICATE, TRANSITION_OUTCOME.STALE]) {
      const { handler, verified } = setup(outcome);

      await handler.handle(payload(TRANSACTION_STATE.CONFIRMED.id));

      assert.equal(verified.length, 0);
    }
  });

  it('never blocks a failure report', async () => {
    const { handler, verified } = setup(TRANSITION_OUTCOME.APPLIED);

    await handler.handle(payload(BLOCKCHAIN_TRANSACTION_STATE_ID.FAILED));

    assert.equal(verified.length, 0);
  });

  it('lets a violation abort the whole event', async () => {
    const { handler } = setup(TRANSITION_OUTCOME.APPLIED, true);

    await assert.rejects(() => handler.handle(payload(TRANSACTION_STATE.CONFIRMING.id)), ConservationError);
  });
});
