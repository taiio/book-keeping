import { ENTRY_STATES, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';
import { custodyBook, externalBook } from '../helpers/bookRef';
import type { BookRef, LedgerMovement } from '../types';

const S = TRANSACTION_STATE;

export const LEDGER_MOVEMENTS: Readonly<Record<number, Readonly<Record<number, LedgerMovement>>>> = {
  [TRANSACTION_TYPE.WITHDRAW]: {
    [S.AUTHORIZING.id]: { from: custodyBook(S.CONFIRMED.id), to: custodyBook(S.AUTHORIZING.id) },
    [S.AUTHORIZED.id]: { from: custodyBook(S.AUTHORIZING.id), to: custodyBook(S.AUTHORIZED.id) },
    [S.SENT.id]: { from: custodyBook(S.AUTHORIZED.id), to: custodyBook(S.SENT.id) },
    [S.CONFIRMING.id]: { from: custodyBook(S.SENT.id), to: custodyBook(S.CONFIRMING.id) },
    [S.CONFIRMED.id]: { from: custodyBook(S.CONFIRMING.id), to: externalBook() },
  },
  [TRANSACTION_TYPE.DEPOSIT]: {
    [S.CONFIRMING.id]: { from: externalBook(), to: custodyBook(S.CONFIRMING.id) },
    [S.CONFIRMED.id]: { from: custodyBook(S.CONFIRMING.id), to: custodyBook(S.CONFIRMED.id) },
  },
};

export function originOf(transactionTypeId: number): BookRef | undefined {
  return LEDGER_MOVEMENTS[transactionTypeId]?.[ENTRY_STATES[transactionTypeId]]?.from;
}

export function holdingBookAt(transactionTypeId: number, stateId: number): BookRef | undefined {
  return LEDGER_MOVEMENTS[transactionTypeId]?.[stateId]?.to;
}
