import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { TransitionNotReadyError } from '../common/errors';
import { createLogger } from '../common/logger';
import { stateName } from '../common/logLabels';
import { BLOCKCHAIN_TRANSACTION_STATE_ID, EXCEPTION_STATE_IDS, TRANSACTION_TYPE, TRANSITION_OUTCOME } from '../constants';
import { aggregateOutcome, deterministicUuid } from '../helpers';
import { ConservationVerifier } from '../ledger/ConservationVerifier';
import { LedgerPipeline } from '../ledger/LedgerPipeline';
import type { JournalTransaction } from '../models';
import type { BlockchainMessagePayload, TransitionResult } from '../types';
import { validateBlockchainMessage } from '../validation';
import { buildBlockchainRequests } from './requests/blockchainRequests';

const log = createLogger('blockchain');

@singleton()
@autoInjectable()
export class BlockchainEventHandler {
  private readonly ledgerPipeline: LedgerPipeline;
  private readonly conservationVerifier: ConservationVerifier;

  constructor(ledgerPipeline?: LedgerPipeline, conservationVerifier?: ConservationVerifier) {
    this.ledgerPipeline = ledgerPipeline!;
    this.conservationVerifier = conservationVerifier!;
  }

  async applyInTransaction(payload: BlockchainMessagePayload, tx: Transaction): Promise<TransitionResult[]> {
    const state = stateName(payload.status);

    log.info('blockchain event received', {
      transactionHash: payload.transactionHash,
      state,
      uuidToken: payload.uuidToken,
      blockNumber: payload.blockNumber,
      senders: payload.senders.length,
      recipients: payload.recipients.length,
    });

    validateBlockchainMessage(payload);

    const journalTransactions = await this.resolveJournalTransactions(payload, tx);

    const results = await this.ledgerPipeline.processTransition(buildBlockchainRequests(journalTransactions, payload), tx);

    const outcome = aggregateOutcome(results);

    log.info('blockchain event handled', {
      transactionHash: payload.transactionHash,
      state,
      outcome,
      journalTransactions: journalTransactions.length,
    });

    if (outcome === TRANSITION_OUTCOME.APPLIED && !EXCEPTION_STATE_IDS.has(payload.status)) {
      await this.conservationVerifier.verifyWithdrawSettlement(
        journalTransactions,
        payload.recipients.filter((recipient) => !recipient.account),
        `blockchain ${payload.transactionHash}`,
        tx,
      );

      log.debug('settlement conserved', { transactionHash: payload.transactionHash });
    }

    return results;
  }

  private async resolveJournalTransactions(payload: BlockchainMessagePayload, tx: Transaction): Promise<JournalTransaction[]> {
    const byHash = await this.ledgerPipeline.findByTransactionHash(payload.transactionHash, tx);

    if (byHash.length > 0) {
      log.debug('journal transactions found by transaction hash', { transactionHash: payload.transactionHash, count: byHash.length });
      return byHash;
    }

    const outgoingTokens = [...payload.senders.map((sender) => sender.idempotencyToken), payload.networkFee.idempotencyToken].filter(
      (token): token is string => !!token,
    );
    const outgoing = await this.ledgerPipeline.findByIdempotencyTokens(outgoingTokens, tx);

    if (outgoing.length > 0) {
      throw new TransitionNotReadyError(
        payload.transactionHash,
        null,
        payload.status,
        'a system withdraw matches this event but its transaction hash is not stored yet',
      );
    }

    if (payload.status !== BLOCKCHAIN_TRANSACTION_STATE_ID.CONFIRMING) {
      throw new TransitionNotReadyError(
        payload.transactionHash,
        null,
        payload.status,
        'no journal transaction exists yet and only CONFIRMING can start a deposit',
      );
    }

    log.info('no journal transaction matches this hash: treating it as an incoming deposit', {
      transactionHash: payload.transactionHash,
      recipients: payload.recipients.filter((item) => item.account).length,
    });

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
