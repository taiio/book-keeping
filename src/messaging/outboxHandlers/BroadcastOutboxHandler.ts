import { autoInjectable, inject, singleton } from 'tsyringe';

import { BroadcastClosureError, BroadcastRejectedError, TransitionNotReadyError } from '../../common/errors';
import { UnitOfWork } from '../../common/UnitOfWork';
import {
  INBOX_EVENT_KIND,
  INBOX_EVENT_STATUS,
  INBOX_SOURCE,
  JOURNAL_TRANSACTION_STATE,
  OUTBOX_EVENT_TYPE,
  SYSTEM_EVENT_NAME,
  TRANSACTION_STATE,
  TRANSACTION_TYPE,
} from '../../constants';
import { deterministicUuid } from '../../helpers';
import { LedgerPipeline } from '../../ledger/LedgerPipeline';
import { BLOCKCHAIN_SUBMITTER } from '../../ports';
import type { IBlockchainSubmitter, OutboxEventHandler } from '../../ports';
import type { OutboxEventView, Withdraw } from '../../types';
import { InboxService } from '../InboxService';

@singleton()
@autoInjectable()
export class BroadcastOutboxHandler implements OutboxEventHandler {
  readonly type = OUTBOX_EVENT_TYPE.BROADCAST_REQUESTED;

  private readonly unitOfWork: UnitOfWork;
  private readonly ledgerPipeline: LedgerPipeline;
  private readonly blockchainSubmitter: IBlockchainSubmitter;
  private readonly inboxService: InboxService;

  constructor(
    unitOfWork?: UnitOfWork,
    ledgerPipeline?: LedgerPipeline,
    @inject(BLOCKCHAIN_SUBMITTER) blockchainSubmitter?: IBlockchainSubmitter,
    inboxService?: InboxService,
  ) {
    this.unitOfWork = unitOfWork!;
    this.ledgerPipeline = ledgerPipeline!;
    this.blockchainSubmitter = blockchainSubmitter!;
    this.inboxService = inboxService!;
  }

  async handle(event: OutboxEventView): Promise<void> {
    const withdraw = event.payload as Withdraw;

    const journalTransactions = await this.unitOfWork.execute((tx) => this.ledgerPipeline.findByUuidToken(withdraw.uuidToken, tx));
    const senders = journalTransactions.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.WITHDRAW);

    if (senders.length === 0) throw new TransitionNotReadyError(withdraw.uuidToken, null, event.stateId, 'the withdraw has no journal transaction yet');

    if (senders.some((jt) => jt.transactionHash || jt.journalTransactionState !== JOURNAL_TRANSACTION_STATE.ACTIVE)) return;

    const transactionHash = await this.submit(withdraw, senders[0].id);

    if (transactionHash === null) return;

    await this.unitOfWork.execute((tx) =>
      this.ledgerPipeline.attachTransactionHash(
        journalTransactions.map((jt) => jt.id),
        transactionHash,
        tx,
      ),
    );
  }

  private async submit(withdraw: Withdraw, journalTransactionId: string): Promise<string | null> {
    try {
      const { transactionHash } = await this.blockchainSubmitter.submit(withdraw, journalTransactionId);

      return transactionHash;
    } catch (error) {
      if (!(error instanceof BroadcastRejectedError)) throw error;

      await this.closeRejected(withdraw);

      return null;
    }
  }

  private async closeRejected(withdraw: Withdraw): Promise<void> {
    const status = await this.inboxService.ingest(INBOX_EVENT_KIND.SYSTEM_TRANSACTION, {
      eventId: deterministicUuid(`${SYSTEM_EVENT_NAME.BROADCAST_REJECTED}:${withdraw.uuidToken}`),
      source: INBOX_SOURCE.BROADCAST_RELAY,
      payload: { ...withdraw, transactionStateId: TRANSACTION_STATE.FAILED.id },
    });

    if (status === INBOX_EVENT_STATUS.PENDING) {
      throw new TransitionNotReadyError(withdraw.uuidToken, TRANSACTION_STATE.SENT.id, TRANSACTION_STATE.FAILED.id, 'closing the rejected withdraw is still pending');
    }

    if (status === INBOX_EVENT_STATUS.ERROR || status === INBOX_EVENT_STATUS.CONFLICT) {
      throw new BroadcastClosureError(withdraw.uuidToken, status);
    }
  }
}
