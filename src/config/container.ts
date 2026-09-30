import 'reflect-metadata';
import { container } from 'tsyringe';

// Import các class có @singleton()/@autoInjectable() để decorator chạy và tự đăng ký
// vào container gốc của tsyringe (side-effect import).
import '../common/UnitOfWork';
import '../repositories/BookRepository';
import '../repositories/BookHistoryRepository';
import '../repositories/BookPostingRepository';
import '../repositories/JournalTransactionRepository';
import '../repositories/JournalTransactionHistoryRepository';
import '../ledger/LedgerPipeline';
import '../handlers/SystemTransactionHandler';
import '../handlers/BlockchainEventHandler';

export { container };
