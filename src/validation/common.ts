import { ValidationError } from '../common/errors';
import { VALIDATION_PATTERN } from '../constants';

export const isUuid = (value: unknown): value is string => typeof value === 'string' && VALIDATION_PATTERN.UUID.test(value);

export const isPositiveIntegerString = (value: unknown): value is string => typeof value === 'string' && VALIDATION_PATTERN.POSITIVE_INTEGER.test(value);

export const isNonNegativeIntegerString = (value: unknown): value is string => typeof value === 'string' && VALIDATION_PATTERN.NON_NEGATIVE_INTEGER.test(value);

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
