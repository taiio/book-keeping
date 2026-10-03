import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { TransitionNotReadyError } from '../common/errors';
import { UnitOfWork } from '../common/UnitOfWork';
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

@singleton()
@autoInjectable()
export class SystemTransactionHandler {
  private readonly unitOfWork: UnitOfWork;
  private readonly ledgerPipeline: LedgerPipeline;
  private readonly outboxEventRepository: OutboxEventRepository;

  constructor(unitOfWork?: UnitOfWork, ledgerPipeline?: LedgerPipeline, outboxEventRepository?: OutboxEventRepository) {
    this.unitOfWork = unitOfWork!;
    this.ledgerPipeline = ledgerPipeline!;
    this.outboxEventRepository = outboxEventRepository!;
  }

  handle(withdraw: Withdraw): Promise<SystemTransactionResult> {
    return this.unitOfWork.execute((tx) => this.applyInTransaction(withdraw, tx));
  }

  async applyInTransaction(withdraw: Withdraw, tx: Transaction): Promise<SystemTransactionResult> {
    validateWithdraw(withdraw);

    const journalTransactions = await this.execute(withdraw, tx);
    const outcome = aggregateOutcome(journalTransactions.results);

    if (withdraw.transactionStateId === TRANSACTION_STATE.SENT.id && outcome === TRANSITION_OUTCOME.APPLIED) {
      await this.outboxEventRepository.enqueue(
        { aggregate: withdraw.uuidToken, eventType: OUTBOX_EVENT_TYPE.BROADCAST_REQUESTED, stateId: TRANSACTION_STATE.SENT.id, attempt: POSTING_TOKEN.FIRST_ATTEMPT, payload: withdraw },
        tx,
      );
    }

    return this.buildResult(withdraw, journalTransactions, outcome);
  }

  private execute(withdraw: Withdraw, tx: Transaction): Promise<WithdrawJournalTransactions> {
    const { transactionStateId } = withdraw;

    if (transactionStateId === TRANSACTION_STATE.AUTHORIZING.id) return this.authorize(withdraw, tx);
    if (isExceptionState(transactionStateId)) return this.close(withdraw, tx);

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
    const sourceContent = JSON.stringify(withdraw);
    const feeBelongsToSender = withdraw.sender.some((sender) => isFeePaidBy(withdraw.fee, sender));

    const items = [
      ...withdraw.sender.map((sender) => ({ idempotencyToken: sender.idempotencyToken, fromAccountId: sender.account!.accountId })),
      ...(feeBelongsToSender ? [] : [{ idempotencyToken: withdraw.fee.idempotencyToken, fromAccountId: withdraw.fee.account.accountId }]),
    ];

    return this.createJournalTransactions(withdraw, items.map((item) => ({ ...item, transactionTypeId: TRANSACTION_TYPE.WITHDRAW, sourceContent })), tx);
  }

  private createRecipientJournalTransactions(withdraw: Withdraw, tx: Transaction): Promise<JournalTransaction[]> {
    const sourceContent = JSON.stringify(withdraw);

    const items = withdraw.recipient.filter(isInternalItem).map((recipient) => ({
      idempotencyToken: recipient.idempotencyToken,
      toAccountId: recipient.account.accountId,
      transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
      sourceContent,
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
      journalTransactions.push(await this.ledgerPipeline.createJournalTransaction({ uuidToken: withdraw.uuidToken, ...item }, tx));
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
