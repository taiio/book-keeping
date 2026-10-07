import * as assert from 'node:assert/strict';

import { PoisonMessageError } from '../../common/errors';
import { INBOX_EVENT_KIND, KAFKA_HEADER } from '../../constants';
import { toConsumedMessage } from '../../messaging/kafka/consumedMessage';
import { KafkaMessageDecoder } from '../../messaging/kafka/KafkaMessageDecoder';
import type { ConsumedMessage } from '../../types';

const decoder = new KafkaMessageDecoder([
  { topic: 'system', kind: INBOX_EVENT_KIND.SYSTEM_TRANSACTION },
  { topic: 'chain', kind: INBOX_EVENT_KIND.BLOCKCHAIN_EVENT },
]);

const message = (overrides: Partial<ConsumedMessage> = {}): ConsumedMessage => ({
  topic: 'system',
  partition: 0,
  offset: '10',
  key: 'k',
  value: JSON.stringify({ uuidToken: 'u-1' }),
  headers: { [KAFKA_HEADER.EVENT_ID]: 'evt-1' },
  ...overrides,
});

describe('KafkaMessageDecoder', () => {
  it('routes by topic and takes the event id from the header', () => {
    const decoded = decoder.decode(message());

    assert.equal(decoded.kind, INBOX_EVENT_KIND.SYSTEM_TRANSACTION);
    assert.equal(decoded.envelope.eventId, 'evt-1');
    assert.equal(decoded.envelope.source, 'system');
    assert.deepEqual(decoded.envelope.payload, { uuidToken: 'u-1' });
    assert.equal(decoder.decode(message({ topic: 'chain' })).kind, INBOX_EVENT_KIND.BLOCKCHAIN_EVENT);
  });

  it('falls back to an eventId field in the body, and prefers the header when both exist', () => {
    assert.equal(decoder.decode(message({ headers: {}, value: JSON.stringify({ eventId: 'from-body' }) })).envelope.eventId, 'from-body');
    assert.equal(decoder.decode(message({ value: JSON.stringify({ eventId: 'from-body' }) })).envelope.eventId, 'evt-1');
  });

  it('treats a message that can never be processed as poison', () => {
    const poison = [
      message({ topic: 'unknown' }),
      message({ value: null }),
      message({ value: '{not json' }),
      message({ value: '[1, 2]' }),
      message({ value: '"text"' }),
      message({ headers: {} }),
      message({ headers: { [KAFKA_HEADER.EVENT_ID]: '' } }),
      message({ headers: {}, value: JSON.stringify({ eventId: 42 }) }),
    ];

    for (const item of poison) assert.throws(() => decoder.decode(item), PoisonMessageError);
  });
});

describe('toConsumedMessage', () => {
  it('turns kafkajs buffers into text, keeps the first value of a repeated header and drops missing ones', () => {
    const consumed = toConsumedMessage('system', 3, {
      key: Buffer.from('k-1'),
      value: Buffer.from('{"a":1}'),
      offset: '42',
      headers: { 'event-id': Buffer.from('evt-9'), repeated: ['first', Buffer.from('second')], missing: undefined, plain: 'text' },
    });

    assert.deepEqual(consumed, {
      topic: 'system',
      partition: 3,
      offset: '42',
      key: 'k-1',
      value: '{"a":1}',
      headers: { 'event-id': 'evt-9', repeated: 'first', plain: 'text' },
    });
  });

  it('keeps a missing key, value or headers as null or empty', () => {
    const consumed = toConsumedMessage('system', 0, { key: null, value: null, offset: '1' });

    assert.equal(consumed.key, null);
    assert.equal(consumed.value, null);
    assert.deepEqual(consumed.headers, {});
  });
});
