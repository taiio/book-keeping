// 1. Phân loại hành động (Transaction Type)
type TransactionType = 'WITHDRAW' | 'STAKE' | 'UNSTAKE' | 'RESTAKE';

// 2. Vòng đời trạng thái (Lifecycle States - bao gồm cả case Failed/Reverted)
type TransactionState =
  | 'AUTHORIZING'
  | 'AUTHORIZED'
  | 'SUBMITTING'
  | 'SENT'
  | 'CONFIRMED'
  | 'FAILED'
  | 'REVERTED';

// 3. Interface cấu trúc tài khoản chung (Dùng cho cả sender và recipient)
interface AccountItem {
  clientId?: number;
  accountId?: number;
  assetTypeId?: number;
  walletTypeId?: number;
  assetId: number;
  quantity: string;
  poolId?: string;   // Dùng khi stake/unstake vào pool cụ thể
  address?: string;  // Dùng khi tương tác với địa chỉ on-chain bên ngoài
}

// 4. Interface Phí chung
interface FeeItem {
  clientId?: number;
  accountId?: number;
  assetTypeId?: number;
  walletTypeId?: number;
  assetId: number;
  quantity: string;
}

/**
 * UNIFIED COMMAND INTERFACE
 * Dùng chung cho: Withdraw, Stake, Unstake, Restake
 */
interface TransactionCommand {
  type: TransactionType;        // Phân biệt loại giao dịch
  idempotencyToken: string;     // Token chống trùng lặp xuyên suốt lifecycle
  uuidToken: string;
  
  senders: AccountItem[];       // Nguồn tiền đi (ví user, pool gốc,...)
  fee: FeeItem;                 // Phí giao dịch
  recipients?: AccountItem[];   // Đích đến (nếu có: ví nhận, pool đích,...)

  // Metadata bổ sung nếu có logic riêng (ví dụ: restake chuyển từ pool A sang pool B)
  metadata?: {
    fromPoolId?: string;
    toPoolId?: string;
    [key: string]: any;
  };
}

/**
 * UNIFIED TRANSACTION ENTITY (Lưu Database & Bắn sang Bookkeeping)
 */
interface TransactionEntity extends TransactionCommand {
  id: string;                   // Database Primary Key
  state: TransactionState;      // Trạng thái hiện tại của giao dịch
  
  // Thông tin phát sinh khi đẩy lên Blockchain
  transactionHash?: string;     
  blockNumber?: number;         
  
  // Thông tin xử lý khi Tx bị lỗi / Reverted trên chain
  errorCode?: string | number;
  errorMessage?: string;
  consumedFee?: {               // Phí gas thực tế bị trừ khi tx fail
    payerAddress?: string;
    assetTicker?: string;
    quantity: string;
  };

  createdAt: Date;
  updatedAt: Date;
}

/**
 * sau khi submmit tx từ hệ thống, blockchain node thường trả về transaction hash dựa trên input dữ liệu.
 * blockchain listener sẽ listen từng blockchain, compare with transaction hash. (confrming (1st) -> confirmed)
 */

type BlockchainTransactionStatus =
  | 'CONFIRMED'
  | 'FAILED'
  | 'REVERTED';

interface BlockchainMessagePayload {
  transactionHash: string;
  blockNumber?: number;

  status: BlockchainTransactionStatus;

  senders: {
    address: string;
    assetTicker: string;
    quantity: string;
    feePaid?: string;
  }[];

  recipients: {
    address: string;
    assetTicker: string;
    quantity: string;
    type: 'AMOUNT' | 'REWARD';
  }[];

  networkFee?: {
    payerAddress: string;
    assetTicker: string;
    quantity: string;
  };

  error?: {
    code?: string | number;
    message: string;
  };
}