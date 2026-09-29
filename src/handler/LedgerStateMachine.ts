import { InvalidTransitionError } from '../common/errors';
import { JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';

const S = TRANSACTION_STATE;

const ENTRY_STATES: Readonly<Record<number, number>> = {
  [TRANSACTION_TYPE.WITHDRAW]: S.AUTHORIZING.id,
  [TRANSACTION_TYPE.DEPOSIT]: S.CONFIRMING.id,
};

const TRANSITIONS: Readonly<Record<number, Readonly<Record<number, number[]>>>> = {
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

export class LedgerStateMachine {
  validate(
    transactionTypeId: number,
    currentStateId: number | null,
    targetStateId: number,
    journalTransactionId: number,
    journalTransactionState: number,
  ): void {
    const entryState = ENTRY_STATES[transactionTypeId];
    const transitions = TRANSITIONS[transactionTypeId];

    if (entryState === undefined || !transitions) throw new InvalidTransitionError(journalTransactionId, currentStateId, targetStateId);

    if (currentStateId === null) {
      if (targetStateId !== entryState) throw new InvalidTransitionError(journalTransactionId, currentStateId, targetStateId);
      return;
    }

    const allowedTargets = transitions[currentStateId] ?? [];

    if (allowedTargets.includes(targetStateId)) {
      if (journalTransactionState !== JOURNAL_TRANSACTION_STATE.ACTIVE)
        throw new InvalidTransitionError(journalTransactionId, currentStateId, targetStateId);
      return;
    }

    throw new InvalidTransitionError(journalTransactionId, currentStateId, targetStateId);
  }
}
