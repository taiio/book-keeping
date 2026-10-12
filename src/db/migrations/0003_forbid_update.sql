CREATE TRIGGER trg_book_purpose_no_update BEFORE UPDATE ON book_purpose FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_transaction_state_no_update BEFORE UPDATE ON transaction_state FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_journal_transaction_history_no_update BEFORE UPDATE ON journal_transaction_history FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_book_posting_no_update BEFORE UPDATE ON book_posting FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_book_history_no_update BEFORE UPDATE ON book_history FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_schema_migration_no_update BEFORE UPDATE ON schema_migration FOR EACH ROW EXECUTE FUNCTION forbid_change();
