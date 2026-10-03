export const POST_SYNC_SQL: readonly string[] = [
  `DROP INDEX IF EXISTS idx_unique_book;`,
  `CREATE UNIQUE INDEX idx_unique_book
     ON book (client_id, account_id, asset_type_id, wallet_type_id, book_purpose_id, transaction_state_id)
     NULLS NOT DISTINCT;`,
];
