export const TRANSACTION_STATE = {
  AUTHORIZING: {
    id: 1,
    code: 'AUTHORIZING',
    name: 'Authorizing',
    description: 'The transaction is being reviewed and authorized.',
  },

  AUTHORIZED: {
    id: 2,
    code: 'AUTHORIZED',
    name: 'Authorized',
    description: 'The transaction has been authorized and is ready for processing.',
  },

  SENT: {
    id: 3,
    code: 'SENT',
    name: 'Sent',
    description: 'The transaction has been submitted to the blockchain network.',
  },

  CONFIRMING: {
    id: 4,
    code: 'CONFIRMING',
    name: 'Confirming',
    description: 'The transaction has been submitted and is waiting for blockchain confirmations.',
  },

  CONFIRMED: {
    id: 5,
    code: 'CONFIRMED',
    name: 'Confirmed',
    description: 'The transaction has received sufficient blockchain confirmations and is considered final.',
  },
} as const;

export type TransactionStateKey = keyof typeof TRANSACTION_STATE;
