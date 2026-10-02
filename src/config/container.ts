import 'reflect-metadata';
import { container } from 'tsyringe';

import { NoopEventPublisher } from '../messaging/NoopEventPublisher';
import { EVENT_PUBLISHER } from '../ports';

// Import the classes that carry @singleton()/@autoInjectable() so their decorators run and register them in the
// root tsyringe container (side-effect imports).
import '../common/UnitOfWork';
import '../repositories/BookRepository';
import '../repositories/BookHistoryRepository';
import '../repositories/BookPostingRepository';
import '../repositories/JournalTransactionRepository';
import '../repositories/JournalTransactionHistoryRepository';
import '../repositories/InboxEventRepository';
import '../repositories/OutboxEventRepository';
import '../ledger/LedgerPipeline';
import '../handlers/SystemTransactionHandler';
import '../handlers/BlockchainEventHandler';
import '../messaging/InboxService';
import '../messaging/OutboxRelay';

// Ports with a safe default; override by registering your own implementation before resolving anything.
if (!container.isRegistered(EVENT_PUBLISHER)) container.registerInstance(EVENT_PUBLISHER, new NoopEventPublisher());

export { container };
