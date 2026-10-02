import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { INBOX_EVENT_KIND } from '../../constants';
import { BlockchainEventHandler } from '../../handlers/BlockchainEventHandler';
import { aggregateOutcome } from '../../helpers';
import type { InboxEventHandler } from '../../ports';
import type { BlockchainMessagePayload, InboxHandlerOutcome } from '../../types';

/** Events reported by the blockchain. Kafka key: transactionHash. */
@singleton()
@autoInjectable()
export class BlockchainInboxHandler implements InboxEventHandler<BlockchainMessagePayload> {
  readonly kind = INBOX_EVENT_KIND.BLOCKCHAIN_EVENT;

  private readonly handler: BlockchainEventHandler;

  constructor(handler?: BlockchainEventHandler) {
    this.handler = handler!;
  }

  orderingKey(payload: BlockchainMessagePayload): string {
    return payload.transactionHash;
  }

  targetStateId(payload: BlockchainMessagePayload): number {
    return payload.status;
  }

  async handle(payload: BlockchainMessagePayload, tx: Transaction): Promise<InboxHandlerOutcome> {
    const results = await this.handler.applyInTransaction(payload, tx);

    return { outcome: aggregateOutcome(results), journalTransactionId: results[0]?.journalTransactionId ?? null };
  }
}
