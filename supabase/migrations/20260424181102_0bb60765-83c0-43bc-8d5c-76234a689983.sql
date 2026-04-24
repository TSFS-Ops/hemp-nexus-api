-- ─────────────────────────────────────────────────────────────────────────
-- webhook_replay_guard
--   Append-only ledger of signed webhook signatures we have already
--   processed. The unique index on (source, signature_hash) is the
--   atomic primitive that detects replays — a second INSERT for the
--   same row fails with a unique-violation, which the calling edge
--   function translates into a stable 409 "replay_detected" response.
--
--   We deliberately store SHA-256 of the signature (not the signature
--   itself) so the table cannot be used as an oracle to harvest valid
--   signatures, and so the index stays compact.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.webhook_replay_guard (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  signature_hash TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The unique constraint IS the replay-detection mechanism.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_replay_guard_unique_sig
  ON public.webhook_replay_guard (source, signature_hash);

-- Index for cheap TTL pruning.
CREATE INDEX IF NOT EXISTS webhook_replay_guard_seen_at_idx
  ON public.webhook_replay_guard (seen_at);

-- Lock down: nobody touches this from the client. Only service-role
-- edge functions read/write it.
ALTER TABLE public.webhook_replay_guard ENABLE ROW LEVEL SECURITY;

-- No policies are defined on purpose. With RLS enabled and zero
-- policies, only the postgres / service_role keys (which bypass RLS)
-- can read or write — exactly what we want.

COMMENT ON TABLE public.webhook_replay_guard IS
  'Ledger of inbound webhook signatures already processed. Used by edge functions to reject replays. Service-role only.';
COMMENT ON COLUMN public.webhook_replay_guard.source IS
  'Logical webhook source identifier (e.g. lovable_email, lovable_suppression).';
COMMENT ON COLUMN public.webhook_replay_guard.signature_hash IS
  'SHA-256 hex digest of the inbound signature header. Hashed to avoid storing reusable secrets.';

-- ─────────────────────────────────────────────────────────────────────────
-- prune_webhook_replay_guard()
--   TTL helper. The longest-lived inbound webhook freshness window we
--   currently allow is ~5 minutes; we keep 24h of history to give us a
--   wide replay-detection horizon while still bounding table growth.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prune_webhook_replay_guard()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.webhook_replay_guard
  WHERE seen_at < now() - INTERVAL '24 hours';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.prune_webhook_replay_guard() IS
  'Deletes webhook_replay_guard rows older than 24h. Safe to invoke from any scheduled cleanup job.';

-- Restrict execute: only superusers and the service role should call it.
REVOKE ALL ON FUNCTION public.prune_webhook_replay_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_webhook_replay_guard() FROM anon;
REVOKE ALL ON FUNCTION public.prune_webhook_replay_guard() FROM authenticated;
