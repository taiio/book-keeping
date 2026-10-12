import * as assert from 'node:assert/strict';

jest.mock('../../config/database', () => ({ sequelize: {} }));

import { IdempotencyConflictError, InvalidTransitionError, TransactionHashConflictError } from '../../common/errors';
import {
  DEAD_LETTER_HEADER,
  DEAD_LETTER_ORIGIN,
  DEAD_LETTER_STATE_ID,
  INBOX_EVENT_KIND,
  INBOX_EVENT_STATUS,
  KAFKA_HEADER,
  MESSAGING_LIMITS,
  OUTBOX_EVENT_TYPE,
} from '../../constants';
import { InboxProcessor } from '../../messaging/InboxProcessor';
import { InboxService } from '../../messaging/InboxService';
import { DeadLetterOutboxHandler } from '../../messaging/outboxHandlers/DeadLetterOutboxHandler';
import type { DeadLetterPayload, OutboundMessage } from '../../types';
import { FakeInboxRepository, FakeLedger, FakeOutboxRepository, FakeUnitOfWork } from './messagingFakes';

let repo: FakeInboxRepository;
let outbox: FakeOutboxRepository;
let service: InboxService;
let processor: InboxProcessor;

beforeEach(() => {
  repo = new FakeInboxRepository();
  outbox = new FakeOutboxRepository();

  const ledger = new FakeLedger();

  processor = new InboxProcessor(new FakeUnitOfWork() as never, repo as never, ledger.registry as never, outbox as never);
  service = new InboxService(new FakeUnitOfWork() as never, repo as never, ledger.registry as never, processor);
});

const ingest = (eventId: string, payload: Record<string, unknown>) =>
  service.ingest(INBOX_EVENT_KIND.SYSTEM_TRANSACTION, { eventId, source: 'topic-a', payload: { id: eventId, key: 'k-1', ...payload } });

describe('dead letter events from the inbox', () => {
  it('queues one dead letter, in the same transaction, when an event ends as ERROR', async () => {
    assert.equal(await ingest('bad', { fail: new InvalidTransitionError('1', 5, 1) }), INBOX_EVENT_STATUS.ERROR);

    assert.equal(outbox.enqueued.length, 1);

    const [entry] = outbox.enqueued;
    const payload = entry.payload as DeadLetterPayload;

    assert.equal(entry.eventType, OUTBOX_EVENT_TYPE.DEAD_LETTERED);
    assert.equal(entry.aggregate, 'bad');
    assert.equal(entry.stateId, DEAD_LETTER_STATE_ID.INBOX);
    assert.equal(payload.origin, DEAD_LETTER_ORIGIN.INBOX);
    assert.equal(payload.eventId, 'bad');
    assert.equal(payload.key, 'k-1');
    assert.equal(payload.source, 'topic-a');
    assert.match(payload.reason, /Invalid transition/);
    assert.equal((payload.payload as { id: string }).id, 'bad');
  });

  it('also dead-letters a conflict', async () => {
    assert.equal(await ingest('c1', { fail: new TransactionHashConflictError('1', 'a', 'b') }), INBOX_EVENT_STATUS.CONFLICT);
    assert.equal(await ingest('c2', { fail: new IdempotencyConflictError('t', 'differs') }), INBOX_EVENT_STATUS.CONFLICT);

    assert.equal(outbox.enqueued.length, 2);
  });

  it('dead-letters an event whose retries ran out, and one that waited too long', async () => {
    await ingest('t1', { fail: new Error('deadlock detected') });
    repo.events[0].attempts = MESSAGING_LIMITS.INBOX_MAX_ATTEMPTS - 1;
    await processor.process('1');

    await ingest('p1', { needs: 'never' });
    repo.events[1].firstReceivedAt = new Date(Date.now() - MESSAGING_LIMITS.PARK_MAX_AGE_MS - 1000);
    await processor.process('2');

    assert.deepEqual(
      outbox.enqueued.map((entry) => (entry.payload as DeadLetterPayload).reason.split('.')[0]),
      ['Retries exhausted', 'Waited too long for a predecessor'],
    );
  });

  it('does not dead-letter an event that is only waiting, or failed for a transient reason', async () => {
    await ingest('early', { needs: 'first' });
    await ingest('t2', { fail: new Error('socket hang up') });
    await ingest('ok', {});

    assert.equal(outbox.enqueued.length, 0);
  });

  it('does not dead-letter a replay of an event that already ended as ERROR', async () => {
    await ingest('bad', { fail: new InvalidTransitionError('1', 5, 1) });
    await ingest('bad', { fail: new InvalidTransitionError('1', 5, 1) });

    assert.equal(outbox.enqueued.length, 1);
  });
});

describe('DeadLetterOutboxHandler', () => {
  const deadLetter: DeadLetterPayload = {
    origin: DEAD_LETTER_ORIGIN.INBOX,
    reason: 'x'.repeat(5000),
    eventId: 'evt-1',
    key: 'key-1',
    kind: INBOX_EVENT_KIND.SYSTEM_TRANSACTION,
    source: 'topic-a',
    attempts: 3,
    payload: { amount: '10' },
  };

  it('publishes the original payload with the failure details in the headers', async () => {
    const sent: OutboundMessage[] = [];
    const handler = new DeadLetterOutboxHandler({ publish: async (message: OutboundMessage) => void sent.push(message) });

    await handler.handle({ id: '9', aggregate: 'evt-1', eventType: OUTBOX_EVENT_TYPE.DEAD_LETTERED, stateId: DEAD_LETTER_STATE_ID.INBOX, attempt: 1, payload: deadLetter });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].key, 'key-1');
    assert.deepEqual(JSON.parse(sent[0].value), { amount: '10' });
    assert.equal(sent[0].headers[DEAD_LETTER_HEADER.ORIGIN], DEAD_LETTER_ORIGIN.INBOX);
    assert.equal(sent[0].headers[DEAD_LETTER_HEADER.SOURCE], 'topic-a');
    assert.equal(sent[0].headers[DEAD_LETTER_HEADER.ATTEMPTS], '3');
    assert.equal(sent[0].headers[KAFKA_HEADER.EVENT_ID], 'evt-1');
    assert.equal(sent[0].headers[DEAD_LETTER_HEADER.REASON].length, MESSAGING_LIMITS.DEAD_LETTER_REASON_MAX_LENGTH);
  });
});
