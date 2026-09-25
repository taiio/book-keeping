import 'reflect-metadata';
import { container } from 'tsyringe';

// Import các class có @injectable()/@singleton() để decorator chạy và tự đăng ký
// vào container gốc của tsyringe (side-effect import).
import '../common/UnitOfWork';
import '../repositories/Book';
import '../repositories/BookPosting';
import '../repositories/JournalTransaction';
import '../logics/DepositFlow';
import '../logics/WithdrawFlow';
import '../logics/StakeFlow';

/**
 * Container DI dùng chung cho toàn bộ app.
 *
 * Nhờ @autoInjectable() trên từng class, tsyringe tự đọc kiểu tham số
 * constructor (qua reflect-metadata) để tự nối dependency — không cần khai
 * báo @inject(...) thủ công cho từng tham số nữa. Có 2 cách dùng:
 *
 *   1. container.resolve(DepositFlow)   -> lấy singleton từ container.
 *   2. new DepositFlow()                -> vẫn tự động nhận đủ 4 dependency
 *                                           (UnitOfWork, JournalTransactionRepository,
 *                                           BookRepository, BookPostingRepository).
 */
export { container };
