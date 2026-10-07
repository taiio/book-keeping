import 'reflect-metadata';

import { UnitOfWork } from '../common/UnitOfWork';
import { createLogger, errorMeta } from '../common/logger';
import { container } from '../config/container';
import { BlockchainEventHandler } from '../handlers/BlockchainEventHandler';
import { SystemTransactionHandler } from '../handlers/SystemTransactionHandler';
import { ConservationVerifier } from '../ledger/ConservationVerifier';
import { LedgerPipeline } from '../ledger/LedgerPipeline';
import { InboxHandlerRegistry } from '../messaging/InboxHandlerRegistry';
import { InboxProcessor } from '../messaging/InboxProcessor';
import { InboxService } from '../messaging/InboxService';
import { OutboxHandlerRegistry } from '../messaging/OutboxHandlerRegistry';
import { OutboxRelay } from '../messaging/OutboxRelay';
import { BLOCKCHAIN_SUBMITTER, DEAD_LETTER_PUBLISHER, EVENT_PUBLISHER } from '../ports';
import { BookPostingRepository } from '../repositories/BookPostingRepository';
import { BookRepository } from '../repositories/BookRepository';
import { InboxEventRepository } from '../repositories/InboxEventRepository';
import { JournalTransactionRepository } from '../repositories/JournalTransactionRepository';
import { OutboxEventRepository } from '../repositories/OutboxEventRepository';

type Token = string | (new (...args: never[]) => unknown);

const TOKENS: ReadonlyArray<readonly [string, Token]> = [
  ['UnitOfWork', UnitOfWork],
  ['BookRepository', BookRepository],
  ['BookPostingRepository', BookPostingRepository],
  ['JournalTransactionRepository', JournalTransactionRepository],
  ['InboxEventRepository', InboxEventRepository],
  ['OutboxEventRepository', OutboxEventRepository],
  ['LedgerPipeline', LedgerPipeline],
  ['ConservationVerifier', ConservationVerifier],
  ['SystemTransactionHandler', SystemTransactionHandler],
  ['BlockchainEventHandler', BlockchainEventHandler],
  ['InboxHandlerRegistry', InboxHandlerRegistry],
  ['InboxProcessor', InboxProcessor],
  ['InboxService', InboxService],
  ['OutboxHandlerRegistry', OutboxHandlerRegistry],
  ['OutboxRelay', OutboxRelay],
  [`token ${EVENT_PUBLISHER}`, EVENT_PUBLISHER],
  [`token ${DEAD_LETTER_PUBLISHER}`, DEAD_LETTER_PUBLISHER],
  [`token ${BLOCKCHAIN_SUBMITTER}`, BLOCKCHAIN_SUBMITTER],
];

const log = createLogger('test:di');

function main(): void {
  let failures = 0;

  for (const [name, token] of TOKENS) {
    try {
      container.resolve(token as never);
      log.info('resolved', { dependency: name });
    } catch (error) {
      failures += 1;
      log.error('cannot resolve', { dependency: name, ...errorMeta(error, { stack: false }) });
    }
  }

  if (failures === 0) log.info('DI graph resolves');
  else log.error('DI graph is broken', { unresolved: failures });

  process.exitCode = failures === 0 ? 0 : 1;
}

main();
