import * as assert from 'node:assert/strict';

jest.mock('../../config/database', () => ({ sequelize: {} }));

import { BroadcastClosureError, TransitionNotReadyError } from '../../common/errors';
import { BroadcastRejectedError } from '../../common/errors';
import {
  INBOX_EVENT_KIND,
  INBOX_EVENT_STATUS,
  INBOX_SOURCE,
  JOURNAL_TRANSACTION_STATE,
  OUTBOX_EVENT_TYPE,
  SYSTEM_EVENT_NAME,
  TRANSACTION_STATE,
  TRANSACTION_TYPE,
} from '../../constants';
import type { InboxEventStatusId } from '../../constants';
import { deterministicUuid } from '../../helpers';
import { BroadcastOutboxHandler } from '../../messaging/outboxHandlers/BroadcastOutboxHandler';
import { FakeUnitOfWork } from './messagingFakes';

const UUID = '0b6f2c1e-8a44-4d1b-9c55-3a1d7e9f20c2';
const HASH = 'f'.repeat(64);

const journal = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  transactionTypeId: TRANSACTION_TYPE.WITHDRAW,
  transactionHash: null,
  journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
  ...overrides,
});

const event = {
  id: '1',
  aggregate: UUID,
  eventType: OUTBOX_EVENT_TYPE.BROADCAST_REQUESTED,
  stateId: TRANSACTION_STATE.SENT.id,
  attempt: 1,
  payload: { type: TRANSACTION_TYPE.WITHDRAW, uuidToken: UUID, transactionStateId: TRANSACTION_STATE.SENT.id, sender: [], recipient: [], fee: {} },
};

function setup(options: { journals?: unknown[]; submit?: () => Promise<{ transactionHash: string }>; ingestStatus?: InboxEventStatusId } = {}) {
  const calls = { submits: 0, attached: [] as Array<{ ids: string[]; hash: string }>, ingests: [] as Array<{ kind: number; envelope: any }> };
  const journals = options.journals ?? [journal('1'), journal('2'), journal('3', { transactionTypeId: TRANSACTION_TYPE.DEPOSIT })];

  const pipeline = {
    findByUuidToken: async () => journals,
    attachTransactionHash: async (ids: string[], hash: string) => void calls.attached.push({ ids, hash }),
  };
  const submitter = {
    submit: async () => {
      calls.submits += 1;
      return (options.submit ?? (async () => ({ transactionHash: HASH })))();
    },
  };
  const inbox = {
    ingest: async (kind: number, envelope: unknown) => {
      calls.ingests.push({ kind, envelope });
      return options.ingestStatus ?? INBOX_EVENT_STATUS.APPLIED;
    },
  };

  const handler = new BroadcastOutboxHandler(new FakeUnitOfWork() as never, pipeline as never, submitter as never, inbox as never);

  return { handler, calls };
}

const reject = async () => {
  throw new BroadcastRejectedError('insufficient funds for gas');
};

describe('BroadcastOutboxHandler', () => {
  it('submits and stores the hash on every journal transaction of the withdraw', async () => {
    const { handler, calls } = setup();

    await handler.handle(event);

    assert.equal(calls.submits, 1);
    assert.deepEqual(calls.attached, [{ ids: ['1', '2', '3'], hash: HASH }]);
    assert.equal(calls.ingests.length, 0);
  });

  it('does not submit again once a hash is stored', async () => {
    const { handler, calls } = setup({ journals: [journal('1', { transactionHash: HASH }), journal('2')] });

    await handler.handle(event);

    assert.equal(calls.submits, 0);
    assert.equal(calls.attached.length, 0);
  });

  it('never submits a withdraw that was already closed', async () => {
    const { handler, calls } = setup({ journals: [journal('1', { journalTransactionState: JOURNAL_TRANSACTION_STATE.FAILED })] });

    await handler.handle(event);

    assert.equal(calls.submits, 0);
  });

  it('closes the withdraw as FAILED when the node rejects it for good', async () => {
    const { handler, calls } = setup({ submit: reject });

    await handler.handle(event);

    assert.equal(calls.attached.length, 0);
    assert.equal(calls.ingests.length, 1);

    const [{ kind, envelope }] = calls.ingests;

    assert.equal(kind, INBOX_EVENT_KIND.SYSTEM_TRANSACTION);
    assert.equal(envelope.source, INBOX_SOURCE.BROADCAST_RELAY);
    assert.equal(envelope.eventId, deterministicUuid(`${SYSTEM_EVENT_NAME.BROADCAST_REJECTED}:${UUID}`));
    assert.equal(envelope.payload.transactionStateId, TRANSACTION_STATE.FAILED.id);
    assert.equal(envelope.payload.uuidToken, UUID);
  });

  it('uses the same event id on every attempt, so closing twice is a replay', async () => {
    const first = setup({ submit: reject });
    const second = setup({ submit: reject });

    await first.handler.handle(event);
    await second.handler.handle(event);

    assert.equal(first.calls.ingests[0].envelope.eventId, second.calls.ingests[0].envelope.eventId);
  });

  it('accepts a closing that was already applied or recognized as a replay', async () => {
    for (const status of [INBOX_EVENT_STATUS.APPLIED, INBOX_EVENT_STATUS.DUPLICATE, INBOX_EVENT_STATUS.STALE]) {
      await assert.doesNotReject(() => setup({ submit: reject, ingestStatus: status }).handler.handle(event));
    }
  });

  it('retries later when the closing is still pending', async () => {
    await assert.rejects(() => setup({ submit: reject, ingestStatus: INBOX_EVENT_STATUS.PENDING }).handler.handle(event), TransitionNotReadyError);
  });

  it('reports a closing that could not be applied, instead of hiding it', async () => {
    for (const status of [INBOX_EVENT_STATUS.ERROR, INBOX_EVENT_STATUS.CONFLICT]) {
      await assert.rejects(() => setup({ submit: reject, ingestStatus: status }).handler.handle(event), BroadcastClosureError);
    }
  });

  it('does not close the withdraw on an uncertain failure such as a timeout', async () => {
    const { handler, calls } = setup({
      submit: async () => {
        throw new Error('socket hang up');
      },
    });

    await assert.rejects(() => handler.handle(event), /socket hang up/);

    assert.equal(calls.ingests.length, 0);
  });

  it('waits when the withdraw has no journal transaction yet', async () => {
    const { handler, calls } = setup({ journals: [] });

    await assert.rejects(() => handler.handle(event), TransitionNotReadyError);

    assert.equal(calls.submits, 0);
  });
});
