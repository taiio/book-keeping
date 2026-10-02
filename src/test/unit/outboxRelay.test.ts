import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InvalidTransitionError, TransitionNotReadyError } from '../../common/errors';
import { OUTBOX_EVENT_TYPE } from '../../constants';
import { OutboxRelay } from '../../messaging/OutboxRelay';
import { FakeUnitOfWork } from './messagingFakes';

function setup(events: Array<{ id: string; eventType: number }>, behavior: (id: string) => Promise<void>) {
  const log: Array<[string, string, boolean?]> = [];

  const repo = {
    claimBatch: async () => events,
    markPublished: async (id: string) => void log.push(['published', id]),
    recordFailure: async (id: string, _error: string, retryable: boolean) => void log.push(['failure', id, retryable]),
  };
  const registry = { get: () => ({ type: OUTBOX_EVENT_TYPE.STATE_CHANGED, handle: async (event: { id: string }) => behavior(event.id) }) };

  return { relay: new OutboxRelay(new FakeUnitOfWork() as never, repo as never, registry as never), log };
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
      if (id === '3') throw new InvalidTransitionError(1, 5, 1);
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
});
