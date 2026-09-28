import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { NotFoundError } from '../common/errors';
import { HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, TERMINAL_JOURNAL_TRANSACTION_STATES, TRANSACTION_STATE_RANK } from '../constants';
import {
  GetOrCreateJournalTransactionParams,
  GetOrCreateJournalTransactionResult,
  UpdateJournalTransactionParams,
  UpdateJournalTransactionResult,
} from '../interfaces';
import { JournalTransaction } from '../models';
import { JournalTransactionHistoryRepository } from './JournalTransactionHistory';

type TransitionVerdict = 'APPLY' | 'REPLAY' | 'INVALID';

@singleton()
@autoInjectable()
export class JournalTransactionRepository {
  private readonly historyRepository: JournalTransactionHistoryRepository;

  constructor(historyRepository?: JournalTransactionHistoryRepository) {
    this.historyRepository = historyRepository!;
  }

  async findByTransactionHash(transactionHash: string, transaction: Transaction): Promise<JournalTransaction | null> {
    return JournalTransaction.findOne({ where: { transactionHash }, transaction });
  }

  /**
   * Idempotent theo `idempotencyToken`, và ghi `journal_transaction_history` (CREATED)
   * CHỈ khi thật sự vừa tạo mới — gửi lại / duplicate event không nhân đôi lịch sử.
   *
   * Dùng `findOrCreate` (SELECT rồi INSERT trong SAVEPOINT) thay vì `findOne` + `create`
   * để tránh race TOCTOU khi 2 request trùng token đến cùng lúc: bên thua cuộc dính
   * unique constraint sẽ tự rollback về savepoint rồi SELECT lại bản ghi đã tồn tại.
   * Điều kiện: `idempotencyToken` phải có unique index thật ở DB (đã có).
   *
   * Không truyền idempotencyToken thì luôn tạo mới — KHÔNG được `findOrCreate` theo
   * `where: { idempotencyToken: null }` vì sẽ gộp nhầm các journal không liên quan.
   */
  async getOrCreateJournalTransaction(
    params: GetOrCreateJournalTransactionParams,
    transaction: Transaction,
  ): Promise<GetOrCreateJournalTransactionResult> {
    const values = {
      uuidToken: params.uuidToken,
      transactionTypeId: params.transactionTypeId,
      fromAccountId: params.fromAccountId ?? null,
      toAccountId: params.toAccountId ?? null,
      transactionHash: params.transactionHash ?? null,
      sourceContent: params.sourceContent ?? null,
      idempotencyToken: params.idempotencyToken ?? null,
      journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
      transactionStateId: params.transactionStateId ?? null,
      businessPostDateTime: params.businessPostDateTime,
      createdBy: params.createdBy ?? null,
    };

    let journalTransaction: JournalTransaction;
    let created: boolean;

    if (params.idempotencyToken) {
      [journalTransaction, created] = await JournalTransaction.findOrCreate({
        where: { idempotencyToken: params.idempotencyToken },
        defaults: values,
        transaction,
      });
    } else {
      journalTransaction = await JournalTransaction.create(values, { transaction });
      created = true;
    }

    if (created) {
      await this.historyRepository.record(
        { journalTransaction, historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED, createdBy: params.createdBy },
        transaction,
      );
    }

    return { journalTransaction, created };
  }

