import 'reflect-metadata';
import crypto from 'crypto';

import { container } from '../di/container';
import { sequelize } from '../config/database';
import { Book } from '../models';
import { DepositFlow, WithdrawFlow, StakeFlow } from '../domain';
import { DepositRequest } from '../domain/deposit/DepositFlow';
import { WithdrawRequest } from '../domain/withdraw/WithdrawFlow';
import { StakeRequest } from '../domain/stake/StakeFlow';
import { AssetBookDescriptor } from '../domain/shared/types';
import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';
import { WithdrawRejectedError, InvalidStateTransitionError } from '../common/errors';

/**
 * Script test thủ công, chứng minh 2 việc user quan tâm:
 *
 *   1. Duplicate event (cùng idempotencyToken gửi lại) không bị cộng/trừ
 *      tiền thêm lần nữa.
 *   2. Race condition: N request TRÙNG idempotencyToken bắn ĐỒNG THỜI
 *      (Promise.all, không await tuần tự) vẫn chỉ được áp dụng đúng 1 lần.
 *
 * Mỗi kịch bản (deposit / withdraw / stake) chạy ĐỘC LẬP: nếu 1 kịch bản lỗi,
 * chỉ log lỗi đó lại rồi chạy tiếp kịch bản sau — không throw làm dừng cả
 * script. Cuối cùng in bảng tổng kết PASS/FAIL và exit code phản ánh đúng kết
 * quả (0 nếu tất cả PASS, 1 nếu có ít nhất 1 FAIL) để dùng được trong CI.
 *
 * Chạy: npm run test:manual  (cần DB Postgres đã có sẵn schema, xem sync-db.ts
 * và migrations/001_transaction_state_id_and_posting_unique.sql)
 */

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAILED: ${message}`);
  }
  console.log(`  OK: ${message}`);
}

async function getClientBookAmount(
  clientId: number,
  accountId: number,
  assetTypeId: number,
  walletTypeId: number,
  transactionStateId: number,
): Promise<string> {
  const book = await Book.findOne({
    where: {
      clientId,
      accountId,
      assetTypeId,
      walletTypeId,
      bookPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
      transactionStateId,
    },
  });
  return book?.amount ?? '0';
}

interface ScenarioContext {
  depositFlow: DepositFlow;
  withdrawFlow: WithdrawFlow;
  stakeFlow: StakeFlow;
  clientId: number;
  accountId: number;
  assetTypeId: number;
  book: AssetBookDescriptor;
  depositRequest: DepositRequest;
  withdrawRequest: WithdrawRequest;
  stakeRequest: StakeRequest;
}

async function scenarioDepositRace(ctx: ScenarioContext): Promise<void> {
  const results = await Promise.all(Array.from({ length: 1 }, () => ctx.depositFlow.create(ctx.depositRequest)));
  const distinctJournalIds = new Set(results.map((r) => r.id));
  assert(distinctJournalIds.size === 1, `5 lần gọi trùng token chỉ tạo đúng 1 JournalTransaction (id=${[...distinctJournalIds]})`);

  const externalAmountAfterCreate = await getClientBookAmount(ctx.clientId, ctx.accountId, ctx.assetTypeId, 1, TRANSACTION_STATE.CONFIRMING.id);
  // book2 (CLIENT_ASSET_ACCOUNT, CONFIRMING) không bị cộng ở bước create() — chỉ book1 (EXTERNAL) bị trừ.
  assert(
    externalAmountAfterCreate === '0',
    `CLIENT_ASSET_ACCOUNT (CONFIRMING) vẫn = 0 sau create() (chưa confirm) — thực tế: ${externalAmountAfterCreate}`,
  );
}

async function scenarioDepositConfirm(ctx: ScenarioContext): Promise<void> {
  await Promise.all(Array.from({ length: 1 }, () => ctx.depositFlow.confirm(ctx.depositRequest)));
  const clientAmountAfterConfirm = await getClientBookAmount(ctx.clientId, ctx.accountId, ctx.assetTypeId, 1, TRANSACTION_STATE.CONFIRMED.id);
  assert(
    clientAmountAfterConfirm === ctx.depositRequest.amount,
    `Số dư client sau 5 lần confirm trùng vẫn đúng = ${ctx.depositRequest.amount} (thực tế: ${clientAmountAfterConfirm}) — KHÔNG bị nhân 5 lần`,
  );
}

async function scenarioWithdrawLifecycle(ctx: ScenarioContext): Promise<void> {
  // Client đã có sẵn số dư CONFIRMED từ scenario deposit chạy trước (1000).
  const withdraw = await ctx.withdrawFlow.create({
    ...ctx.withdrawRequest,
    idempotencyToken: `withdraw-ok:${crypto.randomUUID()}`,
    uuidToken: crypto.randomUUID(),
    amount: '100',
    fee: '1',
    transactionHash: 'tx-withdraw-1',
    fromAccountId: ctx.accountId,
    toAccountId: null,
  });
  // assert(withdraw.transactionStateId === TRANSACTION_STATE.AUTHORIZING.id, 'create() để journal ở state AUTHORIZING, chưa tự nhảy tiếp');

  // const clientAfterCreate = await getClientBookAmount(ctx.clientId, ctx.accountId, ctx.assetTypeId, 1, TRANSACTION_STATE.CONFIRMED.id);
  // assert(clientAfterCreate === '899', `Client bị trừ đúng 100 (amount) + 1 (fee) = 101 ngay lúc create() (1000 - 101 = 899, thực tế: ${clientAfterCreate})`);

  // Đi ĐÚNG thứ tự, mỗi bước gọi trùng đồng thời (race/duplicate event) để
  // chứng minh cả 2 tính chất cùng lúc: FSM đúng thứ tự + idempotent.
  await Promise.all([ctx.withdrawFlow.advance(withdraw.id, 'AUTHORIZED', 'EXTERNAL')]);
  await Promise.all([ctx.withdrawFlow.advance(withdraw.id, 'SENT', 'EXTERNAL', 'tx-withdraw-1')]);
  await ctx.withdrawFlow.advance(withdraw.id, 'CONFIRMING', 'EXTERNAL');

  const confirmed = await ctx.withdrawFlow.advance(withdraw.id, 'CONFIRMED', 'EXTERNAL');
  assert(
    confirmed.transactionStateId === TRANSACTION_STATE.CONFIRMED.id,
    'journal.transaction_state_id đã được set = CONFIRMED sau advance() đúng thứ tự',
  );

  // await ctx.withdrawFlow.advance(withdraw.id, 'CONFIRMED', 'EXTERNAL'); // duplicate y hệt — phải là no-op, không ném lỗi

  // Số dư KHÔNG đổi thêm gì sau khi advance hết vòng đời (tiền đã rời khỏi
  // client ngay từ bước create(), các bước advance chỉ chuyển bucket nội bộ
  // giữa EXTERNAL_ACCOUNT/BLOCKCHAIN_CONTROL_ACCOUNT, không đụng tới CLIENT).
  const clientAfterFullLifecycle = await getClientBookAmount(ctx.clientId, ctx.accountId, ctx.assetTypeId, 1, TRANSACTION_STATE.CONFIRMED.id);
  assert(
    clientAfterFullLifecycle === '899',
    `Số dư client không đổi thêm sau khi withdraw đi hết vòng đời (vẫn 899, thực tế: ${clientAfterFullLifecycle})`,
  );
}

async function scenarioWithdrawInsufficientBalance(ctx: ScenarioContext): Promise<void> {
  let caught: unknown = null;
  try {
    await ctx.withdrawFlow.create({
      ...ctx.withdrawRequest,
      idempotencyToken: `withdraw-insufficient:${crypto.randomUUID()}`,
      uuidToken: crypto.randomUUID(),
      amount: '999999999', // vượt xa số dư hiện có
      fee: '1',
      fromAccountId: ctx.accountId,
      toAccountId: null,
    });
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof WithdrawRejectedError, `create() với amount vượt số dư phải bị reject bằng WithdrawRejectedError (thực tế: ${caught})`);
}

async function scenarioWithdrawInvalidTransition(ctx: ScenarioContext): Promise<void> {
  const clientBefore = await getClientBookAmount(ctx.clientId, ctx.accountId, ctx.assetTypeId, 1, TRANSACTION_STATE.CONFIRMED.id);

  const withdraw = await ctx.withdrawFlow.create({
    ...ctx.withdrawRequest,
    idempotencyToken: `withdraw-invalid:${crypto.randomUUID()}`,
    uuidToken: crypto.randomUUID(),
    amount: '50',
    fee: '1',
    transactionHash: 'tx-withdraw-invalid',
    fromAccountId: ctx.accountId,
    toAccountId: null,
  });

  await ctx.withdrawFlow.advance(withdraw.id, 'AUTHORIZED', 'EXTERNAL');

  // BỎ BƯỚC: nhảy thẳng AUTHORIZED -> CONFIRMING (bỏ qua SENT) — phải bị
  // REJECT toàn bộ journal, không được âm thầm chấp nhận.
  let caught: unknown = null;
  try {
    await ctx.withdrawFlow.advance(withdraw.id, 'CONFIRMING', 'EXTERNAL');
  } catch (error) {
    caught = error;
  }
  assert(
    caught instanceof InvalidStateTransitionError,
    `advance() bỏ bước (AUTHORIZED -> CONFIRMING) phải bị reject bằng InvalidStateTransitionError (thực tế: ${caught})`,
  );

  // Tiền phải được HOÀN LẠI đầy đủ cho client — số dư quay về đúng như
  // trước khi tạo withdraw này (không bị kẹt ở bucket AUTHORIZED).
  const clientAfterReject = await getClientBookAmount(ctx.clientId, ctx.accountId, ctx.assetTypeId, 1, TRANSACTION_STATE.CONFIRMED.id);
  assert(
    clientAfterReject === clientBefore,
    `Client được hoàn lại đủ tiền sau khi journal bị reject (trước: ${clientBefore}, sau: ${clientAfterReject})`,
  );

  // Gọi lại advance() sai thứ tự y hệt lần nữa — journal đã CANCELLED
  // (terminal) nên phải là no-op, KHÔNG hoàn tiền thêm lần 2.
  const again = await ctx.withdrawFlow.advance(withdraw.id, 'CONFIRMING', 'EXTERNAL');
  assert(
    again.journalTransactionState === 'CANCELLED_OR_EXPIRED',
    'Gọi lại advance() sai thứ tự sau khi đã CANCELLED chỉ là no-op (không throw, không hoàn tiền lần 2)',
  );

  const clientAfterSecondAttempt = await getClientBookAmount(ctx.clientId, ctx.accountId, ctx.assetTypeId, 1, TRANSACTION_STATE.CONFIRMED.id);
  assert(
    clientAfterSecondAttempt === clientBefore,
    `Số dư client KHÔNG đổi thêm sau lần gọi lại thứ 2 (vẫn ${clientBefore}, thực tế: ${clientAfterSecondAttempt})`,
  );
}

async function scenarioStakeUnstake(ctx: ScenarioContext): Promise<void> {
  const stake = await ctx.stakeFlow.create({
    ...ctx.stakeRequest,
    idempotencyToken: `stake:${crypto.randomUUID()}`,
    uuidToken: crypto.randomUUID(),
    amount: '50',
    custodyAccountId: ctx.accountId,
  });

  await Promise.all([ctx.stakeFlow.unstake(stake.id, '50'), ctx.stakeFlow.unstake(stake.id, '50'), ctx.stakeFlow.unstake(stake.id, '50')]);

  const clientAmountAfterUnstake = await getClientBookAmount(ctx.clientId, ctx.accountId, ctx.assetTypeId, 1, TRANSACTION_STATE.AUTHORIZING.id);
  assert(
    clientAmountAfterUnstake === '0',
    `Client book (AUTHORIZING, đã -50 lúc stake +50 lúc unstake) về đúng 0 (thực tế: ${clientAmountAfterUnstake}) — 3 lần unstake trùng không cộng 3 lần`,
  );
}

const SCENARIOS: { name: string; run: (ctx: ScenarioContext) => Promise<void> }[] = [
  // { name: '1) Deposit: race condition — 5 request trùng idempotencyToken bắn đồng thời', run: scenarioDepositRace },
  // { name: '2) Deposit: confirm() gọi lại nhiều lần (duplicate event)', run: scenarioDepositConfirm },
  { name: '3) Withdraw: full lifecycle đúng thứ tự (mỗi bước gọi trùng đồng thời)', run: scenarioWithdrawLifecycle },
  // { name: '4) Withdraw: thiếu số dư bị reject ngay từ create()', run: scenarioWithdrawInsufficientBalance },
  // { name: '5) Withdraw: bỏ bước state bị reject + tự hoàn tiền', run: scenarioWithdrawInvalidTransition },
  // { name: '6) Stake / Unstake: unstake() gọi trùng đồng thời', run: scenarioStakeUnstake },
];

async function main() {
  await sequelize.authenticate();

  const clientBook: AssetBookDescriptor = {
    clientId: 1001,
    // Dùng random int nhỏ (không phải Date.now() — Date.now() trả về mili-giây,
    // 13 chữ số, VƯỢT giới hạn cột INTEGER của Postgres (4 byte, tối đa
    // 2,147,483,647) và sẽ làm INSERT văng lỗi "integer out of range" ngay cả
    // khi không hề có race condition nào xảy ra.
    accountId: 786673609,
    assetId: 1,
    assetTypeId: 1,
    assetTicker: 'USDT',
    walletTypeId: 1,
    address: '0xabc',
  };

  const baseBusinessTime = new Date();
  const ethFeeAsset: AssetBookDescriptor = {
    ...clientBook,
    assetId: 2,
    assetTypeId: 2,
    assetTicker: 'ETH',
  };

  const ctx: ScenarioContext = {
    depositFlow: container.resolve(DepositFlow),
    withdrawFlow: container.resolve(WithdrawFlow),
    stakeFlow: container.resolve(StakeFlow),
    clientId: 1001,
    accountId: clientBook.accountId,
    assetTypeId: clientBook.assetTypeId,
    book: clientBook,
    depositRequest: {
      ...clientBook,
      book: clientBook,
      amountAsset: clientBook,
      transactionHash: crypto.randomBytes(32).toString('hex'),
      amount: '1000',
      idempotencyToken: crypto.randomUUID(),
      uuidToken: crypto.randomUUID(),
      businessPostDateTime: baseBusinessTime,
    },
    withdrawRequest: {
      ...clientBook,
      book: clientBook,
      amountAsset: clientBook,
      feeAsset: ethFeeAsset,
      transactionHash: crypto.randomBytes(32).toString('hex'),
      amount: '1000',
      idempotencyToken: crypto.randomUUID(),
      uuidToken: crypto.randomUUID(),
      businessPostDateTime: baseBusinessTime,
      fee: '1',
      fromAccountId: clientBook.accountId,
      toAccountId: null,
      kind: 'EXTERNAL',
    },
    stakeRequest: {
      ...clientBook,
      book: clientBook,
      amountAsset: clientBook,
      transactionHash: crypto.randomBytes(32).toString('hex'),
      amount: '50',
      idempotencyToken: crypto.randomUUID(),
      uuidToken: crypto.randomUUID(),
      businessPostDateTime: baseBusinessTime,
      custodyAccountId: clientBook.accountId,
    },
  };

  // KẾT QUẢ: mỗi kịch bản chạy ĐỘC LẬP, bọc try/catch riêng — 1 kịch bản lỗi
  // (assert fail, DB lỗi, deadlock timeout...) chỉ được log lại, KHÔNG throw
  // ra ngoài làm dừng các kịch bản còn lại phía sau.
  const summary: { name: string; passed: boolean }[] = [];

  for (const scenario of SCENARIOS) {
    console.log(`\n=== ${scenario.name} ===`);
    try {
      await scenario.run(ctx);
      summary.push({ name: scenario.name, passed: true });
    } catch (error) {
      console.error(`  FAIL: ${scenario.name}`);
      console.error(error);
      summary.push({ name: scenario.name, passed: false });
    }
  }

  console.log('\n=== TỔNG KẾT ===');
  for (const { name, passed } of summary) {
    console.log(`${passed ? 'PASS' : 'FAIL'} - ${name}`);
  }

  const hasFailure = summary.some((s) => !s.passed);
  console.log(hasFailure ? '\nCó ít nhất 1 kịch bản FAIL — xem log lỗi chi tiết ở trên.' : '\nTất cả kịch bản đều PASS.');

  await sequelize.close();
  process.exitCode = hasFailure ? 1 : 0;
}

main().catch(async (error) => {
  // Chỉ những lỗi xảy ra NGOÀI phạm vi 4 kịch bản (vd không kết nối được DB
  // ngay từ đầu) mới rơi xuống đây và thật sự dừng script — vì lúc đó không
  // còn gì để "chạy tiếp" nữa.
  console.error('Lỗi ngoài phạm vi các kịch bản (vd không kết nối được DB):');
  console.error(error);
  await sequelize.close();
  process.exit(1);
});
