-- Revenue notification audit table — append-only log of every emit attempt
-- from the three revenue-event hooks (poi mint, credits purchased, wad sealed).
CREATE TYPE public.revenue_notification_status AS ENUM ('sent', 'failed', 'skipped');

CREATE TABLE public.revenue_notification_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  reference_id text,
  idempotency_key text NOT NULL,
  recipient_email text NOT NULL,
  org_id uuid,
  org_name text,
  status public.revenue_notification_status NOT NULL,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rev_notif_audit_created_at ON public.revenue_notification_audit (created_at DESC);
CREATE INDEX idx_rev_notif_audit_event_type ON public.revenue_notification_audit (event_type);
CREATE INDEX idx_rev_notif_audit_reference ON public.revenue_notification_audit (reference_id);
CREATE INDEX idx_rev_notif_audit_idem ON public.revenue_notification_audit (idempotency_key);
CREATE INDEX idx_rev_notif_audit_org ON public.revenue_notification_audit (org_id);

ALTER TABLE public.revenue_notification_audit ENABLE ROW LEVEL SECURITY;

-- Read access: platform_admin or auditor only.
CREATE POLICY "Admins and auditors can view revenue notification audit"
ON public.revenue_notification_audit
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  OR public.has_role(auth.uid(), 'auditor'::public.app_role)
);

-- No client-side inserts/updates/deletes; service role bypasses RLS.
-- Append-only: deliberately no UPDATE or DELETE policy.

COMMENT ON TABLE public.revenue_notification_audit IS
  'Append-only audit log of every revenue notification email attempt sent to the Izenzo support desk. Populated by edge functions via service role.';