  /**
   * Quyết định 1 lệnh chuyển state là hợp lệ, trùng lặp hay sai thứ tự.
   *
   * - Có `expectedStateSequence` -> FSM CHẶT: target phải đúng là bước kế tiếp trong
   *   chuỗi; target cũ hơn/bằng hiện tại là replay; còn lại (bỏ bước, không thuộc chuỗi)
   *   là INVALID.
   * - Không có -> chỉ guard rank đơn giản: target <= hiện tại là replay.
   */
  private evaluateTransition(currentStateId: number | null, targetStateId: number | undefined, sequence?: readonly number[]): TransitionVerdict {
    if (targetStateId == null) {
      return 'APPLY';
    }

    if (sequence) {
      const currentIndex = currentStateId != null ? sequence.indexOf(currentStateId) : -1;
      const targetIndex = sequence.indexOf(targetStateId);

      if (targetIndex !== -1 && targetIndex <= currentIndex) {
        return 'REPLAY';
      }

      return targetIndex === currentIndex + 1 ? 'APPLY' : 'INVALID';
    }

    if (currentStateId != null && (TRANSACTION_STATE_RANK[targetStateId] ?? -Infinity) <= (TRANSACTION_STATE_RANK[currentStateId] ?? -Infinity)) {
      return 'REPLAY';
    }

    return 'APPLY';
  }

  /**
   * Chuyển trạng thái JournalTransaction + ghi `journal_transaction_history`.
   *
   * Khoá row bằng SELECT ... FOR UPDATE để 2 event advance cùng lúc cho cùng 1 journal
   * luôn serialize qua nhau. Trả về `outcome` (xem JournalTransitionOutcome) để caller
   * phân biệt đúng 3 trường hợp; repository này không biết gì về Book/posting nên với
   * REJECTED_INVALID_TRANSITION, việc hoàn reserve là của caller (LedgerPipeline.transition).
   */
  async updateJournalTransaction(params: UpdateJournalTransactionParams, transaction: Transaction): Promise<UpdateJournalTransactionResult> {
    const journalTransaction = await JournalTransaction.findByPk(params.journalTransactionId, { transaction, lock: transaction.LOCK.UPDATE });

    if (!journalTransaction) {
      throw new NotFoundError('JournalTransaction', params.journalTransactionId);
    }

    if (TERMINAL_JOURNAL_TRANSACTION_STATES.has(journalTransaction.journalTransactionState)) {
      return { journalTransaction, outcome: 'REPLAYED_NOOP' };
    }

    const verdict = this.evaluateTransition(journalTransaction.transactionStateId, params.targetTransactionStateId, params.expectedStateSequence);

    if (verdict === 'REPLAY') {
      return { journalTransaction, outcome: 'REPLAYED_NOOP' };
    }

    if (verdict === 'INVALID') {
      // Reject TOÀN BỘ journal, bất kể caller yêu cầu state nào. Giữ nguyên state chi
      // tiết hợp lệ CUỐI CÙNG (không nhảy sang target sai) — đó là bucket caller cần
      // để tính hoàn tiền.
      await this.save(journalTransaction, { journalTransactionState: JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED }, params.updatedBy, transaction);
      await this.historyRepository.record(
        { journalTransaction, historyTransactionTypeId: HISTORY_EVENT_TYPE.REJECTED_INVALID_TRANSITION, createdBy: params.updatedBy },
        transaction,
      );

      return { journalTransaction, outcome: 'REJECTED_INVALID_TRANSITION' };
    }

    await this.save(
      journalTransaction,
      {
        transactionHash: params.transactionHash ?? journalTransaction.transactionHash,
        transactionStateId: params.targetTransactionStateId ?? journalTransaction.transactionStateId,
        journalTransactionState: params.journalTransactionState ?? journalTransaction.journalTransactionState,
      },
      params.updatedBy,
      transaction,
    );
    await this.historyRepository.record(
      { journalTransaction, historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED, createdBy: params.updatedBy },
      transaction,
    );

    return { journalTransaction, outcome: 'APPLIED' };
  }

  private async save(
    journalTransaction: JournalTransaction,
    changes: Partial<Pick<JournalTransaction, 'transactionHash' | 'transactionStateId' | 'journalTransactionState'>>,
    updatedBy: number | undefined,
    transaction: Transaction,
  ): Promise<void> {
    Object.assign(journalTransaction, changes);
    journalTransaction.updatedDate = new Date();
    journalTransaction.updatedBy = updatedBy ?? null;

    await journalTransaction.save({ transaction });
  }
}
