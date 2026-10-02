import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { INBOX_EVENT_KIND } from '../../constants';
import { SystemTransactionHandler } from '../../handlers/SystemTransactionHandler';
import type { InboxEventHandler } from '../../ports';
import type { InboxHandlerOutcome, Withdraw } from '../../types';

/** Messages the system itself sends (withdraw, ...). Kafka key: uuidToken. */
@singleton()
@autoInjectable()
export class SystemTransactionInboxHandler implements InboxEventHandler<Withdraw> {
  readonly kind = INBOX_EVENT_KIND.SYSTEM_TRANSACTION;

  private readonly handler: SystemTransactionHandler;

  constructor(handler?: SystemTransactionHandler) {
    this.handler = handler!;
  }

  orderingKey(payload: Withdraw): string {
    return payload.uuidToken;
  }

  targetStateId(payload: Withdraw): number {
    return payload.transactionStateId;
  }

  async handle(payload: Withdraw, tx: Transaction): Promise<InboxHandlerOutcome> {
    const result = await this.handler.applyInTransaction(payload, tx);

    return { outcome: result.outcome, journalTransactionId: result.senderJournalTransactionIds[0] ?? null };
  }
}
