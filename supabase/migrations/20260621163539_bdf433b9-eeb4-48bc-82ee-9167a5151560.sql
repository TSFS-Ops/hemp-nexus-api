
-- Extend registry_authority_requests
ALTER TABLE public.registry_authority_requests
  ADD COLUMN IF NOT EXISTS requested_scopes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_sensitive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS two_person_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

-- Extend registry_authority_evidence
ALTER TABLE public.registry_authority_evidence
  ADD COLUMN IF NOT EXISTS evidence_category text NOT NULL DEFAULT 'other_supporting_evidence',
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'metadata_only',
  ADD COLUMN IF NOT EXISTS scope_code text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS expiry_at timestamptz;

-- registry_authority_request_scopes
CREATE TABLE IF NOT EXISTS public.registry_authority_request_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_request_id uuid NOT NULL REFERENCES public.registry_authority_requests(id) ON DELETE CASCADE,
  scope_code text NOT NULL,
  is_sensitive boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'requested',
  default_expiry_days integer NOT NULL DEFAULT 90,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (authority_request_id, scope_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_authority_request_scopes TO authenticated;
GRANT ALL ON public.registry_authority_request_scopes TO service_role;
ALTER TABLE public.registry_authority_request_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rar_scopes_owner_read" ON public.registry_authority_request_scopes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.registry_authority_requests r WHERE r.id = authority_request_id AND r.requester_user_id = auth.uid()));
CREATE POLICY "rar_scopes_admin_read" ON public.registry_authority_request_scopes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));
CREATE POLICY "rar_scopes_admin_write" ON public.registry_authority_request_scopes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- registry_authority_scope_decisions
CREATE TABLE IF NOT EXISTS public.registry_authority_scope_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_request_id uuid NOT NULL REFERENCES public.registry_authority_requests(id) ON DELETE CASCADE,
  scope_code text NOT NULL,
  decision text NOT NULL,
  reviewer_id uuid NOT NULL,
  reviewer_role text NOT NULL,
  rationale text,
  evidence_basis text,
  expiry_at timestamptz,
  acknowledged_not_company_verification boolean NOT NULL DEFAULT false,
  acknowledged_not_bank_verification boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_authority_scope_decisions TO authenticated;
GRANT ALL ON public.registry_authority_scope_decisions TO service_role;
ALTER TABLE public.registry_authority_scope_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rasd_owner_read" ON public.registry_authority_scope_decisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.registry_authority_requests r WHERE r.id = authority_request_id AND r.requester_user_id = auth.uid()));
CREATE POLICY "rasd_admin_all" ON public.registry_authority_scope_decisions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- registry_authority_notes (admin-only)
CREATE TABLE IF NOT EXISTS public.registry_authority_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_request_id uuid NOT NULL REFERENCES public.registry_authority_requests(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_authority_notes TO authenticated;
GRANT ALL ON public.registry_authority_notes TO service_role;
ALTER TABLE public.registry_authority_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ran_admin_all" ON public.registry_authority_notes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- registry_authority_assignments
CREATE TABLE IF NOT EXISTS public.registry_authority_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_request_id uuid NOT NULL REFERENCES public.registry_authority_requests(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.registry_authority_assignments TO authenticated;
GRANT ALL ON public.registry_authority_assignments TO service_role;
ALTER TABLE public.registry_authority_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "raa_admin_all" ON public.registry_authority_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- registry_authority_status_notifications (in-app, log-only)
CREATE TABLE IF NOT EXISTS public.registry_authority_status_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_request_id uuid NOT NULL REFERENCES public.registry_authority_requests(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL,
  event_name text NOT NULL,
  body text NOT NULL,
  sent_externally boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_authority_status_notifications TO authenticated;
GRANT ALL ON public.registry_authority_status_notifications TO service_role;
ALTER TABLE public.registry_authority_status_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rasn_owner_read" ON public.registry_authority_status_notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());
CREATE POLICY "rasn_admin_all" ON public.registry_authority_status_notifications FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- registry_active_authorities (derived cache)
CREATE TABLE IF NOT EXISTS public.registry_active_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_request_id uuid NOT NULL REFERENCES public.registry_authority_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  company_reference text NOT NULL,
  scope_code text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  approved_at timestamptz NOT NULL DEFAULT now(),
  expiry_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_reference, scope_code)
);
GRANT SELECT ON public.registry_active_authorities TO authenticated;
GRANT ALL ON public.registry_active_authorities TO service_role;
ALTER TABLE public.registry_active_authorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "raa_active_owner_read" ON public.registry_active_authorities FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "raa_active_admin_read" ON public.registry_active_authorities FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));

-- registry_authority_disputes
CREATE TABLE IF NOT EXISTS public.registry_authority_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_request_id uuid NOT NULL REFERENCES public.registry_authority_requests(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.registry_authority_disputes TO authenticated;
GRANT ALL ON public.registry_authority_disputes TO service_role;
ALTER TABLE public.registry_authority_disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rad_admin_all" ON public.registry_authority_disputes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner'));
CREATE POLICY "rad_owner_read" ON public.registry_authority_disputes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.registry_authority_requests r WHERE r.id = authority_request_id AND r.requester_user_id = auth.uid()));

-- Tighten authority_evidence: ensure requester can read their own; admin/compliance can read all.
-- (existing policies remain; this is additive.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='registry_authority_evidence' AND policyname='rae_owner_read_b12') THEN
    CREATE POLICY "rae_owner_read_b12" ON public.registry_authority_evidence FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.registry_authority_requests r WHERE r.id = authority_request_id AND r.requester_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='registry_authority_evidence' AND policyname='rae_owner_insert_b12') THEN
    CREATE POLICY "rae_owner_insert_b12" ON public.registry_authority_evidence FOR INSERT TO authenticated
      WITH CHECK (
        uploaded_by = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.registry_authority_requests r
          WHERE r.id = authority_request_id
            AND r.requester_user_id = auth.uid()
            AND r.status NOT IN ('approved','rejected','revoked','expired','cancelled','withdrawn')
        )
      );
  END IF;
END $$;
