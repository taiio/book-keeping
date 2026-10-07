import { UnitOfWork } from '../../common/UnitOfWork';
import { container } from '../../config/container';
import type { DirectHandler, TransactionalHandler } from './types';

export function direct<TPayload, TResult>(handler: TransactionalHandler<TPayload, TResult>): DirectHandler<TPayload, TResult> {
  const unitOfWork = container.resolve(UnitOfWork);

  return { handle: (payload) => unitOfWork.execute((tx) => handler.applyInTransaction(payload, tx)) };
}
