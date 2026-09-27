import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { JournalTransaction, JournalTransactionHistory } from '../models';
import { NotFoundError } from '../common/errors';
import type {
  GetOrCreateJournalTransactionParams,
  GetOrCreateJournalTransactionResult,
  UpdateJournalTransactionParams,
  UpdateJournalTransactionResult,
} from './interfaces';
import { JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE_RANK, HISTORY_EVENT_TYPE } from '../constants';

/**
 * Các state coi là "kết thúc" (terminal). Một khi journal đã vào 1 trong 2
 * state này thì mọi lệnh update tiếp theo (kể cả state trùng, hay 1 event
 * bị gửi lại / đến trễ) đều là replay và phải là no-op — không được ghi
 * thêm history, không được đổi state ngược lại.
 */
const TERMINAL_STATES: ReadonlySet<string> = new Set([JOURNAL_TRANSACTION_STATE.COMPLETED, JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED]);

@singleton()
@autoInjectable()
export class JournalTransactionRepository {
  /**
   * Idempotent theo `idempotencyToken`.
   *
   * Trước đây: `findOne` rồi `create` — đây là race condition kinh điển
   * (TOCTOU). Với 2 request/event trùng idempotencyToken đến gần như đồng
   * thời, ở mức isolation READ_COMMITTED cả 2 đều có thể SELECT ra "chưa
   * tồn tại" (vì chưa ai commit) rồi cùng chạy INSERT — 1 trong 2 sẽ vi
   * phạm unique constraint và làm rollback nguyên transaction thay vì trả
   * về bản ghi đã tồn tại như kỳ vọng của một API idempotent.
   *
   * `Model.findOrCreate` giải quyết đúng bài toán này: nó SELECT trước,
   * nếu không thấy thì thử INSERT trong 1 SAVEPOINT lồng trong transaction
   * hiện tại; nếu INSERT đó dính unique constraint (do đối thủ vừa commit
   * trước), nó rollback về savepoint đó rồi SELECT lại — tất cả vẫn nằm
   * trong transaction gốc của unitOfWork, không cần catch lỗi thủ công ở
   * tầng flow. Điều kiện bắt buộc: cột where phải có unique index thật ở
   * DB — `idempotencyToken` trên JournalTransaction đã có (`unique: true`).
   */
  async getOrCreateJournalTransaction(
    params: GetOrCreateJournalTransactionParams,
    transaction: Transaction,
  ): Promise<GetOrCreateJournalTransactionResult> {
    // idempotencyToken là nullable ở DB (cho phép nhiều NULL cùng lúc theo
    // chuẩn Postgres unique index). Nếu caller không truyền, KHÔNG được
    // findOrCreate theo where: { idempotencyToken: null } vì như vậy sẽ
    // vô tình khớp với BẤT KỲ journal nào khác cũng đang có token null —
    // gộp nhầm 2 giao dịch không liên quan vào làm một.
    if (!params.idempotencyToken) {
      const journalTransaction = await JournalTransaction.create(
        {
          uuidToken: params.uuidToken,
          transactionTypeId: params.transactionTypeId,
          fromAccountId: params.fromAccountId ?? null,
          toAccountId: params.toAccountId ?? null,
          transactionHash: params.transactionHash ?? null,
          idempotencyToken: null,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
          transactionStateId: params.transactionStateId ?? null,
          businessPostDateTime: params.businessPostDateTime,
          createdBy: params.createdBy ?? null,
        },
        { transaction },
      );

      await JournalTransactionHistory.create(
        {
          historyTransactionTypeId: params.historyTransactionTypeId,
          journalTransactionId: journalTransaction.id,
          transactionHash: params.transactionHash ?? null,
          journalTransactionState: params.journalTransactionState,
          transactionStateId: params.transactionStateId ?? null,
          createdBy: params.createdBy ?? null,
        },
        { transaction },
      );

      return { journalTransaction, created: true };
    }

    const [journalTransaction, created] = await JournalTransaction.findOrCreate({
      where: { idempotencyToken: params.idempotencyToken },
      defaults: {
        uuidToken: params.uuidToken,
        transactionTypeId: params.transactionTypeId,
        fromAccountId: params.fromAccountId ?? null,
        toAccountId: params.toAccountId ?? null,
        transactionHash: params.transactionHash ?? null,
        idempotencyToken: params.idempotencyToken,
        journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
        transactionStateId: params.transactionStateId ?? null,
        businessPostDateTime: params.businessPostDateTime,
        createdBy: params.createdBy ?? null,
      },
      transaction,
    });

    // Chỉ ghi history CREATED khi thật sự vừa tạo mới. Nếu !created nghĩa
    // là đây là 1 lần gửi lại / duplicate event của cùng request — bản
    // thân JournalTransaction không đổi, nên không được nhân đôi dòng
    // lịch sử (tránh "duplicate event" ở đúng chỗ user hỏi).
    if (created) {
      await JournalTransactionHistory.create(
        {
          historyTransactionTypeId: params.historyTransactionTypeId,
          journalTransactionId: journalTransaction.id,
          transactionHash: params.transactionHash ?? null,
          journalTransactionState: params.journalTransactionState,
          transactionStateId: params.transactionStateId ?? null,
          createdBy: params.createdBy ?? null,
        },
        { transaction },
      );
    }

    return { journalTransaction, created };
  }

  async getLatestStateId(journalTransactionId: number, transaction: Transaction): Promise<string | null> {
    const latest = await JournalTransactionHistory.findOne({ where: { journalTransactionId }, order: [['id', 'DESC']], transaction });

    return latest?.journalTransactionState ?? null;
  }

