/**
 * SQL that Sequelize cannot express and that must run after `sequelize.sync()`.
 * Add statements here instead of inlining them in `syncDb.ts`.
 */
export const POST_SYNC_SQL: readonly string[] = [
  // One book per (account, asset type, wallet type, purpose, state). NULLS NOT DISTINCT (PostgreSQL 15+) makes the
  // external book, whose transaction_state_id is NULL, unique as well.
  `DROP INDEX IF EXISTS idx_unique_book;`,
  `CREATE UNIQUE INDEX idx_unique_book
     ON book (client_id, account_id, asset_type_id, wallet_type_id, book_purpose_id, transaction_state_id)
     NULLS NOT DISTINCT;`,
];
