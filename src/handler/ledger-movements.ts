import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';

const S = TRANSACTION_STATE;

export type BookRef = { bookPurposeId: number; transactionStateId: number | null };

export type LedgerMovement = { from: BookRef; to: BookRef };

export const custodyBook = (stateId: number): BookRef => ({ bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id, transactionStateId: stateId });

export const externalBook = (): BookRef => ({ bookPurposeId: BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.id, transactionStateId: null });

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