  /**
   * Chuyển trạng thái JournalTransaction.
   *
   * Khoá row bằng SELECT ... FOR UPDATE để 2 event advance cùng lúc cho
   * cùng 1 journal luôn serialize qua nhau (không có 2 transaction cùng
   * đọc "state hiện tại" rồi cùng ghi đè).
   *
   * Trả về `outcome` thay vì chỉ trả JournalTransaction để caller (Flow)
   * phân biệt được 3 trường hợp và xử lý đúng:
   *   - APPLIED: state vừa được tiến đúng 1 bước hợp lệ, đã ghi history.
   *   - REPLAYED_NOOP: duplicate/late event (target <= state hiện tại, hoặc
   *     journal đã ở state kết thúc) — KHÔNG có gì thay đổi, an toàn bỏ qua.
   *   - REJECTED_INVALID_TRANSITION: (chỉ xảy ra khi có truyền
   *     `expectedStateSequence`) target bỏ bước / không thuộc chuỗi hợp lệ —
   *     journal đã bị chuyển sang CANCELLED_OR_EXPIRED NGAY TRONG LẦN GỌI
   *     NÀY. Caller (vd WithdrawFlow) cần tự hoàn tiền lại cho client ở các
   *     bucket đã lỡ ghi nhận trước đó — repository này không biết gì về
   *     Book/posting nên không tự hoàn tiền được.
   */
  async updateJournalTransaction(params: UpdateJournalTransactionParams, transaction: Transaction): Promise<UpdateJournalTransactionResult> {
    const journalTransaction = await JournalTransaction.findByPk(params.journalTransactionId, { transaction, lock: transaction.LOCK.UPDATE });

    if (!journalTransaction) {
      throw new NotFoundError('JournalTransaction', params.journalTransactionId);
    }

    if (TERMINAL_STATES.has(journalTransaction.journalTransactionState)) {
      return { journalTransaction, outcome: 'REPLAYED_NOOP' };
    }

    const currentStateId = journalTransaction.transactionStateId;

    if (params.expectedStateSequence && params.targetTransactionStateId != null) {
      // FSM CHẶT: target BẮT BUỘC phải đúng là bước kế tiếp trong chuỗi
      // `expectedStateSequence` — không được bỏ bước, không được lộn xộn.
      const sequence = params.expectedStateSequence;
      const currentIndex = currentStateId != null ? sequence.indexOf(currentStateId) : -1;
      const targetIndex = sequence.indexOf(params.targetTransactionStateId);

      if (targetIndex !== -1 && targetIndex <= currentIndex) {
        // Đã áp dụng rồi (duplicate) hoặc target là 1 bước cũ hơn hiện tại
        // (event đến trễ) -> replay, bỏ qua an toàn.
        return { journalTransaction, outcome: 'REPLAYED_NOOP' };
      }

      if (targetIndex !== currentIndex + 1) {
        // SAI THỨ TỰ / BỎ BƯỚC / target không thuộc chuỗi hợp lệ của flow
        // này -> REJECT TOÀN BỘ journal ngay lập tức, bất kể
        // completeJournal/cancelJournal truyền vào là gì.
        journalTransaction.journalTransactionState = JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED;
        journalTransaction.updatedDate = new Date();
        journalTransaction.updatedBy = params.updatedBy ?? null;

        await journalTransaction.save({ transaction });

        await JournalTransactionHistory.create(
          {
            historyTransactionTypeId: HISTORY_EVENT_TYPE.REJECTED_INVALID_TRANSITION,
            journalTransactionId: journalTransaction.id,
            transactionHash: journalTransaction.transactionHash,
            journalTransactionState: JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED,
            // Giữ nguyên state CHI TIẾT hợp lệ CUỐI CÙNG (không nhảy sang
            // target sai) — đây chính là bucket mà caller cần dùng để tính
            // hoàn tiền lại cho client.
            transactionStateId: currentStateId,
            createdBy: params.updatedBy ?? null,
          },
          { transaction },
        );

        return { journalTransaction, outcome: 'REJECTED_INVALID_TRANSITION' };
      }
      // targetIndex === currentIndex + 1 -> đúng bước kế tiếp, rơi xuống nhánh APPLIED bên dưới.
    } else if (
      params.targetTransactionStateId != null &&
      currentStateId != null &&
      (TRANSACTION_STATE_RANK[params.targetTransactionStateId] ?? -Infinity) <= (TRANSACTION_STATE_RANK[currentStateId] ?? -Infinity)
    ) {
      // Không có expectedStateSequence (Deposit/Stake) -> chỉ áp dụng guard
      // rank đơn giản: target <= hiện tại thì coi là replay, bỏ qua.
      return { journalTransaction, outcome: 'REPLAYED_NOOP' };
    }

    journalTransaction.transactionHash = params.transactionHash ?? journalTransaction.transactionHash ?? null;

    if (params.targetTransactionStateId != null) {
      journalTransaction.transactionStateId = params.targetTransactionStateId;
    }

    if (params.completeJournal) {
      journalTransaction.journalTransactionState = JOURNAL_TRANSACTION_STATE.COMPLETED;
    } else if (params.cancelJournal) {
      journalTransaction.journalTransactionState = JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED;
    }

    journalTransaction.updatedDate = new Date();
    journalTransaction.updatedBy = params.updatedBy ?? null;

    await journalTransaction.save({ transaction });

    await JournalTransactionHistory.create(
      {
        historyTransactionTypeId: params.historyTransactionTypeId,
        journalTransactionId: journalTransaction.id,
        transactionHash: journalTransaction.transactionHash,
        journalTransactionState: params.journalTransactionState,
        transactionStateId: params.targetTransactionStateId ?? journalTransaction.transactionStateId,
        createdBy: params.updatedBy ?? null,
      },
      { transaction },
    );

    return { journalTransaction, outcome: 'APPLIED' };
  }
}
