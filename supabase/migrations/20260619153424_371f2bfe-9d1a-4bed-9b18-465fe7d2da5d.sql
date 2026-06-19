-- Sand/Prod Batch 6 — Idempotent V1 request logging.
--
-- The Public API V1 commercial model derives billing/burn from
-- api_request_logs (single source of truth — see public-api-v1-billing.ts
-- and public-api-v1-usage.ts). Idempotency of "burn per request_id" is
-- therefore enforced at the log layer: a unique index on request_id
-- guarantees that a retried request with the same gateway-assigned
-- request_id cannot create a second billable row.
--
-- The index is partial (request_id IS NOT NULL) because pre-Batch-2
-- historical rows may carry NULL request_id values that must remain.
CREATE UNIQUE INDEX IF NOT EXISTS api_request_logs_request_id_unique
  ON public.api_request_logs (request_id)
  WHERE request_id IS NOT NULL;