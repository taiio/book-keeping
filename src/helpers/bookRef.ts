import { BOOK_PURPOSE } from '../constants';
import type { BookRef } from '../types';

export const custodyBook = (stateId: number): BookRef => ({ bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id, transactionStateId: stateId });

export const externalBook = (): BookRef => ({ bookPurposeId: BOOK_PURPOSE.BLOCKCHAIN_EXTERNAL_ACCOUNT.id, transactionStateId: null });

export const isExternalBook = (ref: BookRef): boolean => ref.bookPurposeId === BOOK_PURPOSE.BLOCKCHAIN_EXTERNAL_ACCOUNT.id;

export const sameBookRef = (a: BookRef, b: BookRef): boolean => a.bookPurposeId === b.bookPurposeId && a.transactionStateId === b.transactionStateId;
