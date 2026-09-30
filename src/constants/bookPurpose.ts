import type { ValueOf } from '../types/common';

export const BOOK_PURPOSE = {
  CUSTODY_ASSET_ACCOUNT: {
    id: 1,
    code: 'CUSTODY_ASSET_ACCOUNT',
    name: 'Custody Asset Account Book',
    description: 'Represents assets held in custody on behalf of clients and recorded as custody assets.',
  },

  BLOCKCHAIN_EXTERNAL_ACCOUNT: {
    id: 2,
    // NOTE: the persisted code keeps its historical spelling ("BLOCKCHIAN") because it is stored in the DB
    // (book_purpose.code / book.name). Fixing it requires a data migration, so only the TS key was corrected.
    code: 'BLOCKCHIAN_EXTERNAL_ACCOUNT',
    name: 'Blockchain External Account Book',
    description: 'Represents assets or accounts outside the custody ledger, such as external blockchain or settlement accounts.',
  },
} as const;

export type BookPurposeDefinition = ValueOf<typeof BOOK_PURPOSE>;
export type BookPurposeId = BookPurposeDefinition['id'];
export type BookPurposeCode = BookPurposeDefinition['code'];
