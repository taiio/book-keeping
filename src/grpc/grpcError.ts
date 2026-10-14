import { ValidationError } from '../common/errors';
import { GRPC_ERROR_MESSAGE, GRPC_STATUS } from '../constants';
import type { GrpcError } from '../types';

export function toGrpcError(error: unknown): GrpcError {
  if (error instanceof ValidationError) return { code: GRPC_STATUS.INVALID_ARGUMENT, details: error.message };

  console.error('[grpc] request failed', error);

  return { code: GRPC_STATUS.INTERNAL, details: GRPC_ERROR_MESSAGE.INTERNAL };
}
