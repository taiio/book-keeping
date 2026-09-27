import * as grpc from '@grpc/grpc-js';

import { InsufficientBalanceError, InvalidStateTransitionError, NotFoundError, WithdrawRejectedError } from '../common/errors';

/**
 * Chuyển 1 error nội bộ thành `grpc.ServiceError` với status code đúng
 * ngữ nghĩa gRPC, để client bên ngoài (không biết gì về các class error
 * nội bộ của service) vẫn có thể xử lý đúng theo chuẩn — vd retry khi
 * UNAVAILABLE, không retry khi FAILED_PRECONDITION/NOT_FOUND.
 */
export function toGrpcError(error: unknown): grpc.ServiceError {
  if (error instanceof WithdrawRejectedError) {
    return withCode(grpc.status.FAILED_PRECONDITION, error.message);
  }

  if (error instanceof InvalidStateTransitionError) {
    return withCode(grpc.status.FAILED_PRECONDITION, error.message);
  }

  if (error instanceof InsufficientBalanceError) {
    return withCode(grpc.status.FAILED_PRECONDITION, error.message);
  }

  if (error instanceof NotFoundError) {
    return withCode(grpc.status.NOT_FOUND, error.message);
  }

  if (error instanceof Error) {
    return withCode(grpc.status.INTERNAL, error.message);
  }

  return withCode(grpc.status.UNKNOWN, 'Unknown error');
}

function withCode(code: grpc.status, message: string): grpc.ServiceError {
  const err = new Error(message) as grpc.ServiceError;
  err.code = code;
  err.details = message;
  return err;
}
