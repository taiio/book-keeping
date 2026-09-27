import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';

import { BookPurpose } from './BookPurpose';
import { TransactionState } from './TransactionState';
import { BookPosting } from './BookPosting';
import { BookHistory } from './BookHistory';

@Table({
  tableName: 'book',
  timestamps: false,

  indexes: [
    {
      unique: true,
      name: 'idx_unique_book',
      fields: ['client_id', 'account_id', 'asset_type_id', 'wallet_type_id', 'book_purpose_id', 'transaction_state_id'],
    },
  ],
})
export class Book extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({
    type: DataType.INTEGER(),
    allowNull: false,
  })
  declare id: number;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare name: string | null;

  @ForeignKey(() => BookPurpose)
  @Column({
    field: 'book_purpose_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare bookPurposeId: number;

  @BelongsTo(() => BookPurpose, {
    foreignKey: 'bookPurposeId',
    as: 'purpose',
  })
  declare purpose: BookPurpose;

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
  declare transactionState: TransactionState | null;

  @Column({
    field: 'client_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare clientId: number;

  @Column({
    field: 'account_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare accountId: number;

  @Column({
    field: 'asset_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare assetId: number;

  @Column({
    field: 'asset_type_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare assetTypeId: number;

  @Column({
    field: 'asset_ticker',
    type: DataType.STRING(50),
    allowNull: false,
  })
  declare assetTicker: string;

  @Column({
    field: 'wallet_type_id',
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare walletTypeId: number;

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
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare address: string | null; // the address is the node address. just only support when we staking. default null.

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

  @HasMany(() => BookPosting, {
    foreignKey: 'bookId',
    as: 'postings',
  })
  declare postings: BookPosting[];

  @HasMany(() => BookHistory, {
    foreignKey: 'bookId',
    as: 'histories',
  })
  declare histories: BookHistory[];
}
