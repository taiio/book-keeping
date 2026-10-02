import { ValidationError } from '../common/errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

export const isPositiveIntegerString = (value: unknown): value is string => typeof value === 'string' && POSITIVE_INTEGER_PATTERN.test(value);

export const isNonNegativeIntegerString = (value: unknown): value is string => typeof value === 'string' && NON_NEGATIVE_INTEGER_PATTERN.test(value);

export function assertUuid(value: unknown, label: string): asserts value is string {
  if (!isUuid(value)) throw new ValidationError(`${label} must be a uuid: ${String(value)}`);
}

export function assertPositiveQuantity(value: unknown, label: string): asserts value is string {
  if (!isPositiveIntegerString(value)) throw new ValidationError(`${label} must be a positive integer string: ${String(value)}`);
}

export function assertPresent<T>(value: T | null | undefined, label: string): asserts value is T {
  if (value === null || value === undefined || (typeof value === 'string' && value.length === 0)) {
    throw new ValidationError(`${label} is required`);
  }
}

export function assertNonNegativeQuantity(value: unknown, label: string): asserts value is string {
  if (!isNonNegativeIntegerString(value)) throw new ValidationError(`${label} must be a non-negative integer string: ${String(value)}`);
}
