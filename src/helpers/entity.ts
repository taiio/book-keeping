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

/** State chi tiết (code) theo id trong DB. Id không xác định -> AUTHORIZING (giá trị an toàn ban đầu). */
export function mapDbStateToEntityState(transactionStateId: number | null): TransactionStateCode {
  const code = transactionStateId != null ? TRANSACTION_STATE_CODE_BY_ID[transactionStateId] : undefined;

  return (code ?? TRANSACTION_STATE.AUTHORIZING.code) as TransactionStateCode;
}

function toEntityBase(journalTransaction: JournalTransaction, errorMessage?: string): TransactionEntityBase {
  return {
    id: String(journalTransaction.id),
    idempotencyToken: journalTransaction.idempotencyToken ?? '',
    uuidToken: journalTransaction.uuidToken,
    state: mapDbStateToEntityState(journalTransaction.transactionStateId),
    journalTransactionState: journalTransaction.journalTransactionState,
    transactionHash: journalTransaction.transactionHash ?? undefined,
    errorMessage,
    createdAt: journalTransaction.createdDate,
    updatedAt: journalTransaction.updatedDate ?? journalTransaction.createdDate,
  };
}

/**
 * Ghép payload gốc + trạng thái hiện tại của journal thành TransactionEntity.
 * `original` = null chỉ xảy ra ở edge-case sourceContent bị thiếu/hỏng (dữ liệu cũ, hoặc
 * audit bị mất) — vẫn trả về phần base để caller biết trạng thái hiện tại thay vì throw
 * giữa chừng 1 flow đã đi tới đây.
 */
export function toTransactionEntity(original: Transaction | null, journalTransaction: JournalTransaction, errorMessage?: string): TransactionEntity {
  return { ...original, ...toEntityBase(journalTransaction, errorMessage) } as TransactionEntity;
}

export function toDepositEntity(journalTransaction: JournalTransaction, recipient: BlockchainRecipient, custodyBook: Book): DepositTransactionEntity {
  return {
    ...toEntityBase(journalTransaction),
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
