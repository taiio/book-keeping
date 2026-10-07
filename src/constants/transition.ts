import type { ValueOf } from '../types/common';
import { BLOCKCHAIN_TRANSACTION_STATE_ID } from './blockchainTransactionState';
import { TRANSACTION_STATE } from './transactionState';
import { TRANSACTION_TYPE } from './transactionType';

export const TRANSITION_OUTCOME = {
  APPLIED: 'APPLIED',
  DUPLICATE: 'DUPLICATE',
  STALE: 'STALE',
} as const;

export type TransitionOutcome = ValueOf<typeof TRANSITION_OUTCOME>;

export const TRANSITION_DECISION = {
  APPLY: 'APPLY',
  CATCH_UP: 'CATCH_UP',
  DUPLICATE: TRANSITION_OUTCOME.DUPLICATE,
  STALE: TRANSITION_OUTCOME.STALE,
  EARLY: 'EARLY',
} as const;

const S = TRANSACTION_STATE;

export const ENTRY_STATES: Readonly<Record<number, number>> = {
  [TRANSACTION_TYPE.WITHDRAW]: S.AUTHORIZING.id,
  [TRANSACTION_TYPE.DEPOSIT]: S.CONFIRMING.id,
};

export const FORWARD_TRANSITIONS: Readonly<Record<number, Readonly<Record<number, readonly number[]>>>> = {
  [TRANSACTION_TYPE.WITHDRAW]: {
    [S.AUTHORIZING.id]: [S.AUTHORIZED.id],
    [S.AUTHORIZED.id]: [S.SENT.id],
    [S.SENT.id]: [S.CONFIRMING.id],
    [S.CONFIRMING.id]: [S.CONFIRMED.id],
  },
  [TRANSACTION_TYPE.DEPOSIT]: {
    [S.CONFIRMING.id]: [S.CONFIRMED.id],
  },
};

export const EXCEPTION_STATE_IDS: ReadonlySet<number> = new Set([S.REJECTED.id, S.FAILED.id]);

export const EXCEPTION_SOURCES: Readonly<Record<number, Readonly<Record<number, ReadonlyArray<number | null>>>>> = {
  [TRANSACTION_TYPE.WITHDRAW]: {
    [S.REJECTED.id]: [S.AUTHORIZING.id, S.AUTHORIZED.id],
    [S.FAILED.id]: [S.SENT.id, S.CONFIRMING.id],
  },
  [TRANSACTION_TYPE.DEPOSIT]: {
    [S.REJECTED.id]: [null],
    [S.FAILED.id]: [S.CONFIRMING.id, null],
  },
};

export const CATCH_UP_PATHS: Readonly<Record<number, Readonly<Record<number, Readonly<Record<number, readonly number[]>>>>>> = {
  [TRANSACTION_TYPE.WITHDRAW]: {
    [S.SENT.id]: { [S.CONFIRMED.id]: [S.CONFIRMING.id] },
  },
};

export const FEE_CONSUMING_STATES: ReadonlySet<number> = new Set([S.CONFIRMING.id]);

export const SUPPORTED_SYSTEM_STATE_IDS: readonly number[] = [S.AUTHORIZING.id, S.AUTHORIZED.id, S.SENT.id, S.REJECTED.id, S.FAILED.id];

export const SUPPORTED_BLOCKCHAIN_STATUS_IDS: readonly number[] = Object.values(BLOCKCHAIN_TRANSACTION_STATE_ID);
