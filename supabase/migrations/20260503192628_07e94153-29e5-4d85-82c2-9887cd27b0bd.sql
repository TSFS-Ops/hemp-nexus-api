-- D-08: Admin view to monitor account hard-delete sweep state.
-- Read-only aggregate of pending_deletion profiles + sweep audit history.

CREATE OR REPLACE VIEW public.account_hard_delete_status AS
WITH candidates AS (
  SELECT
    p.id AS user_id,
    p.org_id,
    p.deletion_requested_at,
    p.deletion_reason,
    p.deletion_category,
    p.email AS placeholder_email,
    EXTRACT(EPOCH FROM (now() - p.deletion_requested_at)) / 86400.0 AS days_pending,
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role = 'platform_admin'
    ) AS is_platform_admin,
    EXISTS (
      SELECT 1 FROM public.pois po
      WHERE po.org_id = p.org_id
        AND po.state IN ('PENDING_APPROVAL','ELIGIBLE','COMPLETION_REQUESTED')
    ) AS has_active_pois,
    EXISTS (
      SELECT 1 FROM public.disputes d
      WHERE d.raised_by_org_id = p.org_id
        AND d.resolved_at IS NULL
    ) AS has_open_disputes
  FROM public.profiles p
  WHERE p.status = 'pending_deletion'
),
last_sweep AS (
  SELECT
    target_id AS user_id,
    action,
    details,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY created_at DESC) AS rn
  FROM public.admin_audit_logs
  WHERE action IN (
    'account.hard_delete_candidate',
    'account.hard_deleted',
    'account.hard_delete_failed',
    'account.hard_delete_skipped'
  )
)
SELECT
  c.user_id,
  c.org_id,
  c.deletion_requested_at,
  c.days_pending,
  c.deletion_reason,
  c.deletion_category,
  c.placeholder_email,
  c.is_platform_admin,
  c.has_active_pois,
  c.has_open_disputes,
  CASE
    WHEN c.is_platform_admin THEN 'blocked_platform_admin'
    WHEN c.has_active_pois THEN 'blocked_active_trades'
    WHEN c.has_open_disputes THEN 'blocked_open_disputes'
    WHEN c.days_pending < 30 THEN 'in_grace_period'
    ELSE 'eligible'
  END AS sweep_state,
  ls.action AS last_sweep_action,
  ls.created_at AS last_sweep_at,
  ls.details AS last_sweep_details
FROM candidates c
LEFT JOIN last_sweep ls ON ls.user_id = c.user_id AND ls.rn = 1;

REVOKE ALL ON public.account_hard_delete_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_hard_delete_status TO service_role;

COMMENT ON VIEW public.account_hard_delete_status IS
  'D-08: Operator visibility into pending_deletion accounts and sweep history. service_role only; read via admin edge functions.';