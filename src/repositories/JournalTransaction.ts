import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { JournalTransaction, JournalTransactionHistory } from '../models';
import { NotFoundError } from '../common/errors';
import type { GetOrCreateJournalTransactionParams, GetOrCreateJournalTransactionResult, UpdateJournalTransactionParams } from './interfaces';
import { JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE_RANK } from '../constants';

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
   * Monotonic guard: 1 khi journal đã ở state kết thúc (COMPLETED hoặc
   * CANCELLED_OR_EXPIRED) thì coi MỌI lệnh update tiếp theo là replay/late
   * event và trả về nguyên trạng, không ghi thêm history, không đổi state.
   * Đây là chỗ code cũ có khai báo currentStateId nhưng không hề dùng nó để
   * chặn gì cả — một duplicate "complete" event gửi lại vẫn lọt qua và ghi
   * thêm 1 dòng history/COMPLETED thứ hai.
   */
  async updateJournalTransaction(params: UpdateJournalTransactionParams, transaction: Transaction): Promise<JournalTransaction> {
    const journalTransaction = await JournalTransaction.findByPk(params.journalTransactionId, { transaction, lock: transaction.LOCK.UPDATE });

    if (!journalTransaction) {
      throw new NotFoundError('JournalTransaction', params.journalTransactionId);
    }

    if (TERMINAL_STATES.has(journalTransaction.journalTransactionState)) {
      return journalTransaction;
    }

    // Guard monotonic ở mức state CHI TIẾT (AUTHORIZING/AUTHORIZED/SENT/...).
    // Mạnh hơn TERMINAL_STATES ở trên: chặn được cả trường hợp 1 event ĐẾN
    // TRỄ/SAI THỨ TỰ ở GIỮA vòng đời (chưa hề COMPLETED/CANCELLED) — ví dụ
    // journal đã ở CONFIRMING (rank 3), nhưng 1 event SENT (rank 2) bị
    // queue redeliver muộn lại đến sau — event này phải bị coi là replay và
    // bỏ qua, KHÔNG được phép ghi thêm history hay (tệ hơn) làm lùi state.
    if (
      params.targetTransactionStateId != null &&
      journalTransaction.transactionStateId != null &&
      (TRANSACTION_STATE_RANK[params.targetTransactionStateId] ?? -Infinity) <=
        (TRANSACTION_STATE_RANK[journalTransaction.transactionStateId] ?? -Infinity)
    ) {
      return journalTransaction;
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
        // Snapshot state chi tiết TẠI THỜI ĐIỂM sự kiện này — ưu tiên target
        // của lần advance này; nếu flow không truyền (vd flow chỉ dùng
        // journalTransactionState thô) thì rơi về giá trị hiện có trên journal.
        transactionStateId: params.targetTransactionStateId ?? journalTransaction.transactionStateId,
        createdBy: params.updatedBy ?? null,
      },
      { transaction },
    );

    return journalTransaction;
  }
}
