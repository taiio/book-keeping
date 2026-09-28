/**
 * Key trùng khớp với discriminator `type` của các domain transaction
 * (interfaces/Withdraw.ts, Stake.ts, ...) — nhờ đó có thể tra thẳng
 * `TRANSACTION_TYPE[transaction.type]` mà không cần bảng ánh xạ riêng.
 */
export const TRANSACTION_TYPE = {
  DEPOSIT: 1,
  WITHDRAW: 2,
  STAKE: 3,
  UNSTAKE: 4,
  RESTAKE: 5,
} as const;
