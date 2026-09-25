import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, ForeignKey, BelongsTo } from 'sequelize-typescript';

import { Book } from './Book';
import { BookPosting } from './BookPosting';

@Table({
  tableName: 'book_history',
  timestamps: false,
})
export class BookHistory extends Model {
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

  @ForeignKey(() => BookPosting)
  @Column({
    field: 'book_posting_id',
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare bookPostingId: number | null;

  @BelongsTo(() => BookPosting, {
    foreignKey: 'bookPostingId',
    as: 'posting',
  })
  declare posting: BookPosting;

  // ============================================================
  // Balance
  // ============================================================

  @Column({
    type: DataType.DECIMAL(65, 0),
    allowNull: false,
    defaultValue: '0',
  })
  declare amount: string;

  // ============================================================
  // Sequence
  // ============================================================

  @Column({
    field: 'last_sequence_no',
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  declare lastSequenceNo: number;

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
