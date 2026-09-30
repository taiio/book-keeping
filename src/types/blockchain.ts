import type { BlockchainTransactionStateId, BookPostingPurposeId } from '../constants';
import type { Book } from '../models';
import type { AccountIdentity, AssetAmount } from './account';

export interface BlockchainParty {
  idempotencyToken?: string;
  address: string;
}

export interface BlockchainSender extends BlockchainParty {
  assetTicker?: string;
  quantity?: string;
  feePaid?: string;

  /** Internal account identity only; the asset (`assetTicker`/`quantity`) lives on the sender itself. */
  account?: AccountIdentity;
}

export interface BlockchainRecipient extends BlockchainParty, AssetAmount {
  type?: BookPostingPurposeId;

  account?: AccountIdentity;
}

/** Internal account identity of the fee payer; the asset (`assetTicker`/`quantity`) lives on the network fee itself. */
export interface BlockchainFeeAccount extends AccountIdentity {
  idempotencyToken?: string;
}

export interface BlockchainNetworkFee extends AssetAmount {
  idempotencyToken: string;
  payerAddress: string;
  account?: BlockchainFeeAccount;
}

export interface BlockchainError {
  code?: string | number;
  message: string;
}

export interface BlockchainMessagePayload {
  uuidToken?: string;
  transactionHash: string;
  blockNumber?: number;

  status: BlockchainTransactionStateId;

  senders: BlockchainSender[];

  recipients: BlockchainRecipient[];

  networkFee: BlockchainNetworkFee;

  error?: BlockchainError;
}

export interface DepositBookMatch {
  book: Book;
  recipient: BlockchainRecipient;
}
