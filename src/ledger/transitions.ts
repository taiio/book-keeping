import { JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';
import type { JournalTransactionStateId } from '../constants';

const S = TRANSACTION_STATE;

/** The first state a journal transaction of each type enters. */
export const ENTRY_STATES: Readonly<Record<number, number>> = {
  [TRANSACTION_TYPE.WITHDRAW]: S.AUTHORIZING.id,
  [TRANSACTION_TYPE.DEPOSIT]: S.CONFIRMING.id,
};

/** Happy-path transitions (the only legal way forward). */
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

/** Exception states close a journal transaction. CONFIRMED is never closed this way. */
export const EXCEPTION_STATE_IDS: ReadonlySet<number> = new Set([S.REJECTED.id, S.FAILED.id]);

export const isExceptionState = (stateId: number): boolean => EXCEPTION_STATE_IDS.has(stateId);

/**
 * States an exception state can be entered from. `null` means the transaction has no state yet, which is how a
 * recipient journal transaction of an internal withdraw looks until the blockchain reports it.
 */
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

/**
 * Intermediate states that can be applied on behalf of a missing event, e.g. CONFIRMED received while the
 * transaction is still SENT implies CONFIRMING. Only for states the blockchain drives and whose legs are known.
 */
export const CATCH_UP_PATHS: Readonly<Record<number, Readonly<Record<number, Readonly<Record<number, readonly number[]>>>>>> = {
  [TRANSACTION_TYPE.WITHDRAW]: {
    [S.SENT.id]: { [S.CONFIRMED.id]: [S.CONFIRMING.id] },
  },
};

/** The network fee is only really spent once the transaction was mined. */
export const FEE_CONSUMING_STATES: ReadonlySet<number> = new Set([S.CONFIRMING.id]);

/** Journal-level state a journal transaction moves to when it reaches `targetStateId` (null: stays ACTIVE). */
export function journalStateForTarget(targetStateId: number): JournalTransactionStateId | null {
  switch (targetStateId) {
    case S.CONFIRMED.id:
      return JOURNAL_TRANSACTION_STATE.COMPLETED;
    case S.REJECTED.id:
      return JOURNAL_TRANSACTION_STATE.REJECTED;
    case S.FAILED.id:
      return JOURNAL_TRANSACTION_STATE.FAILED;
    default:
      return null;
  }
}
