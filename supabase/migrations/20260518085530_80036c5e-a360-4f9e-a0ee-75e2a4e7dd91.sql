-- MT-009 Phase 1: controlled named contact records
CREATE TABLE IF NOT EXISTS public.match_named_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('buyer','seller')),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  assigned_by_user_id uuid NOT NULL REFERENCES auth.users(id),
  assigned_by_role text NOT NULL CHECK (assigned_by_role IN ('org_admin_self_service','platform_admin_override')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','replaced','revoked')),
  replaced_by_id uuid NULL REFERENCES public.match_named_contacts(id),
  revoked_at timestamptz NULL,
  revoked_by_user_id uuid NULL REFERENCES auth.users(id),
  revoked_reason text NULL,
  converted_user_id uuid NULL REFERENCES auth.users(id),
  converted_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- One active named contact per (match, side)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mnc_one_active_per_side
  ON public.match_named_contacts (match_id, side)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_mnc_match_side_status
  ON public.match_named_contacts (match_id, side, status);

CREATE INDEX IF NOT EXISTS idx_mnc_org_status
  ON public.match_named_contacts (org_id, status);

CREATE INDEX IF NOT EXISTS idx_mnc_email_org_lower
  ON public.match_named_contacts (lower(contact_email), org_id);

ALTER TABLE public.match_named_contacts ENABLE ROW LEVEL SECURITY;

-- SELECT: members of the org can read
CREATE POLICY "Org members can view their named contacts"
  ON public.match_named_contacts
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT profiles.org_id FROM public.profiles
      WHERE profiles.id = auth.uid()
    )
  );

-- SELECT: platform admins can read all
CREATE POLICY "Platform admins can view all named contacts"
  ON public.match_named_contacts
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- SELECT: service role full read
CREATE POLICY "Service role can read named contacts"
  ON public.match_named_contacts
  FOR SELECT
  TO service_role
  USING (true);

-- WRITE: service role only (edge functions). No INSERT/UPDATE/DELETE policy for
-- authenticated users in Phase 1 — assignment UI is not built yet.
CREATE POLICY "Service role can write named contacts"
  ON public.match_named_contacts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.match_named_contacts IS
  'MT-009 Phase 1: controlled named contact records. A side of a match is satisfied for the named-contact requirement when either matches.{side}_authorised_user_id is set OR an active row exists here. Phase 1 is detection-only — no progression guard, no email/invite is sent on insert.';
