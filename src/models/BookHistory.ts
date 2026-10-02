import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, ForeignKey, BelongsTo } from 'sequelize-typescript';

import { Book } from './Book';
import { BookPosting } from './BookPosting';

@Table({
  tableName: 'book_history',
  timestamps: false,

  indexes: [
    {
      name: 'idx_book_history_book',
      fields: ['book_id', 'id'],
    },
  ],
})
export class BookHistory extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare id: number;

  @Column({
    field: 'history_transaction_type_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare historyTransactionTypeId: number;

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

  @Column({
    type: DataType.DECIMAL(65, 0),
    allowNull: false,
    defaultValue: '0',
  })
  declare amount: string;

  @Column({
    field: 'last_sequence_no',
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  declare lastSequenceNo: number;

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
