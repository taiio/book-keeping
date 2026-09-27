import * as grpc from '@grpc/grpc-js';

import { container } from '../di/container';
import { DepositFlow, StakeFlow, WithdrawFlow } from '../domain';
import {
  AdvanceWithdrawalRequestMessage,
  DepositRequestMessage,
  StakeRequestMessage,
  UnstakeRequestMessage,
  WithdrawRequestMessage,
  advanceParamsFromMessage,
  depositRequestFromMessage,
  journalTransactionToMessage,
  stakeRequestFromMessage,
  withdrawRequestFromMessage,
} from './mappers';
import { toGrpcError } from './errorMapping';

/**
 * Mỗi handler chỉ làm 3 việc: map request -> domain request, gọi Flow
 * (resolve qua DI container — Flow là singleton, an toàn dùng chung giữa
 * các request đồng thời vì mọi state thực sự nằm ở DB, không ở instance),
 * map kết quả -> response. Toàn bộ nghiệp vụ nằm ở domain/, không lặp lại
 * ở đây — service gRPC chỉ là 1 "cổng vào" (transport layer) khác, hoàn
 * toàn có thể thêm REST/GraphQL cổng khác dùng chung domain/ mà không đụng
 * gì tới business logic.
 */
export function createBookkeepingServiceImplementation(): grpc.UntypedServiceImplementation {
  const depositFlow = container.resolve(DepositFlow);
  const withdrawFlow = container.resolve(WithdrawFlow);
  const stakeFlow = container.resolve(StakeFlow);

  return {
    async createDeposit(call: grpc.ServerUnaryCall<DepositRequestMessage, unknown>, callback: grpc.sendUnaryData<unknown>) {
      try {
        const journalTransaction = await depositFlow.create(depositRequestFromMessage(call.request));
        callback(null, journalTransactionToMessage(journalTransaction));
      } catch (error) {
        callback(toGrpcError(error));
      }
    },

    async confirmDeposit(call: grpc.ServerUnaryCall<DepositRequestMessage, unknown>, callback: grpc.sendUnaryData<unknown>) {
      try {
        const journalTransaction = await depositFlow.confirm(depositRequestFromMessage(call.request));
        callback(null, journalTransactionToMessage(journalTransaction));
      } catch (error) {
        callback(toGrpcError(error));
      }
    },

    async createWithdrawal(call: grpc.ServerUnaryCall<WithdrawRequestMessage, unknown>, callback: grpc.sendUnaryData<unknown>) {
      try {
        const journalTransaction = await withdrawFlow.create(withdrawRequestFromMessage(call.request));
        callback(null, journalTransactionToMessage(journalTransaction));
      } catch (error) {
        callback(toGrpcError(error));
      }
    },

    async advanceWithdrawal(call: grpc.ServerUnaryCall<AdvanceWithdrawalRequestMessage, unknown>, callback: grpc.sendUnaryData<unknown>) {
      try {
        const params = advanceParamsFromMessage(call.request);
        const journalTransaction = await withdrawFlow.advance(
          params.journalTransactionId,
          params.targetState,
          params.kind,
          params.transactionHash,
          params.updatedBy,
        );
        callback(null, journalTransactionToMessage(journalTransaction));
      } catch (error) {
        callback(toGrpcError(error));
      }
    },

    async createStake(call: grpc.ServerUnaryCall<StakeRequestMessage, unknown>, callback: grpc.sendUnaryData<unknown>) {
      try {
        const journalTransaction = await stakeFlow.create(stakeRequestFromMessage(call.request));
        callback(null, journalTransactionToMessage(journalTransaction));
      } catch (error) {
        callback(toGrpcError(error));
      }
    },

    async unstake(call: grpc.ServerUnaryCall<UnstakeRequestMessage, unknown>, callback: grpc.sendUnaryData<unknown>) {
      try {
        const { journalTransactionId, stakedAmount, updatedBy } = call.request;
        const journalTransaction = await stakeFlow.unstake(journalTransactionId, stakedAmount, updatedBy ?? null);
        callback(null, journalTransactionToMessage(journalTransaction));
      } catch (error) {
        callback(toGrpcError(error));
      }
    },

    healthCheck(_call: grpc.ServerUnaryCall<Record<string, never>, unknown>, callback: grpc.sendUnaryData<unknown>) {
      // SERVING = 1 (xem enum HealthCheckResponse.ServingStatus trong proto).
      callback(null, { status: 1 });
    },
  };
}
