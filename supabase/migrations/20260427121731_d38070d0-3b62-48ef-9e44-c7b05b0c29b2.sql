-- Idempotency for operator_verification_requests:
-- Prevent two simultaneous OPEN requests for the same (match, subject, kind).
-- Closed requests (completed/cancelled) are exempt so historical audit trail
-- can co-exist with a fresh re-open.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ovr_open_request
ON public.operator_verification_requests (match_id, lower(subject_name), kind)
WHERE status IN ('pending','in_progress');

-- Light URL sanity at the database boundary (defence in depth alongside UI):
-- Reject obviously-malformed website / linkedin URLs. NULLs allowed.
ALTER TABLE public.match_counterparty_intel
  ADD CONSTRAINT chk_mci_website_url
    CHECK (website_url IS NULL OR website_url ~* '^https?://[^\s]+\.[^\s]+$'),
  ADD CONSTRAINT chk_mci_linkedin_url
    CHECK (linkedin_url IS NULL OR linkedin_url ~* '^https?://([a-z0-9-]+\.)*linkedin\.com/.+$');