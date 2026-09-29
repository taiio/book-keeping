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
} as const;

export type BookPurposeId = (typeof BOOK_PURPOSE)[keyof typeof BOOK_PURPOSE]['id'];

export type BookPurposeCode = (typeof BOOK_PURPOSE)[keyof typeof BOOK_PURPOSE]['code'];

export type BookPurpose = (typeof BOOK_PURPOSE)[keyof typeof BOOK_PURPOSE];
