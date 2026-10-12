import { ValidationError } from '../common/errors';

export function parseBigIntColumn(value: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) throw new ValidationError(`BIGINT value is outside the safe integer range: ${value}`);

  return parsed;
}
