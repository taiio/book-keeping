import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement } from 'sequelize-typescript';

import type { OutboxEventStatusId, OutboxEventTypeId } from '../constants';

@Table({
  tableName: 'outbox_event',
  timestamps: false,

  indexes: [
    { name: 'uk_outbox_event_aggregate_type_state_attempt', unique: true, fields: ['aggregate', 'event_type', 'state_id', 'attempt'] },
    { name: 'idx_outbox_event_ready', fields: ['status', 'next_attempt_at'] },
  ],
})
export class OutboxEvent extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.BIGINT, allowNull: false })
  declare id: string;

  /** What the event is about: the idempotency token of a journal transaction, or the uuidToken of a withdraw. */
  @Column({ type: DataType.STRING(64), allowNull: false })
  declare aggregate: string;

  @Column({ field: 'event_type', type: DataType.INTEGER, allowNull: false })
  declare eventType: OutboxEventTypeId;

  @Column({ field: 'state_id', type: DataType.INTEGER, allowNull: false })
  declare stateId: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
  declare attempt: number;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare payload: unknown;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare status: OutboxEventStatusId;

  /** Delivery attempts made by the relay. */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare attempts: number;

  @Column({ field: 'next_attempt_at', type: DataType.DATE, allowNull: false })
  declare nextAttemptAt: Date;

  @Column({ field: 'last_error', type: DataType.TEXT, allowNull: true })
  declare lastError: string | null;

  @Column({ field: 'created_at', type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ field: 'published_at', type: DataType.DATE, allowNull: true })
  declare publishedAt: Date | null;
}
