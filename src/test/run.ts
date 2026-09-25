import 'reflect-metadata';
import crypto from 'crypto';

import { container } from '../di/container';
import { sequelize } from '../config/database';
import { DepositFlow, WithdrawFlow, StakeFlow } from '../logics';

/**
 * Script test thủ công: mỗi nghiệp vụ chỉ khác nhau ở params truyền vào,
 * còn lại đều gọi qua cùng 1 bộ repository (getOrCreateJournalTransaction,
 * updateJournalTransaction, getOrCreateBook, updateBook, createBookPosting).
 *
 * Chạy: npm run test:manual  (cần DB Postgres đã có sẵn schema thật, xem index.ts)
 */
async function main() {
  await sequelize.authenticate();

  const depositFlow = container.resolve(DepositFlow);
  const withdrawFlow = container.resolve(WithdrawFlow);
  const stakeFlow = container.resolve(StakeFlow);

  const baseRequest = {
    clientId: 1001,
    accountId: 2001,
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
  };

  // ---- Deposit ----
  const deposit = await depositFlow.create(baseRequest);
  console.log('deposit created', deposit.id);
  await depositFlow.confirm({ ...baseRequest, businessPostDateTime: new Date() });
  console.log('deposit confirmed', deposit.id);

  await sequelize.close();

  //   // ---- Withdraw: chỉ đổi params (thêm fee) và gọi lại đúng flow y hệt cấu trúc ----
  //   const withdraw = await withdrawFlow.create({
  //     ...baseRequest,
  //     idempotencyToken: `withdraw:${crypto.randomUUID()}`,
  //     uuidToken: crypto.randomUUID(),
  //     amount: '100',
  //     fee: '1',
  //     transactionHash: 'tx-withdraw-1',
  //   });
  //   console.log('withdraw created', withdraw.id);

  //   await withdrawFlow.advance(withdraw.id, 'AUTHORIZED');
  //   await withdrawFlow.advance(withdraw.id, 'SENT', 'tx-withdraw-1-sent');
  //   await withdrawFlow.advance(withdraw.id, 'CONFIRMING');
  //   await withdrawFlow.advance(withdraw.id, 'CONFIRMED');
  //   console.log('withdraw confirmed', withdraw.id);

  //   // ---- Stake: nghiệp vụ thứ 3, cũng chỉ đổi params ----
  //   const stake = await stakeFlow.create({
  //     ...baseRequest,
  //     idempotencyToken: `stake:${crypto.randomUUID()}`,
  //     uuidToken: crypto.randomUUID(),
  //     amount: '50',
  //   });
  //   console.log('stake created (locked)', stake.id);

  //   await stakeFlow.unstake(stake.id);
  //   console.log('stake unstaked', stake.id);

  //   await sequelize.close();
  // }
}

main().catch(async (error) => {
  console.error(error);
  await sequelize.close();
  process.exit(1);
});
