import 'reflect-metadata';
import { container } from 'tsyringe';

import { NoopDeadLetterPublisher } from '../messaging/NoopDeadLetterPublisher';
import { NoopEventPublisher } from '../messaging/NoopEventPublisher';
import { UnconfiguredBlockchainSubmitter } from '../messaging/UnconfiguredBlockchainSubmitter';
import { BLOCKCHAIN_SUBMITTER, DEAD_LETTER_PUBLISHER, EVENT_PUBLISHER } from '../ports';

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
if (!container.isRegistered(DEAD_LETTER_PUBLISHER)) container.registerInstance(DEAD_LETTER_PUBLISHER, new NoopDeadLetterPublisher());
if (!container.isRegistered(BLOCKCHAIN_SUBMITTER)) container.registerInstance(BLOCKCHAIN_SUBMITTER, new UnconfiguredBlockchainSubmitter());

export { container };
