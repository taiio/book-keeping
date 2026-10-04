import 'reflect-metadata';
import { container } from 'tsyringe';

import { NoopEventPublisher } from '../messaging/NoopEventPublisher';
import { EVENT_PUBLISHER } from '../ports';

import '../common/UnitOfWork';
import '../repositories/BookRepository';
import '../repositories/BookHistoryRepository';
import '../repositories/BookPostingRepository';
import '../repositories/JournalTransactionRepository';
import '../repositories/JournalTransactionHistoryRepository';
import '../repositories/InboxEventRepository';
import '../repositories/OutboxEventRepository';
import '../ledger/LedgerPipeline';
import '../ledger/ConservationVerifier';
import '../handlers/SystemTransactionHandler';
import '../handlers/BlockchainEventHandler';
import '../messaging/InboxService';
import '../messaging/OutboxRelay';

if (!container.isRegistered(EVENT_PUBLISHER)) container.registerInstance(EVENT_PUBLISHER, new NoopEventPublisher());

export { container };
