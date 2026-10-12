CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is not allowed on table %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_book_purpose_no_delete BEFORE DELETE ON book_purpose FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_book_purpose_no_truncate BEFORE TRUNCATE ON book_purpose FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_transaction_state_no_delete BEFORE DELETE ON transaction_state FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_transaction_state_no_truncate BEFORE TRUNCATE ON transaction_state FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_journal_transaction_no_delete BEFORE DELETE ON journal_transaction FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_journal_transaction_no_truncate BEFORE TRUNCATE ON journal_transaction FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_journal_transaction_history_no_delete BEFORE DELETE ON journal_transaction_history FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_journal_transaction_history_no_truncate BEFORE TRUNCATE ON journal_transaction_history FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_book_no_delete BEFORE DELETE ON book FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_book_no_truncate BEFORE TRUNCATE ON book FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_book_posting_no_delete BEFORE DELETE ON book_posting FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_book_posting_no_truncate BEFORE TRUNCATE ON book_posting FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_book_history_no_delete BEFORE DELETE ON book_history FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_book_history_no_truncate BEFORE TRUNCATE ON book_history FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_inbox_event_no_delete BEFORE DELETE ON inbox_event FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_inbox_event_no_truncate BEFORE TRUNCATE ON inbox_event FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_outbox_event_no_delete BEFORE DELETE ON outbox_event FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_outbox_event_no_truncate BEFORE TRUNCATE ON outbox_event FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_schema_migration_no_delete BEFORE DELETE ON schema_migration FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER trg_schema_migration_no_truncate BEFORE TRUNCATE ON schema_migration FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
