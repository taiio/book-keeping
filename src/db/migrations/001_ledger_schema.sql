-- =====================================================================================================================
-- Ledger schema for PRODUCTION / shared PostgreSQL (>= 15 for NULLS NOT DISTINCT; see the note at uq_book for 12-14).
--
-- STATUS: reviewed by hand, NOT executed against a live server in this session. Run it on a scratch database first.
--
-- Design decisions (details and trade-offs in REVIEW.md):
--   * own schema `ledger`, own role, no cross-service foreign keys  -> safe to live next to other services
--   * BIGINT ids everywhere that grows (INTEGER overflows at ~2.1e9 rows; book_posting gets there first)
--   * book_posting / book_history: HASH(book_id) partitioned. Reads and writes are always "for one book", and every
--     lock is per book, so a book's whole history lives in exactly one partition.
--   * unique constraints on partitioned tables must contain the partition key -> (book_id, idempotency_token)
--   * foreign keys INTO partitioned tables are dropped (a FK needs a unique key on the referenced column alone);
--     integrity is guaranteed by the single write path + db/reconcile.sql
-- =====================================================================================================================
CREATE SCHEMA IF NOT EXISTS ledger;
SET search_path = ledger;

CREATE TABLE book_purpose (
  id           integer PRIMARY KEY,
  code         varchar(64)  NOT NULL UNIQUE,
  name         varchar(150) NOT NULL,
  description  text,
  created_date timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE transaction_state (
  id           integer PRIMARY KEY,
  code         varchar(50)  NOT NULL UNIQUE,
  name         varchar(100) NOT NULL,
  description  text,
  created_date timestamptz  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE book (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               varchar(255),
  book_purpose_id    integer NOT NULL REFERENCES book_purpose (id),
  transaction_state_id integer REFERENCES transaction_state (id),
  client_id          integer NOT NULL,
  account_id         integer NOT NULL,
  asset_id           integer NOT NULL,
  asset_type_id      integer NOT NULL,
  asset_ticker       varchar(50) NOT NULL,
  amount             numeric(78, 0) NOT NULL DEFAULT 0,   -- 78 digits holds a full uint256
  last_sequence_no   bigint  NOT NULL DEFAULT 0,
  wallet_type_id     integer NOT NULL,
  address            varchar(255),
  created_date       timestamptz NOT NULL DEFAULT now(),
  created_by         integer,
  updated_date       timestamptz,
  updated_by         integer,
  -- last line of defence behind the application check: custody books (purpose 1) can never be negative.
  -- The EXTERNAL book (purpose 2) is the counter-party of the whole ledger and is allowed to go negative.
  CONSTRAINT ck_book_custody_non_negative CHECK (book_purpose_id <> 1 OR amount >= 0)
);

-- transaction_state_id is NULL for external books. A plain UNIQUE treats NULLs as distinct, which lets two concurrent
-- transactions create TWO external books for the same account/asset. NULLS NOT DISTINCT closes that hole.
CREATE UNIQUE INDEX uq_book ON book (client_id, account_id, asset_type_id, wallet_type_id, book_purpose_id, transaction_state_id) NULLS NOT DISTINCT;
-- PostgreSQL 12-14 alternative:
--   CREATE UNIQUE INDEX uq_book ON book (client_id, account_id, asset_type_id, wallet_type_id, book_purpose_id, COALESCE(transaction_state_id, 0));
--   (and make the application look the key up with COALESCE as well)
CREATE INDEX idx_book_deposit_address ON book (address, asset_ticker) WHERE address IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE journal_transaction (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uuid_token              varchar(36) NOT NULL,
  transaction_type_id     integer NOT NULL,
  from_account_id         integer,
  to_account_id           integer,
  request_id              integer,
  transaction_hash        varchar(255),
  journal_transaction_state integer NOT NULL CHECK (journal_transaction_state IN (1, 2, 3, 4)),
  current_state_id        integer REFERENCES transaction_state (id),   -- denormalised; history stays the audit trail
  idempotency_token       varchar(255) UNIQUE,
  source_content          text,
  business_post_date_time timestamptz,
  created_date            timestamptz NOT NULL DEFAULT now(),
  created_by              integer,
  updated_date            timestamptz,
  updated_by              integer
);
CREATE INDEX idx_journal_transaction_uuid_token ON journal_transaction (uuid_token);
CREATE INDEX idx_journal_transaction_hash       ON journal_transaction (transaction_hash) WHERE transaction_hash IS NOT NULL;
-- stuck-in-flight monitor (see reconcile.sql #4)
CREATE INDEX idx_journal_transaction_active     ON journal_transaction (updated_date) WHERE journal_transaction_state = 1;

CREATE TABLE journal_transaction_history (
  id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  history_transaction_type_id integer NOT NULL,
  journal_transaction_id      bigint  NOT NULL REFERENCES journal_transaction (id),
  journal_transaction_state   integer NOT NULL,
  request_id                  integer,
  transaction_hash            varchar(255),
  transaction_state_id        integer REFERENCES transaction_state (id),
  created_date                timestamptz NOT NULL DEFAULT now(),
  created_by                  integer
);
CREATE INDEX idx_jt_history_journal ON journal_transaction_history (journal_transaction_id, id);
-- When this table becomes large, convert it to PARTITION BY RANGE (created_date) managed by pg_partman (monthly) and
-- drop the FK; it is append-only and only ever read by journal id, so old partitions can be detached/archived freely.

-- ---------------------------------------------------------------------------------------------------------------------
CREATE SEQUENCE book_posting_id_seq AS bigint;
CREATE SEQUENCE book_history_id_seq AS bigint;

CREATE TABLE book_posting (
  id                      bigint NOT NULL DEFAULT nextval('ledger.book_posting_id_seq'),
  uuid_token              uuid NOT NULL,
  journal_transaction_id  bigint,
  book_id                 bigint NOT NULL,
  amount                  numeric(78, 0) NOT NULL DEFAULT 0,
  book_posting_purpose_id integer NOT NULL,
  asset_type_id           integer,
  sequence_no             bigint NOT NULL,
  idempotency_token       varchar(64) NOT NULL,
  business_post_date_time timestamptz,
  created_date            timestamptz NOT NULL DEFAULT now(),
  created_by              integer,
  PRIMARY KEY (book_id, id),
  CONSTRAINT uk_book_posting_book_sequence    UNIQUE (book_id, sequence_no),
  CONSTRAINT uk_book_posting_book_idempotency UNIQUE (book_id, idempotency_token)
) PARTITION BY HASH (book_id);
ALTER SEQUENCE book_posting_id_seq OWNED BY book_posting.id;

CREATE TABLE book_history (
  id                          bigint NOT NULL DEFAULT nextval('ledger.book_history_id_seq'),
  history_transaction_type_id integer NOT NULL,
  book_id                     bigint  NOT NULL,
  book_posting_id             bigint,
  amount                      numeric(78, 0) NOT NULL DEFAULT 0,
  last_sequence_no            bigint NOT NULL DEFAULT 0,
  created_date                timestamptz NOT NULL DEFAULT now(),
  created_by                  integer,
  PRIMARY KEY (book_id, id)
) PARTITION BY HASH (book_id);
ALTER SEQUENCE book_history_id_seq OWNED BY book_history.id;

-- 64 partitions: enough head-room for a 64-way split later (Citus / FDW sharding by book_id keeps the same hash layout)
-- and small enough that planning/locking stays cheap. Changing the count later means re-partitioning: choose generously.
DO $$
BEGIN
  FOR i IN 0..63 LOOP
    EXECUTE format('CREATE TABLE book_posting_p%s PARTITION OF book_posting FOR VALUES WITH (MODULUS 64, REMAINDER %s)', i, i);
    EXECUTE format('CREATE TABLE book_history_p%s PARTITION OF book_history FOR VALUES WITH (MODULUS 64, REMAINDER %s)', i, i);
  END LOOP;
END $$;

CREATE INDEX idx_book_posting_journal ON book_posting (journal_transaction_id, book_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- Least-privilege application role: DML only, no DDL, no DROP (the old syncDb could drop everything).
-- CREATE ROLE ledger_app LOGIN PASSWORD '...';
-- GRANT USAGE ON SCHEMA ledger TO ledger_app;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ledger TO ledger_app;   -- no DELETE: the ledger is append-only
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA ledger TO ledger_app;
-- ALTER ROLE ledger_app SET search_path = ledger;
-- ALTER ROLE ledger_app SET idle_in_transaction_session_timeout = '30s';
