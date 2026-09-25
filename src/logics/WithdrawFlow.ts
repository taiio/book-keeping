import { autoInjectable, singleton } from 'tsyringe';

import { JournalTransaction } from '../models';
import { UnitOfWork } from '../common/UnitOfWork';
import { BookRepository, BookPostingRepository, JournalTransactionRepository } from '../repositories';
import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE } from '../constants';
import { BaseTransactionRequest } from './types';

export interface WithdrawRequest extends BaseTransactionRequest {
  fee: string;
}

export type WithdrawTargetState = 'AUTHORIZED' | 'SENT' | 'CONFIRMING' | 'CONFIRMED';

/**
 * Withdraw lifecycle:
 *   AUTHORIZING -> AUTHORIZED -> SENT -> CONFIRMING -> CONFIRMED
 *
 * Books:
 *   1. CLIENT_ASSET_ACCOUNT    / quantity
 *   2. EXTERNAL_ACCOUNT        / quantity
 *   3. CLIENT_ASSET_ACCOUNT    / fee
 *   4. BLOCKCHAIN_CONTROL_ACCOUNT / fee (custody giữ phí)
 *
 * AUTHORIZED: CLIENT -amount, EXTERNAL +amount, CLIENT -fee, CUSTODY +fee.
 * SENT / CONFIRMING / CONFIRMED: chỉ đổi trạng thái, không có thêm bút toán
 * (vị thế external đã được giữ chỗ từ lúc AUTHORIZED).
 */
@singleton()
@autoInjectable()
export class WithdrawFlow {
  private readonly unitOfWork: UnitOfWork;
  private readonly journalTransactionRepository: JournalTransactionRepository;
  private readonly bookRepository: BookRepository;
  private readonly bookPostingRepository: BookPostingRepository;

  constructor(
    unitOfWork?: UnitOfWork,
    journalTransactionRepository?: JournalTransactionRepository,
    bookRepository?: BookRepository,
    bookPostingRepository?: BookPostingRepository,
  ) {
    this.unitOfWork = unitOfWork!;
    this.journalTransactionRepository = journalTransactionRepository!;
    this.bookRepository = bookRepository!;
    this.bookPostingRepository = bookPostingRepository!;
  }

  // async create(request: WithdrawRequest): Promise<JournalTransaction> {
  //   return this.unitOfWork.execute(async (tx) => {
  //     const journalTransaction = await this.journalTransactionRepository.getOrCreateJournalTransaction(
  //       {
  //         idempotencyToken: request.idempotencyToken,
  //         uuidToken: request.uuidToken,
  //         transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
  //         fromAccountId: request.accountId,
  //         toAccountId: null,
  //         transactionHash: request.transactionHash,
  //         createdBy: request.createdBy,
  //         journalTransactionStateId: JOURNAL_TRANSACTION_STATE.ACTIVE,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED,
  //       },
  //       tx,
  //     );

  //     const book1 = await this.bookRepository.getOrCreateBook(
  //       {
  //         idempotencyToken: `withdraw:${journalTransaction.id}:client-quantity`,
  //         name: `withdraw:${journalTransaction.id}:client-quantity`,
  //         bookPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
  //         transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
  //         clientId: request.clientId,
  //         accountId: request.accountId,
  //         assetId: request.assetId,
  //         assetTypeId: request.assetTypeId,
  //         assetTicker: request.assetTicker,
  //         walletTypeId: request.walletTypeId,
  //         address: request.address,
  //         createdBy: request.createdBy,
  //       },
  //       tx,
  //     );

  //     const book2 = await this.bookRepository.getOrCreateBook(
  //       {
  //         idempotencyToken: `withdraw:${journalTransaction.id}:external-quantity`,
  //         name: `withdraw:${journalTransaction.id}:external-quantity`,
  //         bookPurposeId: BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
  //         transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
  //         clientId: null,
  //         accountId: null,
  //         assetId: request.assetId,
  //         assetTypeId: request.assetTypeId,
  //         assetTicker: request.assetTicker,
  //         walletTypeId: request.walletTypeId,
  //         address: request.address,
  //         createdBy: request.createdBy,
  //       },
  //       tx,
  //     );

