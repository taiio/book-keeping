export type TransactionState =
  | 'AUTHORIZING'
  | 'AUTHORIZED'
  | 'SUBMITTING'
  | 'SENT'
  | 'CONFIRMED'
  | 'FAILED';
