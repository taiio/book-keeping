import type { ConsumedMessage, RawKafkaMessage } from '../../types';

function headerValue(value: Buffer | string | Array<Buffer | string> | undefined): string | null {
  if (value === undefined) return null;

  const first = Array.isArray(value) ? value[0] : value;

  return first === undefined ? null : first.toString();
}

export function toConsumedMessage(topic: string, partition: number, message: RawKafkaMessage): ConsumedMessage {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(message.headers ?? {})) {
    const text = headerValue(value);

    if (text !== null) headers[name] = text;
  }

  return {
    topic,
    partition,
    offset: message.offset,
    key: message.key === null ? null : message.key.toString(),
    value: message.value === null ? null : message.value.toString(),
    headers,
  };
}
