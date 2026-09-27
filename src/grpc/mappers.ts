import { JournalTransaction } from '../models';
import { AssetBookDescriptor } from '../domain/shared/types';
import { DepositRequest } from '../domain/deposit/DepositFlow';
import { StakeRequest } from '../domain/stake/StakeFlow';
import { WithdrawKind, WithdrawRequest, WithdrawTargetState } from '../domain/withdraw/WithdrawFlow';

/**
 * Các message .proto được load với option `keepCase: false` (xem
 * grpc/server.ts) nên field trên wire object đã ở dạng camelCase, khớp
 * thẳng với convention TypeScript trong repo — không cần đổi snake_case
 * thủ công ở đây.
 */

export interface AssetBookDescriptorMessage {
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  assetTicker: string;
  walletTypeId: number;
  address?: string | null;
}

export function assetFromMessage(msg: AssetBookDescriptorMessage): AssetBookDescriptor {
  return {
    clientId: msg.clientId,
    accountId: msg.accountId,
    assetId: msg.assetId,
    assetTypeId: msg.assetTypeId,
    assetTicker: msg.assetTicker,
    walletTypeId: msg.walletTypeId,
    address: msg.address ?? null,
  };
}

export interface DepositRequestMessage {
  idempotencyToken: string;
  uuidToken: string;
  amount: string;
  transactionHash?: string | null;
  createdBy?: number | null;
  businessPostDateTime: string;
  amountAsset: AssetBookDescriptorMessage;
  toAccountId?: number | null;
}

export function depositRequestFromMessage(msg: DepositRequestMessage): DepositRequest {
  const asset = assetFromMessage(msg.amountAsset);
  return {
    idempotencyToken: msg.idempotencyToken,
    uuidToken: msg.uuidToken,
    amount: msg.amount,
    transactionHash: msg.transactionHash ?? undefined,
    createdBy: msg.createdBy ?? null,
    businessPostDateTime: new Date(msg.businessPostDateTime),
    amountAsset: asset,
    toAccountId: msg.toAccountId ?? null,
    // Các field "flat" tương thích ngược — DepositFlow đọc trực tiếp từ đây.
    clientId: asset.clientId,
    accountId: asset.accountId,
    assetId: asset.assetId,
    assetTypeId: asset.assetTypeId,
    assetTicker: asset.assetTicker,
    walletTypeId: asset.walletTypeId,
    address: asset.address,
  };
}

export interface WithdrawRequestMessage {
  idempotencyToken: string;
  uuidToken: string;
  amount: string;
  fee: string;
  transactionHash?: string | null;
  createdBy?: number | null;
  businessPostDateTime: string;
  amountAsset: AssetBookDescriptorMessage;
  feeAsset?: AssetBookDescriptorMessage | null;
  fromAccountId: number;
  kind?: string | null;
}

export function withdrawRequestFromMessage(msg: WithdrawRequestMessage): WithdrawRequest {
  const amountAsset = assetFromMessage(msg.amountAsset);
  const feeAsset = msg.feeAsset ? assetFromMessage(msg.feeAsset) : undefined;

  return {
    idempotencyToken: msg.idempotencyToken,
    uuidToken: msg.uuidToken,
    amount: msg.amount,
    fee: msg.fee,
    transactionHash: msg.transactionHash ?? undefined,
    createdBy: msg.createdBy ?? null,
    businessPostDateTime: new Date(msg.businessPostDateTime),
    amountAsset,
    feeAsset,
    fromAccountId: msg.fromAccountId,
    toAccountId: null,
    kind: toWithdrawKind(msg.kind),
    // Flat compatibility fields (amount asset).
    clientId: amountAsset.clientId,
    accountId: amountAsset.accountId,
    assetId: amountAsset.assetId,
    assetTypeId: amountAsset.assetTypeId,
    assetTicker: amountAsset.assetTicker,
    walletTypeId: amountAsset.walletTypeId,
    address: amountAsset.address,
  };
}

export interface AdvanceWithdrawalRequestMessage {
  journalTransactionId: number;
  targetState: string;
  kind?: string | null;
  transactionHash?: string | null;
  updatedBy?: number | null;
}

function toWithdrawKind(value: string | null | undefined): WithdrawKind {
  return value === 'INTERNAL' ? 'INTERNAL' : 'EXTERNAL';
}

function toWithdrawTargetState(value: string): WithdrawTargetState {
  if (value === 'AUTHORIZED' || value === 'SENT' || value === 'CONFIRMING' || value === 'CONFIRMED') {
    return value;
  }
  throw new Error(`Invalid WithdrawTargetState: ${value}`);
}

export function advanceParamsFromMessage(msg: AdvanceWithdrawalRequestMessage): {
  journalTransactionId: number;
  targetState: WithdrawTargetState;
  kind: WithdrawKind;
  transactionHash?: string | null;
  updatedBy?: number | null;
} {
  return {
    journalTransactionId: msg.journalTransactionId,
    targetState: toWithdrawTargetState(msg.targetState),
    kind: toWithdrawKind(msg.kind),
    transactionHash: msg.transactionHash ?? undefined,
    updatedBy: msg.updatedBy ?? null,
  };
}

export interface StakeRequestMessage {
  idempotencyToken: string;
  uuidToken: string;
  amount: string;
  transactionHash?: string | null;
  createdBy?: number | null;
  businessPostDateTime: string;
  amountAsset: AssetBookDescriptorMessage;
  custodyAccountId?: number | null;
}

export function stakeRequestFromMessage(msg: StakeRequestMessage): StakeRequest {
  const asset = assetFromMessage(msg.amountAsset);
  return {
    idempotencyToken: msg.idempotencyToken,
    uuidToken: msg.uuidToken,
    amount: msg.amount,
    transactionHash: msg.transactionHash ?? undefined,
    createdBy: msg.createdBy ?? null,
    businessPostDateTime: new Date(msg.businessPostDateTime),
    amountAsset: asset,
    custodyAccountId: msg.custodyAccountId ?? null,
    clientId: asset.clientId,
    accountId: asset.accountId,
    assetId: asset.assetId,
    assetTypeId: asset.assetTypeId,
    assetTicker: asset.assetTicker,
    walletTypeId: asset.walletTypeId,
    address: asset.address,
  };
}

export interface UnstakeRequestMessage {
  journalTransactionId: number;
  stakedAmount: string;
  updatedBy?: number | null;
}

export function journalTransactionToMessage(journalTransaction: JournalTransaction) {
  return {
    id: journalTransaction.id,
    uuidToken: journalTransaction.uuidToken,
    idempotencyToken: journalTransaction.idempotencyToken ?? undefined,
    transactionTypeId: journalTransaction.transactionTypeId ?? undefined,
    transactionStateId: journalTransaction.transactionStateId ?? undefined,
    journalTransactionState: journalTransaction.journalTransactionState,
    transactionHash: journalTransaction.transactionHash ?? undefined,
  };
}
