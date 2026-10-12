import { status } from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';

import { NotFoundError, ValidationError } from '../common/errors';

export function toGrpcError(error: unknown): Pick<ServiceError, 'code' | 'message'> {
  if (error instanceof ValidationError) return { code: status.INVALID_ARGUMENT, message: error.message };
  if (error instanceof NotFoundError) return { code: status.NOT_FOUND, message: error.message };

  return { code: status.INTERNAL, message: 'internal error' };
}
