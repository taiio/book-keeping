import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { TRANSACTION_TYPE } from '../constants';
import type { JournalTransaction } from '../models';
import { BookPostingRepository } from '../repositories/BookPostingRepository';
import type { Holding, QuantityItem } from '../types';
import { assertSettlementBalanced } from './settlement';

@singleton()
@autoInjectable()
export class ConservationVerifier {
  private readonly bookPostingRepository: BookPostingRepository;

  constructor(bookPostingRepository?: BookPostingRepository) {
    this.bookPostingRepository = bookPostingRepository!;
  }

  async verifyWithdrawSettlement(
    journalTransactions: readonly JournalTransaction[],
    externalRecipients: readonly QuantityItem[],
    context: string,
    tx: Transaction,
  ): Promise<void> {
    const senders = journalTransactions.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.WITHDRAW);

    if (senders.length === 0) return;

    const recipients = journalTransactions.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.DEPOSIT);

    assertSettlementBalanced(await this.holdingsOf(senders, tx), await this.holdingsOf(recipients, tx), externalRecipients, context);
  }

  private async holdingsOf(journalTransactions: readonly JournalTransaction[], tx: Transaction): Promise<Holding[]> {
    const holdings: Holding[] = [];

    for (const journalTransaction of journalTransactions) {
      holdings.push(...(await this.bookPostingRepository.findHoldings(journalTransaction.id, tx)));
    }

    return holdings;
  }
}
