import { Table, Column, Model, DataType, PrimaryKey, HasMany } from 'sequelize-typescript';

import { Book } from './Book';

@Table({
  tableName: 'transaction_state',
  timestamps: false,
})
export class TransactionState extends Model {
  @PrimaryKey
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare id: number;

  @Column({
    type: DataType.STRING(50),
    allowNull: false,
    unique: true,
  })
  declare code: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  declare name: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare description: string | null;

  @Column({
    field: 'created_date',
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare createdDate: Date;

  @HasMany(() => Book, {
    foreignKey: 'transactionStateId',
    as: 'books',
  })
  declare books: Book[];
}
