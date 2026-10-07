import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { TransitionNotReadyError } from '../common/errors';
import { createLogger } from '../common/logger';
import { stateName, transactionTypeName } from '../common/logLabels';
import { OUTBOX_EVENT_TYPE, POSTING_TOKEN, TRANSACTION_STATE, TRANSACTION_TYPE, TRANSITION_OUTCOME } from '../constants';
import type { TransitionOutcome } from '../constants';
import { aggregateOutcome, isFeePaidBy, isInternalItem } from '../helpers';
import { LedgerPipeline } from '../ledger/LedgerPipeline';
import { isExceptionState } from '../ledger/transitionRules';
import type { JournalTransaction } from '../models';
import { OutboxEventRepository } from '../repositories/OutboxEventRepository';
import type { GetOrCreateJournalTransactionParams, SystemTransactionResult, Withdraw, WithdrawJournalTransactions } from '../types';
import { validateWithdraw } from '../validation';
import { buildClosingRequests } from './requests/closingRequests';
import { buildWithdrawRequests } from './requests/withdrawRequests';

const log = createLogger('withdraw');

@singleton()
@autoInjectable()
export class SystemTransactionHandler {
  private readonly ledgerPipeline: LedgerPipeline;
  private readonly outboxEventRepository: OutboxEventRepository;

  constructor(ledgerPipeline?: LedgerPipeline, outboxEventRepository?: OutboxEventRepository) {
    this.ledgerPipeline = ledgerPipeline!;
    this.outboxEventRepository = outboxEventRepository!;
  }

  async applyInTransaction(withdraw: Withdraw, tx: Transaction): Promise<SystemTransactionResult> {
    const state = stateName(withdraw.transactionStateId);

    log.info('withdraw event received', {
      uuidToken: withdraw.uuidToken,
      state,
      senders: withdraw.sender.length,
      recipients: withdraw.recipient.length,
    });

    validateWithdraw(withdraw);

    const journalTransactions = await this.execute(withdraw, tx);
    const outcome = aggregateOutcome(journalTransactions.results);

    log.info('withdraw event handled', {
      uuidToken: withdraw.uuidToken,
      state,
      outcome,
      senderJournalTransactions: journalTransactions.senders.length,
      recipientJournalTransactions: journalTransactions.recipients.length,
    });

    if (withdraw.transactionStateId === TRANSACTION_STATE.SENT.id && outcome === TRANSITION_OUTCOME.APPLIED) {
      await this.outboxEventRepository.enqueue(
        {
          aggregate: withdraw.uuidToken,
          eventType: OUTBOX_EVENT_TYPE.BROADCAST_REQUESTED,
          stateId: TRANSACTION_STATE.SENT.id,
          attempt: POSTING_TOKEN.FIRST_ATTEMPT,
          payload: withdraw,
        },
        tx,
      );

      log.info('broadcast requested', { uuidToken: withdraw.uuidToken });
    }

    return this.buildResult(withdraw, journalTransactions, outcome);
  }

  private execute(withdraw: Withdraw, tx: Transaction): Promise<WithdrawJournalTransactions> {
    const { transactionStateId } = withdraw;

    if (transactionStateId === TRANSACTION_STATE.AUTHORIZING.id) {
      log.debug('authorizing: creating journal transactions', { uuidToken: withdraw.uuidToken });
      return this.authorize(withdraw, tx);
    }

    if (isExceptionState(transactionStateId)) {
      log.debug('closing the withdraw', { uuidToken: withdraw.uuidToken, state: stateName(transactionStateId) });
      return this.close(withdraw, tx);
    }

    log.debug('advancing the withdraw', { uuidToken: withdraw.uuidToken, state: stateName(transactionStateId) });

    return this.advance(withdraw, tx);
  }

  private async authorize(withdraw: Withdraw, tx: Transaction): Promise<WithdrawJournalTransactions> {
    const senders = await this.createSenderJournalTransactions(withdraw, tx);
    const recipients = await this.createRecipientJournalTransactions(withdraw, tx);
    const results = await this.ledgerPipeline.processTransition(buildWithdrawRequests(withdraw, senders), tx);

    return { senders, recipients, results };
  }

