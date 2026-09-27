import { TRANSACTION_STATE } from '../../constants';
import { WithdrawKind } from './types';

/**
 * Chuỗi state HỢP LỆ cho từng kind — dùng làm `expectedStateSequence` khi
 * gọi JournalTransactionRepository.updateJournalTransaction. advance() BẮT
 * BUỘC đi đúng thứ tự trong mảng này; sai -> cả journal bị CANCELLED ngay.
 *
 * Withdraw lifecycle (kind EXTERNAL — đủ 5 state):
 *   AUTHORIZING -> AUTHORIZED -> SENT -> CONFIRMING -> CONFIRMED
 * kind INTERNAL 5 STATE:
 *  AUTHORIZING -> AUTHORIZED -> SENT -> CONFIRMING -> CONFIRMED
 */
export const WITHDRAW_STATE_SEQUENCE: Record<WithdrawKind, number[]> = {
  EXTERNAL: [
    TRANSACTION_STATE.AUTHORIZING.id,
    TRANSACTION_STATE.AUTHORIZED.id,
    TRANSACTION_STATE.SENT.id,
    TRANSACTION_STATE.CONFIRMING.id,
    TRANSACTION_STATE.CONFIRMED.id,
  ],
  INTERNAL: [
    TRANSACTION_STATE.AUTHORIZING.id,
    TRANSACTION_STATE.AUTHORIZED.id,
    TRANSACTION_STATE.SENT.id,
    TRANSACTION_STATE.CONFIRMING.id,
    TRANSACTION_STATE.CONFIRMED.id,

  ],
};
