import type { BLOCKCHAIN_TRANSACTION_STATUS } from '../constants';
import type { Book } from '../models';
import type { Transaction } from './transaction';

export type BlockchainTransactionStatus = (typeof BLOCKCHAIN_TRANSACTION_STATUS)[keyof typeof BLOCKCHAIN_TRANSACTION_STATUS];

export interface BlockchainSender {
  address: string;
  assetTicker: string;
  quantity: string;
  feePaid?: string;
}

export interface BlockchainRecipient {
  address: string;
  assetTicker: string;
  quantity: string;
  type: 'AMOUNT' | 'REWARD';
}

/**
 * Payload không mang sẵn loại transaction (deposit/withdraw/stake/...): handler đối chiếu
 * `transactionHash` với bảng JournalTransaction để biết đúng loại.
 */
export interface BlockchainMessagePayload {
  transactionHash: string;

  blockNumber?: number;

  status: BlockchainTransactionStatus;

  senders: BlockchainSender[];

  recipients: BlockchainRecipient[];

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

/** Book custody nhận deposit + recipient trong payload khớp với book đó. */
export interface DepositBookMatch {
  book: Book;
  recipient: BlockchainRecipient;
}

export interface BlockchainSubmissionResult {
  transactionHash: string;
  senderAddress?: string;
}

/**
 * "Cổng" (port) gọi blockchain provider. Chưa có adapter thật trong repo này —
 * tầng ngoài gán implementation vào `SystemTransactionHandler.blockchainSubmitter`
 * sau khi container.resolve() (không đưa vào constructor vì @autoInjectable() không
 * tự resolve được 1 interface, không có token ở runtime).
 */
export interface IBlockchainSubmitter {
  submit(transaction: Transaction, journalTransactionId: number): Promise<BlockchainSubmissionResult>;
}
