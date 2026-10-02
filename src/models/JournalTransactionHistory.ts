import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, ForeignKey, BelongsTo } from 'sequelize-typescript';

import { JournalTransaction } from './JournalTransaction';
import { TransactionState } from './TransactionState';
import { JOURNAL_TRANSACTION_STATE_IDS } from '../constants';
import type { JournalTransactionStateId } from '../constants';

@Table({
  tableName: 'journal_transaction_history',
  timestamps: false,

  indexes: [
    {
      name: 'idx_journal_transaction_history_journal_transaction',
      fields: ['journal_transaction_id', 'id'],
    },
  ],
})
export class JournalTransactionHistory extends Model {
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

  @Column({
    field: 'journal_transaction_state',
    type: DataType.INTEGER,
    allowNull: false,
    validate: {
      isIn: [[...JOURNAL_TRANSACTION_STATE_IDS]],
    },
  })
  declare journalTransactionState: JournalTransactionStateId;

  @Column({
    field: 'transaction_hash',
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare transactionHash: string | null;

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
