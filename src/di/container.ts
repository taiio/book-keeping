import 'reflect-metadata';
import { container } from 'tsyringe';

// Import các class có @singleton()/@autoInjectable() để decorator chạy và tự đăng ký
// vào container gốc của tsyringe (side-effect import).
import '../common/UnitOfWork';
import '../repositories/Book';
import '../repositories/BookHistory';
import '../repositories/BookPosting';
import '../repositories/JournalTransaction';
import '../repositories/JournalTransactionHistory';
import '../handler/LedgerPipeline';
import '../handler/SystemTransactionHandler';
import '../handler/BlockchainEventHandler';

/**
 * Container DI dùng chung cho toàn bộ app.
 *
 * Nhờ @autoInjectable() trên từng class, tsyringe tự đọc kiểu tham số constructor
 * (qua reflect-metadata) để tự nối dependency — không cần khai báo @inject(...) thủ công.
 * Có 2 cách dùng:
 *
 *   1. container.resolve(SystemTransactionHandler)  -> lấy singleton từ container.
 *   2. new SystemTransactionHandler()                -> vẫn tự động nhận đủ dependency
 *                                                       (UnitOfWork, LedgerPipeline).
 */
export { container };
