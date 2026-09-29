import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, HasMany, Index } from 'sequelize-typescript';

import { JournalTransactionHistory } from './JournalTransactionHistory';
import { BookPosting } from './BookPosting';
import { JOURNAL_TRANSACTION_STATE } from '../constants';
import type { JournalTransactionStateValue } from '../interfaces';

@Table({
  tableName: 'journal_transaction',
  timestamps: false,

  indexes: [
    {
      name: 'idx_journal_transaction_transaction_hash',
      fields: ['transaction_hash', 'request_id'],
    },
  ],
})
export class JournalTransaction extends Model {
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
  // UUID
  // ============================================================

  @Column({
    field: 'uuid_token',
    type: DataType.STRING(36),
    allowNull: false,
    unique: true,
  })
  declare uuidToken: string;

  @Column({
    field: 'transaction_type_id',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare transactionTypeId: number | null;

  @Column({
    field: 'from_account_id',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare fromAccountId: number | null;

  @Column({
    field: 'to_account_id',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare toAccountId: number | null;

  @Column({
    field: 'request_id',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare requestId: number | null;

  @Index('idx_journal_transaction_transaction_hash')
  @Column({
    field: 'transaction_hash',
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare transactionHash: string | null;

  @Column({
    field: 'source_content',
    type: DataType.TEXT,
    allowNull: true,
  })
  declare sourceContent: string | null;

  /**
   * Bất biến kể từ khi journal xuất hiện (AUTHORIZING với transaction do hệ thống khởi tạo, CONFIRMING với
   * DEPOSIT) — chỉ dùng để get-or-create/tra cứu, KHÔNG bao giờ bị ghi đè sau đó (xem
   * JournalTransactionRepository, không có logic update trường này).
   */
  @Column({
    field: 'idempotency_token',
    type: DataType.STRING(255),
    allowNull: true,
    unique: true,
  })
  declare idempotencyToken: string | null;

  @Column({
    field: 'journal_transaction_state',
    type: DataType.INTEGER,
    allowNull: false,
    validate: {
      isIn: [
        [JOURNAL_TRANSACTION_STATE.ACTIVE, JOURNAL_TRANSACTION_STATE.COMPLETED, JOURNAL_TRANSACTION_STATE.REJECTED, JOURNAL_TRANSACTION_STATE.FAILED],
      ],
    },
  })
  declare journalTransactionState: JournalTransactionStateValue;

  @Column({
    field: 'business_post_date_time',
    type: DataType.DATE,
    allowNull: true,
  })
  declare businessPostDateTime: Date | null;

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

  @Column({
    field: 'updated_date',
    type: DataType.DATE,
    allowNull: true,
  })
  declare updatedDate: Date | null;

  @Column({
    field: 'updated_by',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare updatedBy: number | null;

  // ============================================================
  // Associations
  // ============================================================

  @HasMany(() => JournalTransactionHistory, {
    foreignKey: 'journalTransactionId',
    as: 'histories',
  })
  declare histories: JournalTransactionHistory[];

  @HasMany(() => BookPosting, {
    foreignKey: 'journalTransactionId',
    as: 'postings',
  })
  declare postings: BookPosting[];
}
