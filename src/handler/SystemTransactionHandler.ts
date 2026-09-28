import { Transaction as SequelizeTransaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { UnitOfWork } from '../common/UnitOfWork';
import { JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE, TRANSACTION_STATE_SEQUENCE, TRANSACTION_TYPE } from '../constants';
import { NOT_WIRED_SUBMITTER, getAccountingLegs, toTransactionEntity } from '../helpers';
import {
  AuthorizeResult,
  BlockchainSubmissionResult,
  IBlockchainSubmitter,
  Transaction as DomainTransaction,
  TransactionEntity,
} from '../interfaces';
import { JournalTransaction } from '../models';
import { LedgerPipeline } from './LedgerPipeline';

/**
 * Entry point DUY NHẤT cho mọi transaction do hệ thống khởi tạo (WITHDRAW/STAKE/UNSTAKE/RESTAKE).
 * KHÔNG tạo các method riêng (handleWithdraw/handleStake/...) — mọi khác biệt chỉ nằm ở `getAccountingLegs()`.
 *
 * Vòng đời phía hệ thống:
 *   AUTHORIZING -> AUTHORIZED -> SENT        (class này)
 *   SENT -> CONFIRMING -> CONFIRMED/FAILED   (BlockchainEventHandler)
 *
 * Handler KHÔNG tự đụng tới JournalTransaction/Book/BookPosting/history — mọi thứ đi qua
 * LedgerPipeline. Handler chỉ quyết định: bước nào chạy khi nào, và gọi blockchain provider
 * (NGOÀI DB transaction).
 */
@singleton()
@autoInjectable()
export class SystemTransactionHandler {
  /** Gán implementation thật sau khi khởi tạo — xem IBlockchainSubmitter. */
  public blockchainSubmitter: IBlockchainSubmitter = NOT_WIRED_SUBMITTER;

  private readonly unitOfWork: UnitOfWork;
  private readonly ledgerPipeline: LedgerPipeline;

  constructor(unitOfWork?: UnitOfWork, ledgerPipeline?: LedgerPipeline) {
    this.unitOfWork = unitOfWork!;
    this.ledgerPipeline = ledgerPipeline!;
  }

  /**
   * Validate -> open JournalTransaction -> AUTHORIZING -> reserve (LedgerPipeline)
   * -> AUTHORIZED -> gọi Blockchain Provider (NGOÀI transaction) -> SENT.
   */
  async handle(transaction: DomainTransaction, createdBy?: number): Promise<TransactionEntity> {
    this.validateInput(transaction);

    const authResult = await this.unitOfWork.execute((tx) => this.authorize(transaction, tx, createdBy));

    if (authResult.phase !== 'AUTHORIZED') {
      return toTransactionEntity(transaction, authResult.journalTransaction, authResult.errorMessage);
    }

    return this.submitAndAdvance(transaction, authResult.journalTransaction, createdBy);
  }

  private validateInput(transaction: DomainTransaction): void {
    if (!transaction.idempotencyToken || !transaction.uuidToken) {
      throw new Error('Transaction is missing idempotencyToken/uuidToken.');
    }

    // Book bắt buộc có assetTicker và không còn giá trị fallback — thiếu thì từ chối sớm, trước khi tạo journal.
    const { debitItems, creditItems, fee } = getAccountingLegs(transaction);

    if ([...debitItems, ...creditItems, fee].some((item) => !item.assetTicker)) {
      throw new Error('Transaction item is missing assetTicker.');
    }
  }

  /**
   * 1 DB transaction duy nhất cho toàn bộ vòng AUTHORIZING -> AUTHORIZED (hoặc
   * AUTHORIZING -> REJECTED nếu thiếu số dư). Không gọi blockchain provider ở đây.
   */
  private async authorize(transaction: DomainTransaction, tx: SequelizeTransaction, createdBy?: number): Promise<AuthorizeResult> {
    // sourceContent lưu payload gốc ngay lúc tạo: blockchainEventHandler cần nó để dựng lại
    // legs khi settle/release lúc CONFIRMED/FAILED, và để đối chiếu sender khi correlate event.
    const { journalTransaction, created } = await this.ledgerPipeline.openJournal(
      {
        idempotencyToken: transaction.idempotencyToken,
        uuidToken: transaction.uuidToken,
        transactionTypeId: TRANSACTION_TYPE[transaction.type],
        transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
        sourceContent: JSON.stringify(transaction),
        createdBy,
      },
      tx,
    );

    if (!created) {
      // Duplicate request (trùng idempotencyToken) -> trả lại đúng trạng thái hiện có, KHÔNG post/advance gì thêm.
      return { phase: 'REPLAYED', journalTransaction };
    }

    const reserveResult = await this.ledgerPipeline.reserve(
      { journalTransactionId: journalTransaction.id, uuidToken: journalTransaction.uuidToken, legs: getAccountingLegs(transaction), createdBy },
      tx,
    );

    if (!reserveResult.ok) {
      const rejected = await this.ledgerPipeline.transition(
        {
          journalTransactionId: journalTransaction.id,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED,
          updatedBy: createdBy,
        },
        tx,
      );

      return {
        phase: 'REJECTED',
        journalTransaction: rejected.journalTransaction,
        errorMessage: `Insufficient balance: ${reserveResult.shortfalls.join('; ')}`,
      };
    }

    const authorized = await this.ledgerPipeline.transition(
      {
        journalTransactionId: journalTransaction.id,
        targetTransactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
        expectedStateSequence: TRANSACTION_STATE_SEQUENCE,
        updatedBy: createdBy,
      },
      tx,
    );

    return { phase: authorized.outcome === 'APPLIED' ? 'AUTHORIZED' : 'REPLAYED', journalTransaction: authorized.journalTransaction };
  }

  /**
   * Gọi blockchain provider NGOÀI mọi DB transaction, sau đó mở 1 transaction mới, ngắn,
   * để ghi nhận SENT (thành công) hoặc REJECTED + hoàn reserve (thất bại).
   */
  private async submitAndAdvance(
    transaction: DomainTransaction,
    journalTransaction: JournalTransaction,
    createdBy?: number,
  ): Promise<TransactionEntity> {
    let submission: BlockchainSubmissionResult;

    try {
      submission = await this.blockchainSubmitter.submit(transaction, journalTransaction.id);
    } catch (error) {
      const rejected = await this.unitOfWork.execute(async (tx) => {
        const result = await this.ledgerPipeline.transition(
          {
            journalTransactionId: journalTransaction.id,
            journalTransactionState: JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED,
            legs: getAccountingLegs(transaction),
            onApplied: 'RELEASE',
            updatedBy: createdBy,
          },
          tx,
        );

        return result.journalTransaction;
      });

      return toTransactionEntity(transaction, rejected, error instanceof Error ? error.message : String(error));
    }

    const sent = await this.unitOfWork.execute(async (tx) => {
      const result = await this.ledgerPipeline.transition(
        {
          journalTransactionId: journalTransaction.id,
          transactionHash: submission.transactionHash,
          targetTransactionStateId: TRANSACTION_STATE.SENT.id,
          expectedStateSequence: TRANSACTION_STATE_SEQUENCE,
          updatedBy: createdBy,
        },
        tx,
      );

      return result.journalTransaction;
    });

    return toTransactionEntity(transaction, sent);
  }
}