  //     const book3 = await this.bookRepository.getOrCreateBook(
  //       {
  //         idempotencyToken: `withdraw:${journalTransaction.id}:client-fee`,
  //         name: `withdraw:${journalTransaction.id}:client-fee`,
  //         bookPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
  //         transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
  //         clientId: request.clientId,
  //         accountId: request.accountId,
  //         assetId: request.assetId,
  //         assetTypeId: request.assetTypeId,
  //         assetTicker: request.assetTicker,
  //         walletTypeId: request.walletTypeId,
  //         address: null,
  //         createdBy: request.createdBy,
  //       },
  //       tx,
  //     );

  //     const book4 = await this.bookRepository.getOrCreateBook(
  //       {
  //         idempotencyToken: `withdraw:${journalTransaction.id}:custody-fee`,
  //         name: `withdraw:${journalTransaction.id}:custody-fee`,
  //         bookPurposeId: BOOK_PURPOSE.BLOCKCHAIN_CONTROL_ACCOUNT.id,
  //         transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
  //         clientId: null,
  //         accountId: null,
  //         assetId: request.assetId,
  //         assetTypeId: request.assetTypeId,
  //         assetTicker: request.assetTicker,
  //         walletTypeId: request.walletTypeId,
  //         address: null,
  //         createdBy: request.createdBy,
  //       },
  //       tx,
  //     );

  //     await this.bookPostingRepository.createBookPosting(
  //       {
  //         bookId: book1.id,
  //         journalTransactionId: journalTransaction.id,
  //         amount: `-${request.amount}`,
  //         assetTypeId: request.assetTypeId,
  //         bookPostingPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
  //         idempotencyToken: `${request.idempotencyToken}:authorized:client-quantity`,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
  //         createdBy: request.createdBy,
  //       },
  //       tx,
  //     );

  //     await this.bookPostingRepository.createBookPosting(
  //       {
  //         bookId: book2.id,
  //         journalTransactionId: journalTransaction.id,
  //         amount: request.amount,
  //         assetTypeId: request.assetTypeId,
  //         bookPostingPurposeId: BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
  //         idempotencyToken: `${request.idempotencyToken}:authorized:external-quantity`,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
  //         createdBy: request.createdBy,
  //       },
  //       tx,
  //     );

  //     if (request.fee !== '0') {
  //       await this.bookPostingRepository.createBookPosting(
  //         {
  //           bookId: book1.id,
  //           journalTransactionId: journalTransaction.id,
  //           amount: `-${request.fee}`,
  //           assetTypeId: request.assetTypeId,
  //           bookPostingPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
  //           idempotencyToken: `${request.idempotencyToken}:authorized:client-fee`,
  //           historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
  //           createdBy: request.createdBy,
  //         },
  //         tx,
  //       );

  //       await this.bookPostingRepository.createBookPosting(
  //         {
  //           bookId: book2.id,
  //           journalTransactionId: journalTransaction.id,
  //           amount: request.fee,
  //           assetTypeId: request.assetTypeId,
  //           bookPostingPurposeId: BOOK_PURPOSE.BLOCKCHAIN_CONTROL_ACCOUNT.id,
  //           idempotencyToken: `${request.idempotencyToken}:authorized:custody-fee`,
  //           historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
  //           createdBy: request.createdBy,
  //         },
  //         tx,
  //       );
  //     }

  //     return journalTransaction;
  //   });
  // }

  // async advance(
  //   journalTransactionId: number,
  //   targetState: WithdrawTargetState,
  //   transactionHash?: string | null,
  //   updatedBy?: number | null,
  // ): Promise<JournalTransaction> {
  //   return this.unitOfWork.execute(async (tx) => {
  //     return this.journalTransactionRepository.updateJournalTransaction(
  //       {
  //         journalTransactionId,
  //         targetStateId: TRANSACTION_STATE[targetState].id,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
  //         transactionHash,
  //         updatedBy,
  //         completeJournal: targetState === 'CONFIRMED',
  //       },
  //       tx,
  //     );
  //   });
  // }
}
