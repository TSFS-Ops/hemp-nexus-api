-- Allow non-admin actors (counterparty self-serve, system/lifecycle) to write outreach log entries.
-- Without this, the immutable log cannot capture the counterparty's own accept/decline action,
-- nor scheduler-driven expiries. Admin actions remain fully attributed.

ALTER TABLE public.engagement_outreach_logs
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'admin';

ALTER TABLE public.engagement_outreach_logs
  DROP CONSTRAINT IF EXISTS engagement_outreach_logs_actor_type_check;

ALTER TABLE public.engagement_outreach_logs
  ADD CONSTRAINT engagement_outreach_logs_actor_type_check
  CHECK (actor_type IN ('admin', 'counterparty', 'system'));

-- Relax admin_user_id / admin_email so non-admin actors can be recorded.
-- Integrity is restored by a CHECK: admin entries MUST still have admin_user_id + admin_email.
ALTER TABLE public.engagement_outreach_logs
  ALTER COLUMN admin_user_id DROP NOT NULL,
  ALTER COLUMN admin_email DROP NOT NULL;

ALTER TABLE public.engagement_outreach_logs
  DROP CONSTRAINT IF EXISTS engagement_outreach_logs_admin_actor_required;

ALTER TABLE public.engagement_outreach_logs
  ADD CONSTRAINT engagement_outreach_logs_admin_actor_required
  CHECK (
    actor_type <> 'admin'
    OR (admin_user_id IS NOT NULL AND admin_email IS NOT NULL)
  );

-- Counterparty actors must have a user id to attribute the action (email may be unavailable under RLS).
ALTER TABLE public.engagement_outreach_logs
  DROP CONSTRAINT IF EXISTS engagement_outreach_logs_counterparty_actor_required;

ALTER TABLE public.engagement_outreach_logs
  ADD CONSTRAINT engagement_outreach_logs_counterparty_actor_required
  CHECK (
    actor_type <> 'counterparty'
    OR admin_user_id IS NOT NULL
  );

COMMENT ON COLUMN public.engagement_outreach_logs.actor_type IS
  'Who performed the action: admin (operator), counterparty (self-serve accept/decline), system (lifecycle scheduler).';
