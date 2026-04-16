-- 1. Idempotency: prevent double POI burns
DELETE FROM collapse_ledger
WHERE id NOT IN (
  SELECT DISTINCT ON (idempotency_key) id
  FROM collapse_ledger
  ORDER BY idempotency_key, created_at ASC
);

ALTER TABLE collapse_ledger
  ADD CONSTRAINT collapse_ledger_idempotency_key_unique UNIQUE (idempotency_key);

-- 2. Document version uniqueness: only one is_current_version per (match_id, doc_type)
UPDATE match_documents md
SET is_current_version = false
WHERE is_current_version = true
  AND id NOT IN (
    SELECT DISTINCT ON (match_id, doc_type) id
    FROM match_documents
    WHERE is_current_version = true
    ORDER BY match_id, doc_type, created_at DESC
  );

CREATE UNIQUE INDEX idx_match_documents_one_current_per_type
  ON match_documents (match_id, doc_type)
  WHERE is_current_version = true;