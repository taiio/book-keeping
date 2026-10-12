import * as assert from 'node:assert/strict';

jest.mock('../../config/database', () => ({ sequelize: {} }));

import { InvalidTransitionError, TransitionNotReadyError } from '../../common/errors';
import { OUTBOX_EVENT_TYPE } from '../../constants';
import { OutboxRelay } from '../../messaging/OutboxRelay';
import { FakeUnitOfWork } from './messagingFakes';

function setup(events: Array<{ id: string; eventType: number }>, behavior: (id: string) => Promise<void>) {
  const log: Array<[string, string, boolean?]> = [];
  const claims: Array<readonly number[] | undefined> = [];
  let pending = [...events];

  const repo = {
    claimBatch: async (limit: number, _tx: unknown, eventTypes?: readonly number[]) => {
      claims.push(eventTypes);
      const batch = pending.slice(0, limit);
      pending = pending.slice(limit);
      return batch;
    },
    markPublished: async (id: string) => void log.push(['published', id]),
    recordFailure: async (id: string, _error: string, retryable: boolean) => void log.push(['failure', id, retryable]),
  };
  const registry = { get: () => ({ type: OUTBOX_EVENT_TYPE.STATE_CHANGED, handle: async (event: { id: string }) => behavior(event.id) }) };

  return { relay: new OutboxRelay(new FakeUnitOfWork() as never, repo as never, registry as never), log, claims };
}

describe('OutboxRelay', () => {
  it('publishes what the handler accepts', async () => {
    const { relay, log } = setup([{ id: '1', eventType: 1 }], async () => {});

    assert.deepEqual(await relay.runOnce(), { claimed: 1, published: 1, failed: 0 });
    assert.deepEqual(log, [['published', '1']]);
  });

  it('retries transient failures and stops on final ones, without blocking the rest of the batch', async () => {
    const behavior = async (id: string) => {
      if (id === '1') throw new Error('socket hang up');
      if (id === '2') throw new TransitionNotReadyError('x', null, 3);
      if (id === '3') throw new InvalidTransitionError('1', 5, 1);
    };
    const { relay, log } = setup(
      [
        { id: '1', eventType: 1 },
        { id: '2', eventType: 1 },
        { id: '3', eventType: 1 },
        { id: '4', eventType: 1 },
      ],
      behavior,
    );

    assert.deepEqual(await relay.runOnce(), { claimed: 4, published: 1, failed: 3 });
    assert.deepEqual(log, [['failure', '1', true], ['failure', '2', true], ['failure', '3', false], ['published', '4']]);
  });

  it('drain keeps claiming until nothing is left, so no event waits behind a full batch', async () => {
    const events = ['1', '2', '3', '4', '5'].map((id) => ({ id, eventType: OUTBOX_EVENT_TYPE.STATE_CHANGED }));
    const { relay, log } = setup(events, async () => {});

    assert.deepEqual(await relay.drain(2), { claimed: 5, published: 5, failed: 0 });
    assert.equal(log.length, 5);
  });

  it('passes the requested event types down to the claim', async () => {
    const { relay, claims } = setup([], async () => {});

    await relay.drain(10, [OUTBOX_EVENT_TYPE.BROADCAST_REQUESTED]);

    assert.deepEqual(claims[0], [OUTBOX_EVENT_TYPE.BROADCAST_REQUESTED]);
  });
});
