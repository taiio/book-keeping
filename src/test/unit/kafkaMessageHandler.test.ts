import * as assert from 'node:assert/strict';

jest.mock('../../config/database', () => ({ sequelize: {} }));

import { IdempotencyConflictError, MessageRetryError, ValidationError } from '../../common/errors';
import { DEAD_LETTER_HEADER, DEAD_LETTER_ORIGIN, INBOX_EVENT_KIND, INBOX_EVENT_STATUS, KAFKA_HEADER } from '../../constants';
import type { InboxEventStatusId } from '../../constants';
import { KafkaMessageDecoder } from '../../messaging/kafka/KafkaMessageDecoder';
import { KafkaMessageHandler } from '../../messaging/kafka/KafkaMessageHandler';
import type { ConsumedMessage, OutboundMessage } from '../../types';

const message = (overrides: Partial<ConsumedMessage> = {}): ConsumedMessage => ({
  topic: 'system',
  partition: 2,
  offset: '77',
  key: 'k-1',
  value: JSON.stringify({ uuidToken: 'u-1' }),
  headers: { [KAFKA_HEADER.EVENT_ID]: 'evt-1' },
  ...overrides,
});

function setup(options: { ingest?: () => Promise<InboxEventStatusId>; publish?: () => Promise<void> } = {}) {
  const ingested: Array<{ kind: number; envelope: any }> = [];
  const deadLetters: OutboundMessage[] = [];

  const inbox = {
    ingest: async (kind: number, envelope: unknown) => {
      ingested.push({ kind, envelope });

      return (options.ingest ?? (async () => INBOX_EVENT_STATUS.APPLIED))();
    },
  };
  const publisher = {
    publish: async (outbound: OutboundMessage) => {
      await (options.publish ?? (async () => {}))();
      deadLetters.push(outbound);
    },
  };
  const decoder = new KafkaMessageDecoder([{ topic: 'system', kind: INBOX_EVENT_KIND.SYSTEM_TRANSACTION }]);

  return { handler: new KafkaMessageHandler(decoder, inbox as never, publisher), ingested, deadLetters };
}

describe('KafkaMessageHandler', () => {
  it('stores the message in the inbox and acknowledges it', async () => {
    const { handler, ingested, deadLetters } = setup();

    await handler.handle(message());

    assert.equal(ingested.length, 1);
    assert.equal(ingested[0].kind, INBOX_EVENT_KIND.SYSTEM_TRANSACTION);
    assert.equal(ingested[0].envelope.eventId, 'evt-1');
    assert.equal(deadLetters.length, 0);
  });

  it('acknowledges whatever the inbox decided, because the message is stored and the inbox owns it from there', async () => {
    for (const status of Object.values(INBOX_EVENT_STATUS)) {
      await assert.doesNotReject(() => setup({ ingest: async () => status }).handler.handle(message()));
    }
  });

  it('sends a message that can never be processed to the dead letter topic, with where it came from', async () => {
    const { handler, ingested, deadLetters } = setup();

    await handler.handle(message({ value: '{not json' }));

    assert.equal(ingested.length, 0);
    assert.equal(deadLetters.length, 1);
    assert.equal(deadLetters[0].key, 'k-1');
    assert.equal(deadLetters[0].value, '{not json');
    assert.equal(deadLetters[0].headers[DEAD_LETTER_HEADER.ORIGIN], DEAD_LETTER_ORIGIN.CONSUMER);
    assert.equal(deadLetters[0].headers[DEAD_LETTER_HEADER.TOPIC], 'system');
    assert.equal(deadLetters[0].headers[DEAD_LETTER_HEADER.PARTITION], '2');
    assert.equal(deadLetters[0].headers[DEAD_LETTER_HEADER.OFFSET], '77');
    assert.equal(deadLetters[0].headers[KAFKA_HEADER.EVENT_ID], 'evt-1');
    assert.match(deadLetters[0].headers[DEAD_LETTER_HEADER.REASON], /Poison message/);
  });

  it('sends a message the inbox refuses for good to the dead letter topic', async () => {
    for (const error of [new IdempotencyConflictError('evt-1', 'different payload'), new ValidationError('eventId too long')]) {
      const { handler, deadLetters } = setup({
        ingest: async () => {
          throw error;
        },
      });

      await handler.handle(message());

      assert.equal(deadLetters.length, 1);
    }
  });

  it('asks for redelivery on a transient failure and does not dead-letter it', async () => {
    const { handler, deadLetters } = setup({
      ingest: async () => {
        throw new Error('connection refused');
      },
    });

    await assert.rejects(() => handler.handle(message()), MessageRetryError);

    assert.equal(deadLetters.length, 0);
  });

  it('never drops a message when the dead letter topic itself is unavailable', async () => {
    const { handler } = setup({
      publish: async () => {
        throw new Error('broker not available');
      },
    });

    await assert.rejects(() => handler.handle(message({ value: null })), MessageRetryError);
  });
});
