import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';

import { JournalTransaction } from './JournalTransaction';
import { Book } from './Book';
import { BookHistory } from './BookHistory';
import { BOOK_POSTING_PURPOSE } from '../constants';

@Table({
  tableName: 'book_posting',
  timestamps: false,

  indexes: [
    {
      name: 'uk_book_posting_book_sequence',
      unique: true,
      fields: ['book_id', 'sequence_no'],
    },
    {
      // Đây là chốt chặn cứng ở tầng DB cho idempotency của 1 posting.
      // Nếu thiếu index này, check "findOne theo idempotencyToken rồi mới
      // insert" ở tầng app chỉ là optimistic, hoàn toàn có thể bị race khi
      // 2 event trùng nhau (duplicate webhook/duplicate message) đến gần
      // như đồng thời: cả 2 đều SELECT không thấy gì rồi cùng INSERT.
      name: 'uk_book_posting_idempotency_token',
      unique: true,
      fields: ['idempotency_token'],
    },
  ],
})
export class BookPosting extends Model {
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
    type: DataType.UUID,
    allowNull: false,
    unique: true,
  })
  declare uuidToken: string;

  // ============================================================
  // Journal Transaction
  // ============================================================

  @ForeignKey(() => JournalTransaction)
  @Column({
    field: 'journal_transaction_id',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare journalTransactionId: number | null;

  @BelongsTo(() => JournalTransaction, {
    foreignKey: 'journalTransactionId',
    as: 'journalTransaction',
  })
  declare journalTransaction: JournalTransaction;

  // ============================================================
  // Book
  // ============================================================

  @ForeignKey(() => Book)
  @Column({
    field: 'book_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare bookId: number;

  @BelongsTo(() => Book, {
    foreignKey: 'bookId',
    as: 'book',
  })
  declare book: Book;

  // ============================================================
  // Posting
  // ============================================================

  @Column({
    type: DataType.DECIMAL(65, 0),
    allowNull: false,
    defaultValue: '0',
  })
  declare amount: string;

  @Column({
    field: 'book_posting_purpose_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare bookPostingPurposeId: number;

  @Column({
    field: 'asset_type_id',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare assetTypeId: number | null;

  @Column({
    field: 'sequence_no',
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  declare sequenceNo: number;

  @Column({
    field: 'idempotency_token',
    type: DataType.STRING(64),
    allowNull: false,
    unique: 'uk_book_posting_idempotency_token',
  })
  declare idempotencyToken: string;

  @Column({
    field: 'business_post_date_time',
    type: DataType.DATE,
    allowNull: true,
  })
  declare businessPostDateTime: Date;

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

  @HasMany(() => BookHistory, {
    foreignKey: 'bookPostingId',
    as: 'histories',
  })
  declare histories: BookHistory[];
}
