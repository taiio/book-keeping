import { createHash } from 'crypto';

const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** Name-based (v5) uuid: the same name always yields the same uuid. Used where a producer did not supply one. */
export function deterministicUuid(name: string): string {
  const hash = createHash('sha1').update(Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex')).update(name).digest();

  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.subarray(0, 16).toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
