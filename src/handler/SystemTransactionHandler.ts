import { Transaction as SequelizeTransaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { UnitOfWork } from '../common/UnitOfWork';
import { JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE, TRANSACTION_STATE_SEQUENCE, TRANSACTION_TYPE } from '../constants';
import { NOT_WIRED_SUBMITTER, getAccountIds, getAccountingLegs, toTransactionEntity } from '../helpers';
import {
  AuthorizeResult,
  BlockchainSubmissionResult,
  IBlockchainSubmitter,
  Transaction as DomainTransaction,
  TransactionEntity,
} from '../interfaces';
import { JournalTransaction } from '../models';
import { LedgerPipeline } from './LedgerPipeline';

@singleton()
@autoInjectable()
export class SystemTransactionHandler {
  public blockchainSubmitter: IBlockchainSubmitter = NOT_WIRED_SUBMITTER;

  private readonly unitOfWork: UnitOfWork;
  private readonly ledgerPipeline: LedgerPipeline;

  constructor(unitOfWork?: UnitOfWork, ledgerPipeline?: LedgerPipeline) {
    this.unitOfWork = unitOfWork!;
    this.ledgerPipeline = ledgerPipeline!;
  }

  async handle(transaction: DomainTransaction, createdBy?: number): Promise<TransactionEntity> {
    this.validateInput(transaction);

    const authResult = await this.unitOfWork.execute((tx) => this.authorize(transaction, tx, createdBy));

    if (authResult.phase !== 'AUTHORIZED') {
      return toTransactionEntity(transaction, authResult.journalTransaction, authResult.transactionStateId, authResult.errorMessage);
    }

    return this.submitAndAdvance(transaction, authResult.journalTransaction, createdBy);
  }

  private validateInput(transaction: DomainTransaction): void {
    if (!transaction.idempotencyToken || !transaction.uuidToken) {
      throw new Error('Transaction is missing idempotencyToken/uuidToken.');
    }

    const { debitItems, creditItems, fee } = getAccountingLegs(transaction);

    if ([...debitItems, ...creditItems, fee].some((item) => !item.assetTicker)) {
      throw new Error('Transaction item is missing assetTicker.');
    }
  }

  private async authorize(transaction: DomainTransaction, tx: SequelizeTransaction, createdBy?: number): Promise<AuthorizeResult> {
    const { fromAccountId, toAccountId } = getAccountIds(transaction);

    const { journalTransaction, created } = await this.ledgerPipeline.openJournal(
      {
        idempotencyToken: transaction.idempotencyToken,
        uuidToken: transaction.uuidToken,
        transactionTypeId: TRANSACTION_TYPE[transaction.type],
        transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
        sourceContent: JSON.stringify(transaction),
        fromAccountId,
        toAccountId,
        createdBy,
      },
      tx,
    );

    if (!created) {
      const transactionStateId = await this.ledgerPipeline.getCurrentTransactionStateId(journalTransaction.id, tx);

      return { phase: 'REPLAYED', journalTransaction, transactionStateId };
    }

    const legs = getAccountingLegs(transaction);
    const idempotencyToken = journalTransaction.idempotencyToken ?? journalTransaction.uuidToken;
    const transactionTypeId = journalTransaction.transactionTypeId ?? TRANSACTION_TYPE[transaction.type];

    const reserved = await this.ledgerPipeline.reserve(
      { journalTransactionId: journalTransaction.id, uuidToken: journalTransaction.uuidToken, idempotencyToken, transactionTypeId, legs, createdBy },
      tx,
    );

    if (!reserved.ok) {
      const rejected = await this.ledgerPipeline.transition(
        {
          journalTransactionId: journalTransaction.id,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.REJECTED,
          updatedBy: createdBy,
        },
        tx,
      );

      return {
        phase: 'REJECTED',
        journalTransaction: rejected.journalTransaction,
        transactionStateId: rejected.transactionStateId,
        errorMessage: `Insufficient balance: ${reserved.shortfalls.join('; ')}`,
      };
    }

    const authorized = await this.ledgerPipeline.transition(
      {
        journalTransactionId: journalTransaction.id,
        targetTransactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
        expectedStateSequence: TRANSACTION_STATE_SEQUENCE,
        legs,
        onApplied: 'ADVANCE',
        updatedBy: createdBy,
      },
      tx,
    );

    return {
      phase: authorized.outcome === 'APPLIED' ? 'AUTHORIZED' : 'REPLAYED',
      journalTransaction: authorized.journalTransaction,
      transactionStateId: authorized.transactionStateId,
    };
  }

  private async submitAndAdvance(
    transaction: DomainTransaction,
    journalTransaction: JournalTransaction,
    createdBy?: number,
  ): Promise<TransactionEntity> {
    let submission: BlockchainSubmissionResult;

    try {
      submission = await this.blockchainSubmitter.submit(transaction, journalTransaction.id);
    } catch (error) {
      const rejected = await this.unitOfWork.execute(async (tx) => {
        return this.ledgerPipeline.transition(
          {
            journalTransactionId: journalTransaction.id,
            journalTransactionState: JOURNAL_TRANSACTION_STATE.REJECTED,
            legs: getAccountingLegs(transaction),
            onApplied: 'RELEASE',
            updatedBy: createdBy,
          },
          tx,
        );
      });

      return toTransactionEntity(
        transaction,
        rejected.journalTransaction,
        rejected.transactionStateId,
        error instanceof Error ? error.message : String(error),
      );
    }

    const sent = await this.unitOfWork.execute(async (tx) => {
      return this.ledgerPipeline.transition(
        {
          journalTransactionId: journalTransaction.id,
          transactionHash: submission.transactionHash,
          targetTransactionStateId: TRANSACTION_STATE.SENT.id,
          expectedStateSequence: TRANSACTION_STATE_SEQUENCE,
          legs: getAccountingLegs(transaction),
          onApplied: 'ADVANCE',
          updatedBy: createdBy,
        },
        tx,
      );
    });

    return toTransactionEntity(transaction, sent.journalTransaction, sent.transactionStateId);
  }
}
