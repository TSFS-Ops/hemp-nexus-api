-- 1. Failure tracking columns
ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

-- 2. Database-level invariant: disabled endpoints must be inactive
ALTER TABLE public.webhook_endpoints
  DROP CONSTRAINT IF EXISTS webhook_status_check;

ALTER TABLE public.webhook_endpoints
  ADD CONSTRAINT webhook_status_check
  CHECK (
    (disabled_at IS NULL) OR (status = 'inactive')
  );

-- 3. Index to speed up the breaker sweep
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_failures
  ON public.webhook_endpoints(consecutive_failures)
  WHERE disabled_at IS NULL;

-- 4. Audit log entry
INSERT INTO public.admin_audit_logs (action, target_type, target_id, details)
VALUES (
    'webhook.circuit_breaker_installed',
    'webhook_endpoints',
    NULL,
    jsonb_build_object(
        'threshold', 10,
        'logic', 'consecutive_failures > 10 triggers auto-disable',
        'columns_added', ARRAY['consecutive_failures', 'disabled_at'],
        'invariant', 'disabled_at IS NOT NULL implies status = inactive'
    )
);