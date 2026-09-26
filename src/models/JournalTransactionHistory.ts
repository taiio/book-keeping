import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, ForeignKey, BelongsTo } from 'sequelize-typescript';

import { JournalTransaction } from './JournalTransaction';
import { TransactionState } from './TransactionState';
import { JOURNAL_TRANSACTION_STATE } from '../constants';
import { JournalTransactionStateValue } from '../constants/journalTransactionState';

@Table({
  tableName: 'journal_transaction_history',
  timestamps: false,
})
export class JournalTransactionHistory extends Model {
  // ============================================================
  // Primary Key
  // ============================================================

  @PrimaryKey
  @AutoIncrement
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare id: number;

  // ============================================================
  // Transaction
  // ============================================================

  @Column({
    field: 'history_transaction_type_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare historyTransactionTypeId: number;

  @ForeignKey(() => JournalTransaction)
  @Column({
    field: 'journal_transaction_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare journalTransactionId: number;

  @BelongsTo(() => JournalTransaction, {
    foreignKey: 'journalTransactionId',
    as: 'journalTransaction',
  })
  declare journalTransaction: JournalTransaction;

  // ============================================================
  // External transaction
  // ============================================================

  @Column({
    field: 'request_id',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare requestId: number | null;

  @Column({
    field: 'transaction_hash',
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare transactionHash: string | null;

  @Column({
    field: 'journal_transaction_state',
    type: DataType.ENUM(JOURNAL_TRANSACTION_STATE.ACTIVE, JOURNAL_TRANSACTION_STATE.COMPLETED, JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED),
    allowNull: false,
  })
  declare journalTransactionState: JournalTransactionStateValue;

  /**
   * State chi tiết TẠI THỜI ĐIỂM sự kiện này xảy ra (snapshot, không phải
   * cache) — vd khi 1 withdraw advance sang SENT, dòng history này lưu lại
   * đúng SENT, bất kể sau đó journal có tiến tiếp tới đâu. Khác với cột
   * cùng tên bên JournalTransaction (luôn là giá trị mới nhất).
   */
  @ForeignKey(() => TransactionState)
  @Column({
    field: 'transaction_state_id',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare transactionStateId: number | null;

  @BelongsTo(() => TransactionState, {
    foreignKey: 'transactionStateId',
    as: 'transactionState',
  })
  declare transactionState: TransactionState;

  // ============================================================
  // Audit
  // ============================================================

  @Column({
    field: 'created_date',
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare createdDate: Date;

  @Column({
    field: 'created_by',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare createdBy: number | null;
}
