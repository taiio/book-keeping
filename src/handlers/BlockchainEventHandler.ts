import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { TransitionNotReadyError } from '../common/errors';
import { UnitOfWork } from '../common/UnitOfWork';
import { BLOCKCHAIN_TRANSACTION_STATE_ID, TRANSACTION_TYPE } from '../constants';
import { deterministicUuid } from '../helpers';
import { LedgerPipeline } from '../ledger/LedgerPipeline';
import type { JournalTransaction } from '../models';
import type { BlockchainMessagePayload, TransitionResult } from '../types';
import { validateBlockchainMessage } from '../validation';
import { buildBlockchainRequests } from './requests/blockchainRequests';

@singleton()
@autoInjectable()
export class BlockchainEventHandler {
  private readonly unitOfWork: UnitOfWork;
  private readonly ledgerPipeline: LedgerPipeline;

  constructor(unitOfWork?: UnitOfWork, ledgerPipeline?: LedgerPipeline) {
    this.unitOfWork = unitOfWork!;
    this.ledgerPipeline = ledgerPipeline!;
  }

  handle(payload: BlockchainMessagePayload): Promise<TransitionResult[]> {
    return this.unitOfWork.execute((tx) => this.applyInTransaction(payload, tx));
  }

  async applyInTransaction(payload: BlockchainMessagePayload, tx: Transaction): Promise<TransitionResult[]> {
    validateBlockchainMessage(payload);

    const journalTransactions = await this.resolveJournalTransactions(payload, tx);

    return this.ledgerPipeline.processTransition(buildBlockchainRequests(journalTransactions, payload), tx);
  }

  private async resolveJournalTransactions(payload: BlockchainMessagePayload, tx: Transaction): Promise<JournalTransaction[]> {
    const byHash = await this.ledgerPipeline.findByTransactionHash(payload.transactionHash, tx);

    if (byHash.length > 0) return byHash;

    const outgoingTokens = [...payload.senders.map((sender) => sender.idempotencyToken), payload.networkFee.idempotencyToken].filter((token): token is string => !!token);
    const outgoing = await this.ledgerPipeline.findByIdempotencyTokens(outgoingTokens, tx);

    if (outgoing.length > 0 || payload.status !== BLOCKCHAIN_TRANSACTION_STATE_ID.CONFIRMING) {
      throw new TransitionNotReadyError(payload.transactionHash, null, payload.status);
    }

    return this.createDepositJournalTransactions(payload, tx);
  }

  private async createDepositJournalTransactions(payload: BlockchainMessagePayload, tx: Transaction): Promise<JournalTransaction[]> {
    const uuidToken = payload.uuidToken ?? deterministicUuid(payload.transactionHash);
    const journalTransactions: JournalTransaction[] = [];

    for (const recipient of payload.recipients.filter((item) => item.account)) {
      journalTransactions.push(
        await this.ledgerPipeline.createJournalTransaction(
          {
            uuidToken,
            idempotencyToken: recipient.idempotencyToken!,
            transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
            toAccountId: recipient.account!.accountId,
            transactionHash: payload.transactionHash,
          },
          tx,
        ),
      );
    }

    return journalTransactions;
  }
}
