export const BOOK_PURPOSE = {
  CUSTODY_ASSET_ACCOUNT: {
    id: 1,
    code: 'CUSTODY_ASSET_ACCOUNT',
    name: 'Custody Asset Account Book',
    description: 'Represents assets held in custody on behalf of clients and recorded as custody assets.',
  },

  EXTERNAL_ACCOUNT: {
    id: 2,
    code: 'EXTERNAL_ACCOUNT',
    name: 'External Account Book',
    description: 'Represents assets or accounts outside the custody ledger, such as external blockchain or settlement accounts.',
  },

  CLIENT_ASSET_ACCOUNT: {
    id: 3,
    code: 'CLIENT_ASSET_ACCOUNT',
    name: 'Client Asset Account Book',
    description: 'Represents the assets and balances owned by a client within the custody system.',
  },

  BLOCKCHAIN_CONTROL_ACCOUNT: {
    id: 4,
    code: 'BLOCKCHAIN_CONTROL_ACCOUNT',
    name: 'Blockchain Control Account Book',
    description: 'Represents the blockchain-side control balance used to reconcile and control assets held on blockchain networks.',
  },

  // Dùng làm bên "giữ hộ" cho stake
  // (đối ứng với CLIENT_ASSET_ACCOUNT khi client stake tài sản).
  CUSTODY_CONTROL_ACCOUNT: {
    id: 5,
    code: 'CUSTODY_CONTROL_ACCOUNT',
    name: 'Custody Control Account Book',
    description:
      'Represents assets temporarily held or controlled by the custodian, such as assets moved from a client account into a staking position.',
  },
} as const;
