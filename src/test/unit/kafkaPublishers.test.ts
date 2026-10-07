import * as assert from 'node:assert/strict';

import { KAFKA_HEADER, OUTBOX_EVENT_TYPE } from '../../constants';
import { KafkaDeadLetterPublisher } from '../../messaging/kafka/KafkaDeadLetterPublisher';
import { KafkaEventPublisher } from '../../messaging/kafka/KafkaEventPublisher';
import type { OutboundMessage } from '../../types';

function fakeProducer() {
  const sent: Array<{ topic: string; message: OutboundMessage }> = [];

  return { sent, producer: { send: async (topic: string, message: OutboundMessage) => void sent.push({ topic, message }) } as never };
}

const event = (stateId: number, attempt = 1) => ({
  id: '1',
  aggregate: 'jt-token',
  eventType: OUTBOX_EVENT_TYPE.STATE_CHANGED,
  stateId,
  attempt,
  payload: { journalTransactionId: '5', transactionStateId: stateId },
});

describe('KafkaEventPublisher', () => {
  it('keys the message by aggregate and gives the same event the same event id every time', async () => {
    const { sent, producer } = fakeProducer();
    const publisher = new KafkaEventPublisher(producer, 'state-changed');

    await publisher.publish(event(3));
    await publisher.publish(event(3));
    await publisher.publish(event(4));

    assert.equal(sent[0].topic, 'state-changed');
    assert.equal(sent[0].message.key, 'jt-token');
    assert.deepEqual(JSON.parse(sent[0].message.value), { journalTransactionId: '5', transactionStateId: 3 });
    assert.equal(sent[0].message.headers[KAFKA_HEADER.EVENT_ID], sent[1].message.headers[KAFKA_HEADER.EVENT_ID]);
    assert.notEqual(sent[0].message.headers[KAFKA_HEADER.EVENT_ID], sent[2].message.headers[KAFKA_HEADER.EVENT_ID]);
  });
});

describe('KafkaDeadLetterPublisher', () => {
  it('sends the message unchanged to the dead letter topic', async () => {
    const { sent, producer } = fakeProducer();
    const message: OutboundMessage = { key: 'k', value: 'v', headers: { a: 'b' } };

    await new KafkaDeadLetterPublisher(producer, 'dlq').publish(message);

    assert.deepEqual(sent, [{ topic: 'dlq', message }]);
  });
});
