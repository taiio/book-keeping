import { TRANSACTION_STATE, TRANSACTION_STATE_CODE_BY_ID } from '../constants';
import type {
  BlockchainRecipient,
  DepositTransactionEntity,
  Transaction,
  TransactionEntity,
  TransactionEntityBase,
  TransactionStateCode,
} from '../interfaces';
import type { Book, JournalTransaction } from '../models';

export function mapDbStateToEntityState(transactionStateId: number | null): TransactionStateCode {
  const code = transactionStateId != null ? TRANSACTION_STATE_CODE_BY_ID[transactionStateId] : undefined;

  return (code ?? TRANSACTION_STATE.AUTHORIZING.code) as TransactionStateCode;
}

function toEntityBase(journalTransaction: JournalTransaction, transactionStateId: number | null, errorMessage?: string): TransactionEntityBase {
  return {
    id: String(journalTransaction.id),
    idempotencyToken: journalTransaction.idempotencyToken ?? '',
    uuidToken: journalTransaction.uuidToken,
    state: mapDbStateToEntityState(transactionStateId),
    journalTransactionState: journalTransaction.journalTransactionState,
    transactionHash: journalTransaction.transactionHash ?? undefined,
    errorMessage,
    createdAt: journalTransaction.createdDate,
    updatedAt: journalTransaction.updatedDate ?? journalTransaction.createdDate,
  };
}

export function toTransactionEntity(
  original: Transaction | null,
  journalTransaction: JournalTransaction,
  transactionStateId: number | null,
  errorMessage?: string,
): TransactionEntity {
  return { ...original, ...toEntityBase(journalTransaction, transactionStateId, errorMessage) } as TransactionEntity;
}

export function toDepositEntity(
  journalTransaction: JournalTransaction,
  transactionStateId: number | null,
  recipient: BlockchainRecipient,
  custodyBook: Book,
): DepositTransactionEntity {
  return {
    ...toEntityBase(journalTransaction, transactionStateId),
    type: 'DEPOSIT',
    recipient: {
      clientId: custodyBook.clientId,
      accountId: custodyBook.accountId,
      assetId: custodyBook.assetId,
      assetTypeId: custodyBook.assetTypeId,
      assetTicker: custodyBook.assetTicker,
      walletTypeId: custodyBook.walletTypeId,
      quantity: recipient.quantity,
      address: recipient.address,
    },
  };
}
