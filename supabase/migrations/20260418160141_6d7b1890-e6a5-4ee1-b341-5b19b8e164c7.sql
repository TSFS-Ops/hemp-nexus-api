ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_webhook_endpoints_primary_per_org
  ON public.webhook_endpoints (org_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_primary_tripped
  ON public.webhook_endpoints (org_id)
  WHERE is_primary = true AND disabled_at IS NOT NULL;

WITH single_endpoint_orgs AS (
  SELECT org_id
  FROM public.webhook_endpoints
  GROUP BY org_id
  HAVING COUNT(*) = 1
)
UPDATE public.webhook_endpoints we
   SET is_primary = true
  FROM single_endpoint_orgs s
 WHERE we.org_id = s.org_id
   AND we.is_primary = false;

INSERT INTO public.admin_audit_logs (action, target_type, target_id, details)
VALUES (
  'webhook.primary_flag_installed',
  'webhook_endpoints',
  NULL,
  jsonb_build_object(
    'reason', 'Settlement guard requires designated primary endpoint per org',
    'backfill_strategy', 'single-endpoint orgs auto-promoted; multi-endpoint orgs require manual election'
  )
);