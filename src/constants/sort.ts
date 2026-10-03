import type { ValueOf } from '../types/common';

export const SORT_DIRECTION = {
  ASC: 'ASC',
  DESC: 'DESC',
} as const;

export type SortDirection = ValueOf<typeof SORT_DIRECTION>;
