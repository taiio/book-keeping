import { inject, autoInjectable, singleton } from 'tsyringe';

import { UnitOfWork } from '../common/UnitOfWork';
import { UnsupportedOperationError } from '../common/errors';
import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';
import type { IBlockchainSubmitter, LedgerLeg, TransitionRequest, Withdraw } from '../interfaces';
import type { JournalTransaction } from '../models';
import { LedgerPipeline } from './LedgerPipeline';
import { isInternalRecipient, type SystemTransactionResult } from '../interfaces/SystemTransactionHandler';

export const BLOCKCHAIN_SUBMITTER = 'IBlockchainSubmitter';

@singleton()
@autoInjectable()
export class SystemTransactionHandler {
  private readonly unitOfWork: UnitOfWork;
  private readonly ledgerPipeline: LedgerPipeline;
  private readonly blockchainSubmitter: IBlockchainSubmitter;

  constructor(
    unitOfWork?: UnitOfWork,
    ledgerPipeline?: LedgerPipeline,
    @inject(BLOCKCHAIN_SUBMITTER)
    blockchainSubmitter?: IBlockchainSubmitter,
  ) {
    this.unitOfWork = unitOfWork!;
    this.ledgerPipeline = ledgerPipeline!;
    this.blockchainSubmitter = blockchainSubmitter!;
  }

  async handle(withdraw: Withdraw): Promise<SystemTransactionResult> {
    this.validate(withdraw);

    const created = await this.unitOfWork.execute(async (tx) => {
      const existing = await this.ledgerPipeline.findByUuidToken(withdraw.uuidToken, tx);

      if (existing.length > 0) return null;

      const senders = await this.createSenderJournalTransactions(withdraw, tx);
      const recipients = await this.createRecipientJournalTransactions(withdraw, tx);

      await this.ledgerPipeline.processTransition(this.senderRequests(withdraw, senders, TRANSACTION_STATE.AUTHORIZING.id), tx);

      return { senders, recipients };
    });

    if (!created) {
      return {
        uuidToken: withdraw.uuidToken,
        processed: false,
        transactionHash: null,
        senderJournalTransactionIds: [],
        recipientJournalTransactionIds: [],
      };
    }

    const { senders, recipients } = created;

    for (const stateId of [TRANSACTION_STATE.AUTHORIZED.id, TRANSACTION_STATE.SENT.id]) {
      await this.unitOfWork.execute((tx) => this.ledgerPipeline.processTransition(this.senderRequests(withdraw, senders, stateId), tx));
    }

    const { transactionHash } = await this.blockchainSubmitter.submit(withdraw, senders[0].id);

    const allIds = [...senders, ...recipients].map((jt) => jt.id);

    await this.unitOfWork.execute((tx) => this.ledgerPipeline.attachTransactionHash(allIds, transactionHash, tx));

    return {
      uuidToken: withdraw.uuidToken,
      processed: true,
      transactionHash,
      senderJournalTransactionIds: senders.map((jt) => jt.id),
      recipientJournalTransactionIds: recipients.map((jt) => jt.id),
    };
  }

  private validate(withdraw: Withdraw): void {
    if (withdraw.type !== TRANSACTION_TYPE.WITHDRAW) throw new UnsupportedOperationError(`transaction type ${(withdraw as { type: number }).type}`);
    if (!withdraw.uuidToken) throw new Error('uuidToken is required');
    if (!withdraw.sender?.length) throw new Error('At least one sender is required');
    if (!withdraw.fee) throw new Error('Exactly one fee is required');

    for (const item of [...withdraw.sender, withdraw.fee]) {
      if (!/^[1-9]\d*$/.test(item.quantity)) throw new Error(`Quantity must be a positive integer string: ${item.quantity}`);
      if (!item.idempotencyToken) throw new Error('idempotencyToken is required on every item');
    }
  }

  private async createSenderJournalTransactions(
    withdraw: Withdraw,
    tx: Parameters<Parameters<UnitOfWork['execute']>[0]>[0],
  ): Promise<JournalTransaction[]> {
    const sourceContent = JSON.stringify(withdraw);
    const journalTransactions: JournalTransaction[] = [];

    for (const sender of withdraw.sender) {
      journalTransactions.push(
        await this.ledgerPipeline.createJournalTransaction(
          {
            uuidToken: withdraw.uuidToken,
            idempotencyToken: sender.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.WITHDRAW,
            fromAccountId: sender.accountId ?? null,
            sourceContent,
          },
          tx,
        ),
      );
    }

    return journalTransactions;
  }

  private async createRecipientJournalTransactions(
    withdraw: Withdraw,
    tx: Parameters<Parameters<UnitOfWork['execute']>[0]>[0],
  ): Promise<JournalTransaction[]> {
    const sourceContent = JSON.stringify(withdraw);
    const journalTransactions: JournalTransaction[] = [];

    for (const recipient of withdraw.recipient.filter(isInternalRecipient)) {
      journalTransactions.push(
        await this.ledgerPipeline.createJournalTransaction(
          {
            uuidToken: withdraw.uuidToken,
            idempotencyToken: recipient.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
            toAccountId: recipient.accountId ?? null,
            sourceContent,
          },
          tx,
        ),
      );
    }

    return journalTransactions;
  }

  private senderRequests(withdraw: Withdraw, senders: JournalTransaction[], targetStateId: number): TransitionRequest[] {
    return senders.map((journalTransaction, i) => {
      const item = withdraw.sender[i];
      const legs: LedgerLeg[] = [{ item, amount: item.quantity, purpose: BOOK_POSTING_PURPOSE.AMOUNT }];

      if (i === 0) legs.push({ item: withdraw.fee, amount: withdraw.fee.quantity, purpose: BOOK_POSTING_PURPOSE.FEE });

      return { journalTransaction, targetStateId, legs };
    });
  }
}
