import { randomUUID } from 'crypto';
import { Transaction as SequelizeTransaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { UnitOfWork } from '../common/UnitOfWork';
import { NotFoundError } from '../common/errors';
import {
  BLOCKCHAIN_TRANSACTION_STATUS,
  JOURNAL_TRANSACTION_STATE,
  TRANSACTION_STATE,
  TRANSACTION_STATE_IDS_FAILABLE_BY_BLOCKCHAIN,
  TRANSACTION_STATE_SEQUENCE,
  TRANSACTION_TYPE,
} from '../constants';
import {
  custodyBookParams,
  depositIdempotencyToken,
  getAccountingLegs,
  matchesSender,
  parseSourceContent,
  toDepositEntity,
  toTransactionEntity,
} from '../helpers';
import {
  BlockchainDrivenEntity,
  BlockchainMessagePayload,
  DepositBookMatch,
  DepositTransactionEntity,
  Transaction as DomainTransaction,
  TransactionEntity,
} from '../interfaces';
import { JournalTransaction } from '../models';
import { BookRepository } from '../repositories/Book';
import { JournalTransactionRepository } from '../repositories/JournalTransaction';
import { LedgerPipeline } from './LedgerPipeline';

/**
 * Entry point CHUNG cho mọi blockchain event (WITHDRAW/STAKE/UNSTAKE/RESTAKE/DEPOSIT).
 * KHÔNG tạo method riêng theo từng loại — mọi transaction khớp với 1 system transaction
 * sẵn có đều đi qua CÙNG 1 LedgerPipeline (cũng là nơi SystemTransactionHandler dùng).
 *
 * Upstream event pipeline đã lọc: mọi event tới đây là 1 blockchain transaction hợp lệ —
 * handler chỉ correlate/classify rồi xử lý, không làm nhiệm vụ phát hiện transaction.
 * Handler chỉ ĐỌC qua repository (tìm journal/book); mọi thao tác GHI đi qua LedgerPipeline.
 */
@singleton()
@autoInjectable()
export class BlockchainEventHandler {
  private readonly unitOfWork: UnitOfWork;
  private readonly journalTransactionRepository: JournalTransactionRepository;
  private readonly bookRepository: BookRepository;
  private readonly ledgerPipeline: LedgerPipeline;

  constructor(
    unitOfWork?: UnitOfWork,
    journalTransactionRepository?: JournalTransactionRepository,
    bookRepository?: BookRepository,
    ledgerPipeline?: LedgerPipeline,
  ) {
    this.unitOfWork = unitOfWork!;
    this.journalTransactionRepository = journalTransactionRepository!;
    this.bookRepository = bookRepository!;
    this.ledgerPipeline = ledgerPipeline!;
  }

  /**
   * Validate -> Correlate (transactionHash + sender) -> có system transaction thì tiếp tục
   * lifecycle của nó; không thì Detect Valid Deposit -> DEPOSIT.
   */
  async handle(payload: BlockchainMessagePayload, createdBy?: number): Promise<BlockchainDrivenEntity> {
    this.validatePayload(payload);

    return this.unitOfWork.execute(async (tx) => {
      const existing = await this.journalTransactionRepository.findByTransactionHash(payload.transactionHash, tx);

      // Journal DEPOSIT cũng mang transactionHash, nhưng không phải system transaction:
      // event tiếp theo của nó (CONFIRMING -> CONFIRMED/FAILED) phải đi tiếp nhánh deposit.
      if (existing && existing.transactionTypeId !== TRANSACTION_TYPE.DEPOSIT) {
        const original = parseSourceContent(existing);

        if (matchesSender(original, payload)) {
          return this.processExistingTransaction(existing, original, payload, tx, createdBy);
        }
      }

      return this.processDeposit(payload, tx, createdBy);
    });
  }

  private validatePayload(payload: BlockchainMessagePayload): void {
    if (!payload.transactionHash || !payload.status) {
      throw new Error('BlockchainMessagePayload is missing transactionHash/status.');
    }
  }

  // --------------------------------------------------------------------
  // Existing system transaction: SENT -> CONFIRMING -> CONFIRMED/FAILED
  // --------------------------------------------------------------------

  private async processExistingTransaction(
    existing: JournalTransaction,
    original: DomainTransaction | null,
    payload: BlockchainMessagePayload,
    tx: SequelizeTransaction,
    createdBy?: number,
  ): Promise<TransactionEntity> {
    // original === null (sourceContent thiếu/hỏng) -> vẫn advance state được, nhưng không dựng lại được legs để settle/release.
    const legs = original ? getAccountingLegs(original) : null;
    const base = { journalTransactionId: existing.id, transactionHash: payload.transactionHash, updatedBy: createdBy };

    switch (payload.status) {
      case BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING: {
        // SENT -> CONFIRMING: Sent -> Confirming.
        const { journalTransaction } = await this.ledgerPipeline.transition(
          {
            ...base,
            targetTransactionStateId: TRANSACTION_STATE.CONFIRMING.id,
            expectedStateSequence: TRANSACTION_STATE_SEQUENCE,
            legs,
            onApplied: 'ADVANCE',
          },
          tx,
        );

        return toTransactionEntity(original, journalTransaction);
      }

      case BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED: {
        // Confirming -> External (amount), Confirming -> Fee Confirming -> Fee Revenue (fee).
        // Chỉ settle khi transition thực sự APPLIED — không post nửa chừng khi FSM từ chối
        // 1 transition sai thứ tự, hoặc khi đây chỉ là event trùng lặp (đã post ở lần trước).
        const { journalTransaction } = await this.ledgerPipeline.transition(
          {
            ...base,
            targetTransactionStateId: TRANSACTION_STATE.CONFIRMED.id,
            expectedStateSequence: TRANSACTION_STATE_SEQUENCE,
            journalTransactionState: JOURNAL_TRANSACTION_STATE.COMPLETED,
            legs,
            onApplied: 'SETTLE',
          },
          tx,
        );

        return toTransactionEntity(original, journalTransaction);
      }

      case BLOCKCHAIN_TRANSACTION_STATUS.FAILED: {
        // Hoàn từ bucket hiện tại (Sent hoặc Confirming) về Available. Chỉ revert khi đang ở SENT/CONFIRMING,
        // đúng biên "CONFIRMING -> FAILED" của design doc. Ngoài ra coi là event trễ/không hợp lệ và bỏ qua an toàn.
        if (existing.transactionStateId == null || !TRANSACTION_STATE_IDS_FAILABLE_BY_BLOCKCHAIN.includes(existing.transactionStateId)) {
          return toTransactionEntity(original, existing);
        }

        const { journalTransaction } = await this.ledgerPipeline.transition(
          { ...base, journalTransactionState: JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED, legs, onApplied: 'RELEASE' },
          tx,
        );

        return toTransactionEntity(original, journalTransaction, payload.error?.message);
      }
    }
  }

  // --------------------------------------------------------------------
  // No matching system transaction: Detect Valid Deposit -> DEPOSIT
  // --------------------------------------------------------------------

  /**
   * Find / Create Deposit Book: tìm book Available theo địa chỉ nhận; chưa có thì tạo mới NẾU payload
   * mang sẵn danh tính account (`recipient.account`, do Listener "Identify System Deposit" gắn vào).
   * Thiếu cả hai -> null (không đủ dữ liệu để tạo book đúng chủ).
   */
  private async findOrCreateDepositBook(payload: BlockchainMessagePayload, tx: SequelizeTransaction): Promise<DepositBookMatch | null> {
    for (const recipient of payload.recipients) {
      const book = await this.bookRepository.findByDepositAddress(recipient.address, recipient.assetTicker, tx);

      if (book) {
        return { book, recipient };
      }
    }

    for (const recipient of payload.recipients) {
      if (!recipient.account) {
        continue;
      }

      const { book } = await this.bookRepository.getOrCreateBook(
        {
          ...custodyBookParams(
            { ...recipient.account, assetTicker: recipient.assetTicker, quantity: recipient.quantity },
            TRANSACTION_STATE.CONFIRMED.id,
          ),
          address: recipient.address,
        },
        tx,
      );

      return { book, recipient };
    }

    return null;
  }

  /**
   * DEPOSIT (design): CONFIRMING (External -> Confirming) -> CONFIRMED (Confirming -> Available) | FAILED (Confirming -> External).
   * Journal luôn được mở ở CONFIRMING kèm bút toán External -> Confirming, kể cả khi event đầu tiên thấy được là
   * CONFIRMED/FAILED (provider bỏ qua CONFIRMING) — nhờ vậy mọi deposit đều có đủ vết audit và tổng luôn cân.
   */
  private async processDeposit(payload: BlockchainMessagePayload, tx: SequelizeTransaction, createdBy?: number): Promise<DepositTransactionEntity> {
    const matched = await this.findOrCreateDepositBook(payload, tx);

    if (!matched) {
      // Không khớp system transaction NÀO và cũng không phải deposit tới 1 địa chỉ đã biết -> không có Book nào để post.
      throw new NotFoundError('DepositAddress', payload.recipients.map((recipient) => recipient.address).join(','));
    }

    const { book, recipient } = matched;

    const opened = await this.ledgerPipeline.openJournal(
      {
        idempotencyToken: depositIdempotencyToken(payload.transactionHash, recipient.address, recipient.assetTicker),
        uuidToken: randomUUID(),
        transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
        transactionHash: payload.transactionHash,
        transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
        createdBy,
      },
      tx,
    );

    let journalTransaction = opened.journalTransaction;

    // uuidToken lấy từ journal (không phải giá trị random vừa sinh) để khoá idempotency ổn định giữa các event của cùng deposit.
    const movement = {
      journalTransactionId: journalTransaction.id,
      uuidToken: journalTransaction.uuidToken,
      matchedCustodyBook: book,
      quantity: recipient.quantity,
      createdBy,
    };
    const base = { journalTransactionId: journalTransaction.id, transactionHash: payload.transactionHash, updatedBy: createdBy };

    // CONFIRMING: External -> Confirming. Chỉ post khi journal vừa được tạo — duplicate event không post lại.
    if (opened.created) {
      await this.ledgerPipeline.postDeposit(TRANSACTION_STATE.CONFIRMING.code, movement, tx);
    }

    if (payload.status === BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED) {
      const result = await this.ledgerPipeline.transition(
        { ...base, targetTransactionStateId: TRANSACTION_STATE.CONFIRMED.id, journalTransactionState: JOURNAL_TRANSACTION_STATE.COMPLETED },
        tx,
      );

      journalTransaction = result.journalTransaction;

      // Confirming -> Available, chỉ khi transition thực sự APPLIED (event trùng / đến trễ là no-op).
      if (result.outcome === 'APPLIED') {
        await this.ledgerPipeline.postDeposit(TRANSACTION_STATE.CONFIRMED.code, movement, tx);
      }
    } else if (payload.status === BLOCKCHAIN_TRANSACTION_STATUS.FAILED) {
      const result = await this.ledgerPipeline.transition({ ...base, journalTransactionState: JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED }, tx);

      journalTransaction = result.journalTransaction;

      // Confirming -> External: trả lại đúng phần đã ghi nhận ở CONFIRMING.
      if (result.outcome === 'APPLIED') {
        await this.ledgerPipeline.postDeposit('FAILED', movement, tx);
      }
    }
    // status CONFIRMING: journal đã ở đúng state ngay từ lúc openJournal, không cần làm gì thêm.

    return toDepositEntity(journalTransaction, recipient, book);
  }
}
