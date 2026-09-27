import 'reflect-metadata';

import { container } from '../di/container';
import { UnitOfWork } from '../common/UnitOfWork';
import { BookRepository, BookPostingRepository, JournalTransactionRepository } from '../repositories';
import { DepositFlow, WithdrawFlow, StakeFlow } from '../domain';

/**
 * Kiểm tra "autoinject" hoạt động thật (không cần kết nối DB):
 *  - container.resolve(Flow) tự nối đủ 4 dependency.
 *  - new Flow() (không qua container) cũng tự nối được, nhờ @autoInjectable().
 */
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAILED: ${message}`);
  }
  console.log(`OK: ${message}`);
}

function checkFlow(name: string, flow: any) {
  assert(flow.unitOfWork instanceof UnitOfWork, `${name}.unitOfWork được autoinject`);
  assert(flow.journalTransactionRepository instanceof JournalTransactionRepository, `${name}.journalTransactionRepository được autoinject`);
  assert(flow.bookRepository instanceof BookRepository, `${name}.bookRepository được autoinject`);
  assert(flow.bookPostingRepository instanceof BookPostingRepository, `${name}.bookPostingRepository được autoinject`);
}

// --- 1) Qua container.resolve ---
checkFlow('container.resolve(DepositFlow)', container.resolve(DepositFlow));
checkFlow('container.resolve(WithdrawFlow)', container.resolve(WithdrawFlow));
checkFlow('container.resolve(StakeFlow)', container.resolve(StakeFlow));

// --- 2) Qua `new` trực tiếp, không đụng container ---
checkFlow('new DepositFlow()', new DepositFlow());
checkFlow('new WithdrawFlow()', new WithdrawFlow());
checkFlow('new StakeFlow()', new StakeFlow());

// --- 3) BookPostingRepository tự inject BookRepository ---
const bookPostingRepository: any = new BookPostingRepository();
assert(bookPostingRepository.bookRepository instanceof BookRepository, 'new BookPostingRepository().bookRepository được autoinject');

// --- 4) singleton: 2 lần resolve phải ra cùng 1 instance ---
assert(container.resolve(BookRepository) === container.resolve(BookRepository), 'BookRepository là singleton qua container');

console.log('\nTất cả kiểm tra DI/autoinject đều PASS.');