  private async advance(withdraw: Withdraw, tx: Transaction): Promise<WithdrawJournalTransactions> {
    const { senders, recipients } = await this.loadJournalTransactions(withdraw, tx);
    const results = await this.ledgerPipeline.processTransition(buildWithdrawRequests(withdraw, senders), tx);

    return { senders, recipients, results };
  }

  private async close(withdraw: Withdraw, tx: Transaction): Promise<WithdrawJournalTransactions> {
    const { senders, recipients } = await this.loadJournalTransactions(withdraw, tx);
    const results = await this.ledgerPipeline.processTransition(buildClosingRequests([...senders, ...recipients], withdraw.transactionStateId), tx);

    return { senders, recipients, results };
  }

  private async loadJournalTransactions(withdraw: Withdraw, tx: Transaction): Promise<Pick<WithdrawJournalTransactions, 'senders' | 'recipients'>> {
    const existing = await this.ledgerPipeline.findByUuidToken(withdraw.uuidToken, tx);
    const senders = existing.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.WITHDRAW);

    if (senders.length === 0) throw new TransitionNotReadyError(withdraw.uuidToken, null, withdraw.transactionStateId);

    return { senders, recipients: existing.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.DEPOSIT) };
  }

  private createSenderJournalTransactions(withdraw: Withdraw, tx: Transaction): Promise<JournalTransaction[]> {
    const feeBelongsToSender = withdraw.sender.some((sender) => isFeePaidBy(withdraw.fee, sender));

    const items = [
      ...withdraw.sender.map((sender) => ({ idempotencyToken: sender.idempotencyToken, fromAccountId: sender.account!.accountId })),
      ...(feeBelongsToSender ? [] : [{ idempotencyToken: withdraw.fee.idempotencyToken, fromAccountId: withdraw.fee.account.accountId }]),
    ];

    return this.createJournalTransactions(
      withdraw,
      items.map((item) => ({ ...item, transactionTypeId: TRANSACTION_TYPE.WITHDRAW })),
      tx,
    );
  }

  private createRecipientJournalTransactions(withdraw: Withdraw, tx: Transaction): Promise<JournalTransaction[]> {
    const items = withdraw.recipient.filter(isInternalItem).map((recipient) => ({
      idempotencyToken: recipient.idempotencyToken,
      toAccountId: recipient.account.accountId,
      transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
    }));

    return this.createJournalTransactions(withdraw, items, tx);
  }

  private async createJournalTransactions(
    withdraw: Withdraw,
    items: Array<Omit<GetOrCreateJournalTransactionParams, 'uuidToken'>>,
    tx: Transaction,
  ): Promise<JournalTransaction[]> {
    const journalTransactions: JournalTransaction[] = [];

    for (const item of items) {
      const journalTransaction = await this.ledgerPipeline.createJournalTransaction({ uuidToken: withdraw.uuidToken, ...item }, tx);

      log.debug('journal transaction ready', {
        uuidToken: withdraw.uuidToken,
        journalTransactionId: journalTransaction.id,
        idempotencyToken: item.idempotencyToken,
        type: transactionTypeName(item.transactionTypeId),
      });
      journalTransactions.push(journalTransaction);
    }

    return journalTransactions;
  }

  private buildResult(withdraw: Withdraw, journalTransactions: WithdrawJournalTransactions, outcome: TransitionOutcome): SystemTransactionResult {
    return {
      uuidToken: withdraw.uuidToken,
      processed: outcome === TRANSITION_OUTCOME.APPLIED,
      outcome,
      transactionHash: journalTransactions.senders.find((jt) => jt.transactionHash)?.transactionHash ?? null,
      senderJournalTransactionIds: journalTransactions.senders.map((jt) => jt.id),
      recipientJournalTransactionIds: journalTransactions.recipients.map((jt) => jt.id),
    };
  }
}
