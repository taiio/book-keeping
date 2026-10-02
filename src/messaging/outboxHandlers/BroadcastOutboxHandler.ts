import { autoInjectable, inject, singleton } from 'tsyringe';

import { TransitionNotReadyError } from '../../common/errors';
import { UnitOfWork } from '../../common/UnitOfWork';
import { OUTBOX_EVENT_TYPE, TRANSACTION_TYPE } from '../../constants';
import { LedgerPipeline } from '../../ledger/LedgerPipeline';
import { BLOCKCHAIN_SUBMITTER } from '../../ports';
import type { IBlockchainSubmitter, OutboxEventHandler } from '../../ports';
import type { OutboxEventView, Withdraw } from '../../types';

/**
 * Puts a SENT withdraw on the blockchain, then records the transaction hash (write-once) on its journal transactions.
 * Delivery is at least once, so a crash between "submitted" and "marked published" submits again; the submitter is
 * required to be idempotent (same transaction, same hash), and the write-once hash makes the second pass a no-op.
 */
@singleton()
@autoInjectable()
export class BroadcastOutboxHandler implements OutboxEventHandler {
  readonly type = OUTBOX_EVENT_TYPE.BROADCAST_REQUESTED;

  private readonly unitOfWork: UnitOfWork;
  private readonly ledgerPipeline: LedgerPipeline;
  private readonly blockchainSubmitter: IBlockchainSubmitter;

  constructor(unitOfWork?: UnitOfWork, ledgerPipeline?: LedgerPipeline, @inject(BLOCKCHAIN_SUBMITTER) blockchainSubmitter?: IBlockchainSubmitter) {
    this.unitOfWork = unitOfWork!;
    this.ledgerPipeline = ledgerPipeline!;
    this.blockchainSubmitter = blockchainSubmitter!;
  }

  async handle(event: OutboxEventView): Promise<void> {
    const withdraw = event.payload as Withdraw;

    const journalTransactions = await this.unitOfWork.execute((tx) => this.ledgerPipeline.findByUuidToken(withdraw.uuidToken, tx));
    const senders = journalTransactions.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.WITHDRAW);

    if (senders.length === 0) throw new TransitionNotReadyError(withdraw.uuidToken, null, event.stateId);

    const { transactionHash } = await this.blockchainSubmitter.submit(withdraw, senders[0].id);

    await this.unitOfWork.execute((tx) =>
      this.ledgerPipeline.attachTransactionHash(
        journalTransactions.map((jt) => jt.id),
        transactionHash,
        tx,
      ),
    );
  }
}
