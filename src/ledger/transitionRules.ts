import { EXCEPTION_STATE_IDS, JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE } from '../constants';
import type { JournalTransactionStateId } from '../constants';

export const isExceptionState = (stateId: number): boolean => EXCEPTION_STATE_IDS.has(stateId);

export function journalStateForTarget(targetStateId: number): JournalTransactionStateId | null {
  switch (targetStateId) {
    case TRANSACTION_STATE.CONFIRMED.id:
      return JOURNAL_TRANSACTION_STATE.COMPLETED;
    case TRANSACTION_STATE.REJECTED.id:
      return JOURNAL_TRANSACTION_STATE.REJECTED;
    case TRANSACTION_STATE.FAILED.id:
      return JOURNAL_TRANSACTION_STATE.FAILED;
    default:
      return null;
  }
}
