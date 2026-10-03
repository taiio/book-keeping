import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { IdempotencyConflictError, InvalidTransitionError, TransactionHashConflictError } from '../../common/errors';
import { INBOX_EVENT_KIND, INBOX_EVENT_STATUS, MESSAGING_LIMITS, TRANSITION_OUTCOME } from '../../constants';
import { InboxProcessor } from '../../messaging/InboxProcessor';
import { InboxService } from '../../messaging/InboxService';
import { FakeInboxRepository, FakeLedger, FakeUnitOfWork } from './messagingFakes';

let repo: FakeInboxRepository;
let ledger: FakeLedger;
let service: InboxService;
let processor: InboxProcessor;

const KIND = INBOX_EVENT_KIND.SYSTEM_TRANSACTION;
const S = INBOX_EVENT_STATUS;

beforeEach(() => {
  repo = new FakeInboxRepository();
  ledger = new FakeLedger();
  processor = new InboxProcessor(new FakeUnitOfWork() as never, repo as never, ledger.registry as never);
  service = new InboxService(new FakeUnitOfWork() as never, repo as never, ledger.registry as never, processor);
});

const ingest = (eventId: string, payload: Record<string, unknown>) => service.ingest(KIND, { eventId, payload: { id: eventId, ...payload } });

describe('InboxService replay handling', () => {
  it('applies a message once and counts later deliveries without touching the ledger', async () => {
    assert.equal(await ingest('e1', {}), S.APPLIED);

    for (let i = 0; i < 5; i++) assert.equal(await ingest('e1', {}), S.APPLIED);

    assert.equal(ledger.calls, 1);
    assert.equal(repo.events[0].deliveryCount, 6);
    assert.equal(repo.events.length, 1);
  });

  it('refuses the same event id with a different payload and keeps the original untouched', async () => {
    await ingest('e1', { amount: '1' });

    await assert.rejects(() => ingest('e1', { amount: '2' }), IdempotencyConflictError);

    assert.equal(repo.events[0].status, S.APPLIED);
    assert.equal(ledger.calls, 1);
  });

  it('records a replay of the ledger as DUPLICATE and an already-passed state as STALE', async () => {
    assert.equal(await ingest('d1', { outcome: TRANSITION_OUTCOME.DUPLICATE }), S.DUPLICATE);
    assert.equal(await ingest('s1', { outcome: TRANSITION_OUTCOME.STALE }), S.STALE);
  });

  it('rejects a missing or oversized event id', async () => {
    await assert.rejects(() => service.ingest(KIND, { eventId: '', payload: {} }));
    await assert.rejects(() => service.ingest(KIND, { eventId: 'x'.repeat(65), payload: {} }));
  });
});

describe('out-of-order messages', () => {
  it('parks an event that arrives early, without using up an attempt', async () => {
    assert.equal(await ingest('late', { needs: 'first' }), S.PENDING);

    assert.equal(repo.events[0].attempts, 0);
    assert.match(repo.events[0].lastError ?? '', /not ready/i);
  });

  it('applies the parked event as soon as its predecessor is applied', async () => {
    await ingest('late', { needs: 'first' });
    await ingest('later', { needs: 'late' });

    assert.equal(await ingest('first', {}), S.APPLIED);

    assert.deepEqual(
      repo.events.map((event) => [event.eventId, event.status]),
      [['late', S.APPLIED], ['later', S.APPLIED], ['first', S.APPLIED]],
    );
    assert.deepEqual([...ledger.applied], ['first', 'late', 'later']);
  });

  it('a redelivery of a parked event retries it', async () => {
    await ingest('late', { needs: 'first' });
    ledger.applied.add('first');

    assert.equal(await ingest('late', { needs: 'first' }), S.APPLIED);
    assert.equal(repo.events[0].deliveryCount, 2);
  });

  it('gives up on an event that waited too long', async () => {
    await ingest('late', { needs: 'never' });
    repo.events[0].firstReceivedAt = new Date(Date.now() - MESSAGING_LIMITS.PARK_MAX_AGE_MS - 1000);

    assert.equal(await processor.process('1'), S.ERROR);
    assert.match(repo.events[0].lastError ?? '', /too long/i);
  });
});

describe('failures', () => {
  it('marks a non-retryable ledger error as ERROR', async () => {
    assert.equal(await ingest('bad', { fail: new InvalidTransitionError(1, 5, 1) }), S.ERROR);
    assert.match(repo.events[0].lastError ?? '', /Invalid transition/);
  });

  it('marks idempotency or hash conflicts as CONFLICT', async () => {
    assert.equal(await ingest('c1', { fail: new TransactionHashConflictError(1, 'a', 'b') }), S.CONFLICT);
    assert.equal(await ingest('c2', { fail: new IdempotencyConflictError('t', 'differs') }), S.CONFLICT);
  });

  it('retries an unknown (transient) error with backoff, then gives up', async () => {
    assert.equal(await ingest('t1', { fail: new Error('deadlock detected') }), S.PENDING);
    assert.equal(repo.events[0].attempts, 1);
    assert.ok(repo.events[0].nextAttemptAt.getTime() > Date.now());

    repo.events[0].attempts = MESSAGING_LIMITS.INBOX_MAX_ATTEMPTS - 1;

    assert.equal(await processor.process('1'), S.ERROR);
    assert.match(repo.events[0].lastError ?? '', /Retries exhausted/);
  });

  it('processDue skips events that are not due yet, drainParked does not', async () => {
    await ingest('late', { needs: 'first' });
    ledger.applied.add('first');

    const due = await processor.processDue();

    assert.equal(due.processed, 0);
    assert.equal(repo.events[0].status, S.PENDING);

    const drained = await processor.drainParked();

    assert.equal(drained.applied, 1);
    assert.equal(repo.events[0].status, S.APPLIED);
  });
});
