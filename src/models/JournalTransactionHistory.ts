import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, ForeignKey, BelongsTo } from 'sequelize-typescript';

import { JournalTransaction } from './JournalTransaction';
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
