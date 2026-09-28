import type { JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE } from '../constants';
import type { JournalTransaction } from '../models';

// ----------------------------------------------------------------------
// Account / fee items
// ----------------------------------------------------------------------

export interface AccountItem {
  clientId?: number;
  accountId?: number;

  assetTypeId?: number;
  walletTypeId?: number;

  assetId: number;
  assetTicker: string;
  quantity: string;

  poolId?: string;
  address?: string;
}

export interface FeeItem {
  clientId?: number;
  accountId?: number;

  assetTypeId?: number;
  walletTypeId?: number;

  assetId: number;
  assetTicker: string;
  quantity: string;
}

// ----------------------------------------------------------------------
// State types — suy ra trực tiếp từ constants, KHÔNG khai báo lại bằng tay
// ----------------------------------------------------------------------

export type JournalTransactionStateValue = (typeof JOURNAL_TRANSACTION_STATE)[keyof typeof JOURNAL_TRANSACTION_STATE];

/**
 * Code của các state chi tiết (AUTHORIZING | AUTHORIZED | SENT | CONFIRMING | CONFIRMED).
 * Việc bị từ chối / thất bại KHÔNG phải là 1 state chi tiết mà được biểu diễn bằng
 * `JournalTransactionStateValue` = CANCELLED_OR_EXPIRED.
 */
export type TransactionStateCode = NonNullable<(typeof TRANSACTION_STATE)[keyof typeof TRANSACTION_STATE]['code']>;

// ----------------------------------------------------------------------
// System transactions (WITHDRAW / STAKE / UNSTAKE / RESTAKE)
// ----------------------------------------------------------------------

export interface TransactionBase {
  idempotencyToken: string;
  uuidToken: string;
}

export interface Withdraw extends TransactionBase {
  type: 'WITHDRAW';
  sender: AccountItem[];
  recipient: AccountItem[];
  fee: FeeItem;
}

export interface Stake extends TransactionBase {
  type: 'STAKE';
  sender: AccountItem;
  pool: {
    poolId: string;
    address?: string;
  };
  fee: FeeItem;
}

export interface Unstake extends TransactionBase {
  type: 'UNSTAKE';
  sender: AccountItem;
  pool: {
    poolId: string;
    address?: string;
  };
  recipient: AccountItem[];
  fee: FeeItem;
}

export interface Restake extends TransactionBase {
  type: 'RESTAKE';
  sender: AccountItem;
  fromPool: {
    poolId: string;
    address?: string;
  };
  toPool: {
    poolId: string;
    address?: string;
  };
  fee: FeeItem;
}

export type Transaction = Withdraw | Stake | Unstake | Restake;

// ----------------------------------------------------------------------
// Transaction entities (payload gốc + trạng thái hiện tại của journal)
// ----------------------------------------------------------------------

export interface TransactionEntityBase {
  id: string;

  idempotencyToken: string;
  uuidToken: string;

  /** State chi tiết hiện tại (hoặc cuối cùng hợp lệ nếu journal đã bị huỷ). */
  state: TransactionStateCode;

  /** ACTIVE / COMPLETED / CANCELLED_OR_EXPIRED — CANCELLED_OR_EXPIRED nghĩa là bị REJECTED hoặc FAILED. */
  journalTransactionState: JournalTransactionStateValue;

  transactionHash?: string;
  blockNumber?: number;

  errorCode?: string | number;
  errorMessage?: string;

  consumedFee?: {
    payerAddress?: string;
    assetTicker?: string;
    quantity: string;
  };

  createdAt: Date;
  updatedAt: Date;
}

export type TransactionEntity = Transaction & TransactionEntityBase;

/**
 * DEPOSIT không do hệ thống khởi tạo nên không nằm trong union `Transaction`;
 * nó chỉ tồn tại dưới dạng entity do BlockchainEventHandler tạo ra.
 */
export interface DepositTransactionEntity extends TransactionEntityBase {
  type: 'DEPOSIT';
  recipient: AccountItem;
}

export type BlockchainDrivenEntity = TransactionEntity | DepositTransactionEntity;

// ----------------------------------------------------------------------
// SystemTransactionHandler results
// ----------------------------------------------------------------------

export type AuthorizePhase = 'AUTHORIZED' | 'REJECTED' | 'REPLAYED';

/** Kết quả vòng AUTHORIZING của SystemTransactionHandler (chạy trong 1 DB transaction). */
export interface AuthorizeResult {
  phase: AuthorizePhase;
  /** Bản ghi journal MỚI NHẤT sau vòng authorize (đã phản ánh state/hash vừa ghi). */
  journalTransaction: JournalTransaction;
  errorMessage?: string;
}
