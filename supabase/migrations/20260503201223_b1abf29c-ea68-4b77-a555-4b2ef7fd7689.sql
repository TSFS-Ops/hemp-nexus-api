-- ============================================================================
-- D-01 Paystack reconciliation hardening
-- ============================================================================

-- 1) Backfill canonical `payment_reference` mirror on existing initiated rows
--    that only stored the reference under the legacy `reference` key. This is
--    a non-destructive enrichment: original `reference` key is preserved.
UPDATE public.audit_logs
SET metadata = metadata || jsonb_build_object(
  'payment_reference', metadata->>'reference',
  'backfilled', true,
  'backfill_reason', 'pre_canonical_payment_reference_key'
)
WHERE action = 'credits.purchase_initiated'
  AND COALESCE(metadata->>'reference','') <> ''
  AND COALESCE(metadata->>'payment_reference','') = '';

-- 2) Tag any `credits.purchased` row that has no matching initiation row
--    (pre-webhook-era settlement) so reconciliation can distinguish historical
--    rows from new orphans going forward.
UPDATE public.audit_logs p
SET metadata = p.metadata || jsonb_build_object(
  'backfilled', true,
  'backfill_reason', 'pre_webhook_era_missing_initiation'
)
WHERE p.action = 'credits.purchased'
  AND COALESCE(p.metadata->>'backfilled','false') <> 'true'
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs i
    WHERE i.action = 'credits.purchase_initiated'
      AND COALESCE(i.metadata->>'payment_reference', i.metadata->>'reference')
        = COALESCE(p.metadata->>'payment_reference', p.metadata->>'reference')
      AND COALESCE(p.metadata->>'payment_reference', p.metadata->>'reference','') <> ''
  );

-- 3) Reconciliation view: one row per Paystack reference seen in either
--    initiated or purchased audit logs, with classification.
CREATE OR REPLACE VIEW public.v_paystack_reconciliation AS
WITH init AS (
  SELECT
    COALESCE(metadata->>'payment_reference', metadata->>'reference') AS payment_reference,
    org_id,
    (metadata->>'price_usd')::numeric AS expected_price_usd,
    metadata->>'currency'   AS expected_currency,
    metadata->>'package_id' AS expected_package_id,
    (metadata->>'credits')::int AS expected_credits,
    created_at AS initiated_at,
    COALESCE((metadata->>'backfilled')::boolean, false) AS init_backfilled
  FROM public.audit_logs
  WHERE action = 'credits.purchase_initiated'
    AND COALESCE(metadata->>'payment_reference', metadata->>'reference') IS NOT NULL
), purch AS (
  SELECT
    COALESCE(metadata->>'payment_reference', metadata->>'reference') AS payment_reference,
    org_id,
    (metadata->>'price_usd')::numeric AS settled_price_usd,
    metadata->>'currency'   AS settled_currency,
    metadata->>'package_id' AS settled_package_id,
    (metadata->>'credits_added')::int AS settled_credits,
    created_at AS settled_at,
    COALESCE((metadata->>'backfilled')::boolean, false) AS purch_backfilled
  FROM public.audit_logs
  WHERE action = 'credits.purchased'
    AND COALESCE(metadata->>'payment_reference', metadata->>'reference') IS NOT NULL
), failed AS (
  SELECT DISTINCT
    COALESCE(metadata->>'payment_reference', metadata->>'reference') AS payment_reference
  FROM public.audit_logs
  WHERE action = 'credits.purchase_failed'
), refs AS (
  SELECT payment_reference FROM init
  UNION
  SELECT payment_reference FROM purch
)
SELECT
  r.payment_reference,
  i.org_id            AS init_org_id,
  p.org_id            AS settled_org_id,
  i.initiated_at,
  p.settled_at,
  i.expected_price_usd,
  p.settled_price_usd,
  i.expected_currency,
  p.settled_currency,
  i.expected_package_id,
  p.settled_package_id,
  i.expected_credits,
  p.settled_credits,
  i.init_backfilled,
  p.purch_backfilled,
  (f.payment_reference IS NOT NULL) AS marked_failed,
  CASE
    WHEN p.payment_reference IS NOT NULL AND i.payment_reference IS NOT NULL
         AND (
           (i.expected_price_usd IS DISTINCT FROM p.settled_price_usd) OR
           (i.expected_currency  IS DISTINCT FROM p.settled_currency)  OR
           (i.expected_package_id IS DISTINCT FROM p.settled_package_id)
         )
      THEN 'mismatched'
    WHEN p.payment_reference IS NOT NULL AND i.payment_reference IS NOT NULL
      THEN 'settled'
    WHEN p.payment_reference IS NOT NULL AND i.payment_reference IS NULL
         AND COALESCE(p.purch_backfilled, false) = true
      THEN 'settled_backfilled_no_initiation'
    WHEN p.payment_reference IS NOT NULL AND i.payment_reference IS NULL
      THEN 'orphan_purchased_no_initiation'
    WHEN i.payment_reference IS NOT NULL AND f.payment_reference IS NOT NULL
      THEN 'failed'
    WHEN i.payment_reference IS NOT NULL
         AND i.initiated_at < now() - interval '30 minutes'
      THEN 'orphan_initiated_no_settlement'
    WHEN i.payment_reference IS NOT NULL
      THEN 'pending_settlement'
    ELSE 'unknown'
  END AS status
FROM refs r
LEFT JOIN init   i ON i.payment_reference = r.payment_reference
LEFT JOIN purch  p ON p.payment_reference = r.payment_reference
LEFT JOIN failed f ON f.payment_reference = r.payment_reference;

COMMENT ON VIEW public.v_paystack_reconciliation IS
  'D-01 reconciliation: classifies every Paystack reference as settled, pending_settlement, orphan_initiated_no_settlement, orphan_purchased_no_initiation, mismatched, failed, or settled_backfilled_no_initiation. Read-only.';

-- 4) Reconciliation RPC for daily monitoring + admin/HQ panels.
CREATE OR REPLACE FUNCTION public.reconcile_paystack_purchases(
  p_window interval DEFAULT interval '90 days'
) RETURNS TABLE(status text, n bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT status, COUNT(*)::bigint AS n
  FROM public.v_paystack_reconciliation
  WHERE COALESCE(initiated_at, settled_at) >= now() - p_window
  GROUP BY status
  ORDER BY status;
$$;

REVOKE ALL ON FUNCTION public.reconcile_paystack_purchases(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_paystack_purchases(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_paystack_purchases(interval) TO authenticated;

-- 5) Restrict reconciliation view to authenticated/service_role (admins read it
--    via existing RLS-aware admin panels).
REVOKE ALL ON public.v_paystack_reconciliation FROM PUBLIC;
GRANT SELECT ON public.v_paystack_reconciliation TO authenticated, service_role;

-- 6) Defensive: ensure billing_availability remains FALSE. We never re-enable
--    here. If an operator already toggled it on, leave their decision intact;
--    if it is missing or null, force it to false.
UPDATE public.admin_settings
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{enabled}',
  to_jsonb(COALESCE((value->>'enabled')::boolean, false))
)
WHERE key = 'billing_availability';