-- Batch D — webhook secret rotation grace window
-- Adds previous_secret_hash + previous_secret_expires_at columns to
-- webhook_endpoints so a rotation can keep the old secret valid for a
-- bounded grace window (24h). Outbound signing always uses the current
-- secret; inbound verification (when added) may accept either during
-- the grace window.

ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS previous_secret_hash text,
  ADD COLUMN IF NOT EXISTS previous_secret_expires_at timestamptz;

COMMENT ON COLUMN public.webhook_endpoints.previous_secret_hash IS
  'Encrypted previous webhook secret kept valid during the rotation grace window. NULL once grace expires.';

COMMENT ON COLUMN public.webhook_endpoints.previous_secret_expires_at IS
  'When the previous secret stops being accepted for signature verification.';

-- Helpful index for the cleanup sweep (drop expired previous secrets).
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_previous_secret_expiry
  ON public.webhook_endpoints (previous_secret_expires_at)
  WHERE previous_secret_hash IS NOT NULL;
