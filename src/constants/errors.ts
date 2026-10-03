import type { ValueOf } from '../types/common';

export const ERROR_DISPOSITION = {
  RETRYABLE: 'RETRYABLE',
  NON_RETRYABLE: 'NON_RETRYABLE',
} as const;

export type ErrorDisposition = ValueOf<typeof ERROR_DISPOSITION>;
