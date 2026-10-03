import { autoInjectable, inject, singleton } from 'tsyringe';

import { TransitionNotReadyError } from '../../common/errors';
import { UnitOfWork } from '../../common/UnitOfWork';
import { OUTBOX_EVENT_TYPE, TRANSACTION_TYPE } from '../../constants';
import { LedgerPipeline } from '../../ledger/LedgerPipeline';
import { BLOCKCHAIN_SUBMITTER } from '../../ports';
import type { IBlockchainSubmitter, OutboxEventHandler } from '../../ports';
import type { OutboxEventView, Withdraw } from '../../types';

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
