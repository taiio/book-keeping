import { LedgerError, MessageRetryError, PoisonMessageError } from '../../common/errors';
import { createLogger, errorMeta } from '../../common/logger';
import { DEAD_LETTER_HEADER, DEAD_LETTER_ORIGIN, MESSAGE_OUTCOME, MESSAGING_LIMITS } from '../../constants';
import type { IDeadLetterPublisher } from '../../ports';
import type { ConsumedMessage, MessageDecision } from '../../types';
import { InboxService } from '../InboxService';
import { KafkaMessageDecoder } from './KafkaMessageDecoder';

const log = createLogger('kafka:handler');

const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

export class KafkaMessageHandler {
  private readonly decoder: KafkaMessageDecoder;
  private readonly inboxService: InboxService;
  private readonly deadLetterPublisher: IDeadLetterPublisher;

  constructor(decoder: KafkaMessageDecoder, inboxService: InboxService, deadLetterPublisher: IDeadLetterPublisher) {
    this.decoder = decoder;
    this.inboxService = inboxService;
    this.deadLetterPublisher = deadLetterPublisher;
  }

  async handle(message: ConsumedMessage): Promise<void> {
    const origin = { topic: message.topic, partition: message.partition, offset: message.offset, key: message.key };

    log.debug('message received', origin);

    const decision = await this.decide(message);

    if (decision.outcome === MESSAGE_OUTCOME.DEAD_LETTER) {
      log.error('message cannot be processed, sending to the dead-letter topic', { ...origin, reason: decision.reason });
      await this.deadLetter(message, decision.reason);
      return;
    }

    if (decision.outcome === MESSAGE_OUTCOME.RETRY) {
      log.warn('message failed, kafka will redeliver it', { ...origin, reason: decision.reason });
      throw new MessageRetryError(decision.reason);
    }

    log.debug('message acknowledged', origin);
  }

  private async decide(message: ConsumedMessage): Promise<MessageDecision> {
    try {
      const { kind, envelope } = this.decoder.decode(message);

      await this.inboxService.ingest(kind, envelope);

      return { outcome: MESSAGE_OUTCOME.ACK, reason: '' };
    } catch (error) {
      const outcome =
        error instanceof PoisonMessageError || (error instanceof LedgerError && !error.retryable)
          ? MESSAGE_OUTCOME.DEAD_LETTER
          : MESSAGE_OUTCOME.RETRY;

      return { outcome, reason: describe(error) };
    }
  }

  private async deadLetter(message: ConsumedMessage, reason: string): Promise<void> {
    try {
      await this.deadLetterPublisher.publish({
        key: message.key,
        value: message.value ?? '',
        headers: {
          ...message.headers,
          [DEAD_LETTER_HEADER.ORIGIN]: DEAD_LETTER_ORIGIN.CONSUMER,
          [DEAD_LETTER_HEADER.REASON]: reason.slice(0, MESSAGING_LIMITS.DEAD_LETTER_REASON_MAX_LENGTH),
          [DEAD_LETTER_HEADER.TOPIC]: message.topic,
          [DEAD_LETTER_HEADER.PARTITION]: String(message.partition),
          [DEAD_LETTER_HEADER.OFFSET]: message.offset,
        },
      });
    } catch (error) {
      log.error('dead-letter publish failed', { topic: message.topic, partition: message.partition, offset: message.offset, ...errorMeta(error) });
      throw new MessageRetryError(`dead letter publish failed: ${describe(error)}`);
    }
  }
}
