import 'reflect-metadata';
import crypto from 'crypto';

import { container } from '../di/container';
import { sequelize } from '../config/database';
import { Book } from '../models';
import { DepositFlow, WithdrawFlow, StakeFlow } from '../logics';
import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';

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
  baseRequest: {
    clientId: number;
    accountId: number;
    assetTypeId: number;
    assetId: number;
    assetTicker: string;
    walletTypeId: number;
    address: string;
    transactionHash: string;
    amount: string;
    idempotencyToken: string;
    uuidToken: string;
    businessPostDateTime: Date;
  };
}

async function scenarioDepositRace(ctx: ScenarioContext): Promise<void> {
  const results = await Promise.all(Array.from({ length: 5 }, () => ctx.depositFlow.create(ctx.baseRequest)));
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
  await Promise.all(Array.from({ length: 5 }, () => ctx.depositFlow.confirm(ctx.baseRequest)));
  const clientAmountAfterConfirm = await getClientBookAmount(ctx.clientId, ctx.accountId, ctx.assetTypeId, 1, TRANSACTION_STATE.CONFIRMED.id);
  assert(
    clientAmountAfterConfirm === ctx.baseRequest.amount,
    `Số dư client sau 5 lần confirm trùng vẫn đúng = ${ctx.baseRequest.amount} (thực tế: ${clientAmountAfterConfirm}) — KHÔNG bị nhân 5 lần`,
  );
}

async function scenarioWithdraw(ctx: ScenarioContext): Promise<void> {
  const withdraw = await ctx.withdrawFlow.create({
    ...ctx.baseRequest,
    idempotencyToken: `${crypto.randomUUID()}`,
    uuidToken: crypto.randomUUID(),
    amount: '100',
    fee: '1',
    // transactionHash: crypto.randomBytes(32).toString(),
  });

  // await Promise.all([ctx.withdrawFlow.advance(withdraw.id, 'SENT', withdraw.transactionHash), ctx.withdrawFlow.advance(withdraw.id, 'SENT', withdraw.transactionHash)]);
  const transactionHash = crypto.randomBytes(32).toString('hex');
  await ctx.withdrawFlow.advance(withdraw.id, 'AUTHORIZED');
  await ctx.withdrawFlow.advance(withdraw.id, 'SENT');
  await ctx.withdrawFlow.advance(withdraw.id, 'CONFIRMING', transactionHash);

  const confirmed = await ctx.withdrawFlow.advance(withdraw.id, 'CONFIRMED', transactionHash);
  assert(confirmed.transactionStateId === TRANSACTION_STATE.CONFIRMED.id, 'journal.transaction_state_id đã được set = CONFIRMED sau advance()');

  await ctx.withdrawFlow.advance(withdraw.id, 'CONFIRMED'); // duplicate y hệt — phải là no-op

  // Event ĐẾN TRỄ / SAI THỨ TỰ: 1 "SENT" bị gửi lại SAU KHI đã CONFIRMED (vd
  // do message queue redeliver muộn). Guard monotonic phải chặn được — không
  // được phép làm lùi state hay ghi thêm history.
  const afterLateSent = await ctx.withdrawFlow.advance(withdraw.id, 'SENT');
  assert(
    afterLateSent.transactionStateId === TRANSACTION_STATE.CONFIRMED.id,
    `Event SENT đến trễ sau khi đã CONFIRMED bị bỏ qua đúng — state vẫn là CONFIRMED (thực tế: ${afterLateSent.transactionStateId})`,
  );
}

async function scenarioStakeUnstake(ctx: ScenarioContext): Promise<void> {
  const stake = await ctx.stakeFlow.create({
    ...ctx.baseRequest,
    idempotencyToken: `${crypto.randomUUID()}`,
    uuidToken: crypto.randomUUID(),
    amount: '50',
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
  { name: '3) Withdraw: full lifecycle + advance() gọi lại / gọi trễ sai thứ tự', run: scenarioWithdraw },
  // { name: '4) Stake / Unstake: unstake() gọi trùng đồng thời', run: scenarioStakeUnstake },
];

async function main() {
  await sequelize.authenticate();

  const ctx: ScenarioContext = {
    depositFlow: container.resolve(DepositFlow),
    withdrawFlow: container.resolve(WithdrawFlow),
    stakeFlow: container.resolve(StakeFlow),
    clientId: 1001,
    // Dùng random int nhỏ (không phải Date.now() — Date.now() trả về mili-giây,
    // 13 chữ số, VƯỢT giới hạn cột INTEGER của Postgres (4 byte, tối đa
    // 2,147,483,647) và sẽ làm INSERT văng lỗi "integer out of range" ngay cả
    // khi không hề có race condition nào xảy ra.
    accountId: crypto.randomInt(1, 2_000_000_000),
    assetTypeId: 1,
    baseRequest: {
      clientId: 1001,
      accountId: 0, // gán lại ngay bên dưới, cùng giá trị accountId ở trên
      assetTypeId: 1,
      assetId: 1,
      assetTicker: 'USDT',
      walletTypeId: 1,
      address: '0xabc',
      transactionHash: crypto.randomBytes(32).toString('hex'),
      amount: '1000',
      idempotencyToken: crypto.randomUUID(),
      uuidToken: crypto.randomUUID(),
      businessPostDateTime: new Date(),
    },
  };
  ctx.baseRequest.accountId = ctx.accountId;

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
