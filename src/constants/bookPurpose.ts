export const BOOK_PURPOSE = {
  CUSTODY_ASSET_ACCOUNT: {
    id: 1,
    code: 'CUSTODY_ASSET_ACCOUNT',
    name: 'Custody Asset Account Book',
    description: 'Represents assets held in custody on behalf of clients and recorded as custody assets.',
  },

  BLOCKCHIAN_EXTERNAL_ACCOUNT: {
    id: 2,
    code: 'BLOCKCHIAN_EXTERNAL_ACCOUNT',
    name: 'Blockchain External Account Book',
    description: 'Represents assets or accounts outside the custody ledger, such as external blockchain or settlement accounts.',
  },

  // Design "Withdraw" (FEE): Fee Confirming Book — phần fee tách ra khỏi bucket Confirming khi giao dịch được CONFIRMED.
  FEE_CONFIRMING_ACCOUNT: {
    id: 7,
    code: 'FEE_CONFIRMING_ACCOUNT',
    name: 'Fee Confirming Account Book',
    description: 'Transit book for the fee portion of a confirmed transaction before it is recognised as revenue.',
  },

  // Design "Withdraw" (FEE): Fee Revenue Book — doanh thu phí của platform (không thuộc client nào).
  FEE_REVENUE_ACCOUNT: {
    id: 8,
    code: 'FEE_REVENUE_ACCOUNT',
    name: 'Fee Revenue Account Book',
    description: 'Platform revenue collected from transaction fees.',
  },

  //Temp: we don't use on this book.
  // CLIENT_ASSET_ACCOUNT: {
  //   id: 3,
  //   code: 'CLIENT_ASSET_ACCOUNT',
  //   name: 'Client Asset Account Book',
  //   description: 'Represents the assets and balances owned by a client within the custody system.',
  // },

  // BLOCKCHAIN_CONTROL_ACCOUNT: {
  //   id: 4,
  //   code: 'BLOCKCHAIN_CONTROL_ACCOUNT',
  //   name: 'Blockchain Control Account Book',
  //   description: 'Represents the blockchain-side control balance used to reconcile and control assets held on blockchain networks.',
  // },

  // CUSTODY_CONTROL_ACCOUNT: {
  //   id: 5,
  //   code: 'CUSTODY_CONTROL_ACCOUNT',
  //   name: 'Custody Control Account Book',
  //   description:
  //     'Represents assets temporarily held or controlled by the custodian, such as assets moved from a client account into a staking position.',
  // },
} as const;
