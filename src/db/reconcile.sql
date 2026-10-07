-- Reconciliation queries. Run on a schedule (read replica is fine) and alert on ANY returned row.
-- Not executed in this session: validate on a scratch database first.
SET search_path = ledger;

-- 1. Cached balance must equal the sum of postings (a drift means a write path bypassed the repository).
SELECT b.id, b.amount AS book_amount, COALESCE(p.total, 0) AS posted
FROM book b
LEFT JOIN (SELECT book_id, SUM(amount) AS total FROM book_posting GROUP BY book_id) p ON p.book_id = b.id
WHERE b.amount <> COALESCE(p.total, 0);

-- 2. sequence_no must be gap-free and match book.last_sequence_no.
SELECT b.id, b.last_sequence_no, p.max_seq, p.cnt
FROM book b
JOIN (SELECT book_id, MAX(sequence_no) AS max_seq, COUNT(*) AS cnt FROM book_posting GROUP BY book_id) p ON p.book_id = b.id
WHERE b.last_sequence_no <> p.max_seq OR p.max_seq <> p.cnt;

-- 3. Double-entry invariant: all books of one asset type sum to zero.
SELECT asset_type_id, SUM(amount) AS imbalance
FROM book
GROUP BY asset_type_id
HAVING SUM(amount) <> 0;

-- 4. Journals stuck in flight (adjust the interval to your SLA). Typical causes: lost chain event, submit never retried.
SELECT id, transaction_type_id, current_state_id, transaction_hash, updated_date
FROM journal_transaction
WHERE journal_transaction_state = 1
  AND COALESCE(updated_date, created_date) < now() - interval '30 minutes';

-- 5. Finished journals must not hold value in an in-flight book.
SELECT bp.journal_transaction_id, bp.book_id, SUM(bp.amount) AS still_held
FROM book_posting bp
JOIN book b ON b.id = bp.book_id AND b.book_purpose_id = 1 AND b.transaction_state_id NOT IN (5)
JOIN journal_transaction jt ON jt.id = bp.journal_transaction_id AND jt.journal_transaction_state <> 1
GROUP BY bp.journal_transaction_id, bp.book_id
HAVING SUM(bp.amount) <> 0;
