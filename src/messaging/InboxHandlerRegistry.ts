import { autoInjectable, singleton } from 'tsyringe';

import { UnsupportedOperationError } from '../common/errors';
import type { InboxEventKindId } from '../constants';
import type { InboxEventHandler } from '../ports';
import { BlockchainInboxHandler } from './inboxHandlers/BlockchainInboxHandler';
import { SystemTransactionInboxHandler } from './inboxHandlers/SystemTransactionInboxHandler';

/** Finds the handler of a message kind. Add a new kind by adding its handler here. */
@singleton()
@autoInjectable()
export class InboxHandlerRegistry {
  private readonly handlers: ReadonlyMap<InboxEventKindId, InboxEventHandler>;

  constructor(systemTransaction?: SystemTransactionInboxHandler, blockchain?: BlockchainInboxHandler) {
    const handlers: InboxEventHandler[] = [systemTransaction!, blockchain!];

    this.handlers = new Map(handlers.map((handler) => [handler.kind, handler]));
  }

  get(kind: InboxEventKindId): InboxEventHandler {
    const handler = this.handlers.get(kind);

    if (!handler) throw new UnsupportedOperationError(`inbox event kind ${kind}`);

    return handler;
  }
}
