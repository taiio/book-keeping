import { randomUUID } from 'crypto';
import { Transaction as SequelizeTransaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { UnitOfWork } from '../common/UnitOfWork';
import { NotFoundError } from '../common/errors';
import {
  BLOCKCHAIN_TRANSACTION_STATUS,
  JOURNAL_TRANSACTION_STATE,
  TRANSACTION_STATE,
  TRANSACTION_STATE_IDS_FAILABLE_BY_BLOCKCHAIN,
  TRANSACTION_STATE_SEQUENCE,
  TRANSACTION_TYPE,
} from '../constants';
import { custodyBookParams, getAccountingLegs, matchesSender, parseSourceContent, toDepositEntity, toTransactionEntity } from '../helpers';
import {
  BlockchainDrivenEntity,
  BlockchainMessagePayload,
  DepositBookMatch,
  DepositTransactionEntity,
  Transaction as DomainTransaction,
  TransactionEntity,
} from '../interfaces';
import { JournalTransaction } from '../models';
import { BookRepository } from '../repositories/Book';
import { JournalTransactionRepository } from '../repositories/JournalTransaction';
import { LedgerPipeline } from './LedgerPipeline';

@singleton()
@autoInjectable()
export class BlockchainEventHandler {
  private readonly unitOfWork: UnitOfWork;
  private readonly journalTransactionRepository: JournalTransactionRepository;
  private readonly bookRepository: BookRepository;
  private readonly ledgerPipeline: LedgerPipeline;

  constructor(
    unitOfWork?: UnitOfWork,
    journalTransactionRepository?: JournalTransactionRepository,
    bookRepository?: BookRepository,
    ledgerPipeline?: LedgerPipeline,
  ) {
    this.unitOfWork = unitOfWork!;
    this.journalTransactionRepository = journalTransactionRepository!;
    this.bookRepository = bookRepository!;
    this.ledgerPipeline = ledgerPipeline!;
  }

  async handle(payload: BlockchainMessagePayload, createdBy?: number): Promise<BlockchainDrivenEntity> {
    this.validatePayload(payload);

    return this.unitOfWork.execute(async (tx) => {
      const existing = await this.journalTransactionRepository.findByTransactionHash(payload.transactionHash, tx);

      if (existing && existing.transactionTypeId !== TRANSACTION_TYPE.DEPOSIT) {
        const original = parseSourceContent(existing);

        if (matchesSender(original, payload)) {
          return this.processExistingTransaction(existing, original, payload, tx, createdBy);
        }
      }

      return this.processDeposit(payload, tx, createdBy);
    });
  }

  private validatePayload(payload: BlockchainMessagePayload): void {
    if (!payload.transactionHash || !payload.status) {
      throw new Error('BlockchainMessagePayload is missing transactionHash/status.');
    }
  }

  private async processExistingTransaction(
    existing: JournalTransaction,
    original: DomainTransaction | null,
    payload: BlockchainMessagePayload,
    tx: SequelizeTransaction,
    createdBy?: number,
  ): Promise<TransactionEntity> {
    const legs = original ? getAccountingLegs(original) : null;

    const base = { journalTransactionId: existing.id, transactionHash: payload.transactionHash, updatedBy: createdBy };

    switch (payload.status) {
      case BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING: {
        const result = await this.ledgerPipeline.transition(
          {
            ...base,
            targetTransactionStateId: TRANSACTION_STATE.CONFIRMING.id,
            expectedStateSequence: TRANSACTION_STATE_SEQUENCE,
            legs,
            onApplied: 'ADVANCE',
          },
          tx,
        );

        return toTransactionEntity(original, result.journalTransaction, result.transactionStateId);
      }

      case BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED: {
        const result = await this.ledgerPipeline.transition(
          {
            ...base,
            targetTransactionStateId: TRANSACTION_STATE.CONFIRMED.id,
            expectedStateSequence: TRANSACTION_STATE_SEQUENCE,
            journalTransactionState: JOURNAL_TRANSACTION_STATE.COMPLETED,
            legs,
            onApplied: 'SETTLE',
          },
          tx,
        );

        return toTransactionEntity(original, result.journalTransaction, result.transactionStateId);
      }

      case BLOCKCHAIN_TRANSACTION_STATUS.FAILED: {
        const currentStateId = await this.ledgerPipeline.getCurrentTransactionStateId(existing.id, tx);

        if (currentStateId == null || !TRANSACTION_STATE_IDS_FAILABLE_BY_BLOCKCHAIN.includes(currentStateId)) {
          return toTransactionEntity(original, existing, currentStateId);
        }

        const result = await this.ledgerPipeline.transition(
          { ...base, journalTransactionState: JOURNAL_TRANSACTION_STATE.FAILED, legs, onApplied: 'RELEASE' },
          tx,
        );

        return toTransactionEntity(original, result.journalTransaction, result.transactionStateId, payload.error?.message);
      }
    }
  }

  private async findOrCreateDepositBook(payload: BlockchainMessagePayload, tx: SequelizeTransaction): Promise<DepositBookMatch | null> {
    for (const recipient of payload.recipients) {
      const book = await this.bookRepository.findByDepositAddress(recipient.address, recipient.assetTicker, tx);

      if (book) {
        return { book, recipient };
      }
    }

    for (const recipient of payload.recipients) {
      if (!recipient.account) {
        continue;
      }

      const { book } = await this.bookRepository.getOrCreateBook(
        {
          ...custodyBookParams(
            { ...recipient.account, assetTicker: recipient.assetTicker, quantity: recipient.quantity },
            TRANSACTION_STATE.CONFIRMED.id,
          ),
          address: recipient.address,
        },
        tx,
      );

      return { book, recipient };
    }

    return null;
  }

  private async processDeposit(payload: BlockchainMessagePayload, tx: SequelizeTransaction, createdBy?: number): Promise<DepositTransactionEntity> {
    const matched = await this.findOrCreateDepositBook(payload, tx);

    if (!matched) {
      throw new NotFoundError('DepositAddress', payload.recipients.map((recipient) => recipient.address).join(','));
    }

    const { book, recipient } = matched;

    const opened = await this.ledgerPipeline.openJournal(
      {
        idempotencyToken: payload.idempotencyToken,
        uuidToken: randomUUID(),
        transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
        transactionHash: payload.transactionHash,
        transactionStateId: TRANSACTION_STATE.CONFIRMING.id,

        toAccountId: book.accountId,
        createdBy,
      },
      tx,
    );

    let journalTransaction = opened.journalTransaction;
    let currentStateId: number | null = TRANSACTION_STATE.CONFIRMING.id;

    const movement = {
      journalTransactionId: journalTransaction.id,
      uuidToken: journalTransaction.uuidToken,
      idempotencyToken: journalTransaction.idempotencyToken ?? journalTransaction.uuidToken,
      transactionTypeId: journalTransaction.transactionTypeId ?? TRANSACTION_TYPE.DEPOSIT,
      matchedCustodyBook: book,
      quantity: recipient.quantity,
      createdBy,
    };
    const base = { journalTransactionId: journalTransaction.id, transactionHash: payload.transactionHash, updatedBy: createdBy };

    if (opened.created) {
      await this.ledgerPipeline.postDeposit(TRANSACTION_STATE.CONFIRMING.code, movement, tx);
    } else {
      currentStateId = await this.ledgerPipeline.getCurrentTransactionStateId(journalTransaction.id, tx);
    }

    if (payload.status === BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED) {
      const result = await this.ledgerPipeline.transition(
        { ...base, targetTransactionStateId: TRANSACTION_STATE.CONFIRMED.id, journalTransactionState: JOURNAL_TRANSACTION_STATE.COMPLETED },
        tx,
      );

      journalTransaction = result.journalTransaction;
      currentStateId = result.transactionStateId;

      if (result.outcome === 'APPLIED') {
        await this.ledgerPipeline.postDeposit(TRANSACTION_STATE.CONFIRMED.code, movement, tx);
      }
    } else if (payload.status === BLOCKCHAIN_TRANSACTION_STATUS.FAILED) {
      const result = await this.ledgerPipeline.transition({ ...base, journalTransactionState: JOURNAL_TRANSACTION_STATE.FAILED }, tx);

      journalTransaction = result.journalTransaction;
      currentStateId = result.transactionStateId;

      if (result.outcome === 'APPLIED') {
        await this.ledgerPipeline.postDeposit('FAILED', movement, tx);
      }
    }

    return toDepositEntity(journalTransaction, currentStateId, recipient, book);
  }
}
