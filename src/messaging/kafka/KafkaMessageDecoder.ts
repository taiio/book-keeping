import { PoisonMessageError } from '../../common/errors';
import { KAFKA_HEADER } from '../../constants';
import type { InboxEventKindId } from '../../constants';
import type { ConsumedMessage, DecodedMessage, TopicRoute } from '../../types';

export class KafkaMessageDecoder {
  private readonly kinds: ReadonlyMap<string, InboxEventKindId>;

  constructor(routes: readonly TopicRoute[]) {
    this.kinds = new Map(routes.map((route) => [route.topic, route.kind]));
  }

  decode(message: ConsumedMessage): DecodedMessage {
    const kind = this.kinds.get(message.topic);
    console.log(`kind: ${kind}, message: ${JSON.parse(JSON.stringify(message) )}`);
    if (kind === undefined) throw new PoisonMessageError(`no route for topic ${message.topic}`);

    if (message.value === null) throw new PoisonMessageError('empty message value');

    const body = this.parse(message.value);
    const eventId = message.headers[KAFKA_HEADER.EVENT_ID] ?? body.eventId;

    if (typeof eventId !== 'string' || eventId.length === 0) throw new PoisonMessageError('missing eventId');
    return { kind, envelope: { eventId, source: message.topic, payload: body } };
  }

  private parse(value: string): Record<string, unknown> {
    let body: unknown;

    try {
      body = JSON.parse(value);
    } catch {
      throw new PoisonMessageError('message value is not valid JSON');
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new PoisonMessageError('message value must be a JSON object');

    return body as Record<string, unknown>;
  }
}
