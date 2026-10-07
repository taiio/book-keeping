import { container } from '../../config/container';
import { env } from '../../config/env';
import { INBOX_EVENT_KIND, OUTBOX_EVENT_TYPE } from '../../constants';
import { BLOCKCHAIN_SUBMITTER, DEAD_LETTER_PUBLISHER, EVENT_PUBLISHER } from '../../ports';
import type { IBlockchainSubmitter } from '../../ports';
import type { MessagingRuntime, TopicRoute } from '../../types';
import { InboxProcessor } from '../InboxProcessor';
import { InboxService } from '../InboxService';
import { KafkaConnection } from '../kafka/KafkaConnection';
import { KafkaConsumerRunner } from '../kafka/KafkaConsumerRunner';
import { KafkaDeadLetterPublisher } from '../kafka/KafkaDeadLetterPublisher';
import { KafkaEventPublisher } from '../kafka/KafkaEventPublisher';
import { KafkaMessageDecoder } from '../kafka/KafkaMessageDecoder';
import { KafkaMessageHandler } from '../kafka/KafkaMessageHandler';
import { KafkaProducerClient } from '../kafka/KafkaProducerClient';
import { OutboxRelay } from '../OutboxRelay';
import { UnconfiguredBlockchainSubmitter } from '../UnconfiguredBlockchainSubmitter';
import { IntervalWorker } from '../workers/IntervalWorker';

export async function startMessaging(): Promise<MessagingRuntime> {
  const settings = env.kafka;
  const routes: TopicRoute[] = [
    { topic: settings.systemTopic, kind: INBOX_EVENT_KIND.SYSTEM_TRANSACTION },
    { topic: settings.blockchainTopic, kind: INBOX_EVENT_KIND.BLOCKCHAIN_EVENT },
  ];

  const connection = new KafkaConnection(settings);
  const producer = new KafkaProducerClient(connection);

  await producer.connect();

  const deadLetterPublisher = new KafkaDeadLetterPublisher(producer, settings.deadLetterTopic);

  container.registerInstance(EVENT_PUBLISHER, new KafkaEventPublisher(producer, settings.stateChangedTopic));
  container.registerInstance(DEAD_LETTER_PUBLISHER, deadLetterPublisher);

  const processor = container.resolve(InboxProcessor);
  const relay = container.resolve(OutboxRelay);
  const handler = new KafkaMessageHandler(new KafkaMessageDecoder(routes), container.resolve(InboxService), deadLetterPublisher);
  const consumer = new KafkaConsumerRunner(
    connection,
    handler,
    routes.map((route) => route.topic),
    settings.fromBeginning,
  );

  const { batchSize, inboxIntervalMs, broadcastIntervalMs, outboxIntervalMs } = env.workers;
  const workers = [
    new IntervalWorker('inbox', () => processor.processDue(batchSize), inboxIntervalMs),
    new IntervalWorker('outbox', () => relay.drain(batchSize, [OUTBOX_EVENT_TYPE.STATE_CHANGED, OUTBOX_EVENT_TYPE.DEAD_LETTERED]), outboxIntervalMs),
  ];

  if (container.resolve<IBlockchainSubmitter>(BLOCKCHAIN_SUBMITTER) instanceof UnconfiguredBlockchainSubmitter) {
    console.warn(
      '[messaging] no IBlockchainSubmitter registered: the broadcast worker is not started, so withdraws stay SENT until one is registered',
    );
  } else {
    workers.push(new IntervalWorker('broadcast', () => relay.drain(batchSize, [OUTBOX_EVENT_TYPE.BROADCAST_REQUESTED]), broadcastIntervalMs));
  }

  await consumer.start();

  for (const worker of workers) worker.start();

  console.log('[messaging] consumer and workers started');

  return {
    async stop() {
      await consumer.stop();
      await Promise.all(workers.map((worker) => worker.stop()));
      await producer.disconnect();
    },
  };
}
