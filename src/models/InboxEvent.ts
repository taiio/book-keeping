import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement } from 'sequelize-typescript';

import type { InboxEventKindId, InboxEventStatusId } from '../constants';

@Table({
  tableName: 'inbox_event',
  timestamps: false,

  indexes: [
    { name: 'uk_inbox_event_event_id', unique: true, fields: ['event_id'] },
    { name: 'idx_inbox_event_ready', fields: ['status', 'next_attempt_at'] },
    { name: 'idx_inbox_event_journal_transaction', fields: ['journal_transaction_id'] },
    { name: 'idx_inbox_event_ordering_key', fields: ['ordering_key'] },
  ],
})
export class InboxEvent extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.BIGINT, allowNull: false })
  declare id: string;

  /** Unique id set by the producer. The deduplication key of the whole message. */
  @Column({ field: 'event_id', type: DataType.STRING(64), allowNull: false })
  declare eventId: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare kind: InboxEventKindId;

  @Column({ type: DataType.STRING(64), allowNull: true })
  declare source: string | null;

  /** uuidToken for system messages, transactionHash for blockchain events (the Kafka message key). */
  @Column({ field: 'ordering_key', type: DataType.STRING(255), allowNull: false })
  declare orderingKey: string;

  @Column({ field: 'target_state_id', type: DataType.INTEGER, allowNull: true })
  declare targetStateId: number | null;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare payload: unknown;

  @Column({ field: 'payload_hash', type: DataType.STRING(64), allowNull: false })
  declare payloadHash: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare status: InboxEventStatusId;

  /** How many times this event id was delivered. `deliveryCount - 1` is the number of replays. */
  @Column({ field: 'delivery_count', type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
  declare deliveryCount: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare attempts: number;

  @Column({ field: 'journal_transaction_id', type: DataType.INTEGER, allowNull: true })
  declare journalTransactionId: number | null;

  @Column({ field: 'last_error', type: DataType.TEXT, allowNull: true })
  declare lastError: string | null;

  @Column({ field: 'first_received_at', type: DataType.DATE, allowNull: false })
  declare firstReceivedAt: Date;

  @Column({ field: 'last_received_at', type: DataType.DATE, allowNull: false })
  declare lastReceivedAt: Date;

  @Column({ field: 'next_attempt_at', type: DataType.DATE, allowNull: false })
  declare nextAttemptAt: Date;

  @Column({ field: 'applied_at', type: DataType.DATE, allowNull: true })
  declare appliedAt: Date | null;
}
