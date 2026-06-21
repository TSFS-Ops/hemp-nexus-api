-- Batch 7 — Registry Search / Claim Rules Hardening.

-- ============================================================
-- New-company requests (Q10)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registry_new_company_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'new_company_request_started',
  company_name text NOT NULL,
  country_code text NOT NULL,
  registration_number text,
  legal_form text,
  source_or_evidence text,
  claimant_name text NOT NULL,
  claimant_email text NOT NULL,
  reason_for_adding text NOT NULL,
  duplicate_candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewer_id uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  provisional_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.registry_new_company_requests TO authenticated;
GRANT ALL ON public.registry_new_company_requests TO service_role;
ALTER TABLE public.registry_new_company_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ncr_owner_select"
  ON public.registry_new_company_requests FOR SELECT TO authenticated
  USING (requester_user_id = auth.uid()
    OR public.has_role(auth.uid(),'platform_admin')
    OR public.has_role(auth.uid(),'compliance_owner'));
CREATE POLICY "ncr_owner_insert"
  ON public.registry_new_company_requests FOR INSERT TO authenticated
  WITH CHECK (requester_user_id = auth.uid());
CREATE POLICY "ncr_admin_update"
  ON public.registry_new_company_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')
    OR public.has_role(auth.uid(),'compliance_owner'));

CREATE TABLE IF NOT EXISTS public.registry_new_company_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.registry_new_company_requests(id) ON DELETE CASCADE,
  audit_event_name text NOT NULL,
  previous_status text,
  new_status text,
  actor_id uuid,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_new_company_request_events TO authenticated;
GRANT ALL ON public.registry_new_company_request_events TO service_role;
ALTER TABLE public.registry_new_company_request_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ncre_admin_or_owner_select"
  ON public.registry_new_company_request_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')
    OR public.has_role(auth.uid(),'compliance_owner')
    OR EXISTS (
      SELECT 1 FROM public.registry_new_company_requests r
      WHERE r.id = request_id AND r.requester_user_id = auth.uid()
    ));

-- ============================================================
-- Company correction requests (Q11)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registry_company_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid REFERENCES public.registry_company_claims(id) ON DELETE SET NULL,
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_reference text NOT NULL,
  status text NOT NULL DEFAULT 'correction_requested',
  field_path text NOT NULL,
  current_value text,
  proposed_value text NOT NULL,
  rationale text NOT NULL,
  sensitive_field boolean NOT NULL DEFAULT false,
  reviewer_id uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  decision_reason text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.registry_company_correction_requests TO authenticated;
GRANT ALL ON public.registry_company_correction_requests TO service_role;
ALTER TABLE public.registry_company_correction_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ccr_owner_or_admin_select"
  ON public.registry_company_correction_requests FOR SELECT TO authenticated
  USING (requester_user_id = auth.uid()
    OR public.has_role(auth.uid(),'platform_admin')
    OR public.has_role(auth.uid(),'compliance_owner'));
CREATE POLICY "ccr_owner_insert"
  ON public.registry_company_correction_requests FOR INSERT TO authenticated
  WITH CHECK (requester_user_id = auth.uid());
CREATE POLICY "ccr_admin_update"
  ON public.registry_company_correction_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')
    OR public.has_role(auth.uid(),'compliance_owner'));

CREATE TABLE IF NOT EXISTS public.registry_company_correction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_id uuid NOT NULL REFERENCES public.registry_company_correction_requests(id) ON DELETE CASCADE,
  audit_event_name text NOT NULL,
  previous_status text,
  new_status text,
  actor_id uuid,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_company_correction_events TO authenticated;
GRANT ALL ON public.registry_company_correction_events TO service_role;
ALTER TABLE public.registry_company_correction_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ccre_admin_or_owner_select"
  ON public.registry_company_correction_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')
    OR public.has_role(auth.uid(),'compliance_owner')
    OR EXISTS (
      SELECT 1 FROM public.registry_company_correction_requests c
      WHERE c.id = correction_id AND c.requester_user_id = auth.uid()
    ));

-- ============================================================
-- Claim conflicts (Q6)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registry_claim_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_reference text NOT NULL,
  status text NOT NULL DEFAULT 'claim_conflict_detected',
  first_claim_id uuid REFERENCES public.registry_company_claims(id) ON DELETE SET NULL,
  second_claim_id uuid REFERENCES public.registry_company_claims(id) ON DELETE SET NULL,
  related_claim_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope_grants jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_summary text,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_claim_conflicts TO authenticated;
GRANT ALL ON public.registry_claim_conflicts TO service_role;
ALTER TABLE public.registry_claim_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rcc_admin_select"
  ON public.registry_claim_conflicts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')
    OR public.has_role(auth.uid(),'compliance_owner'));

CREATE TABLE IF NOT EXISTS public.registry_claim_conflict_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id uuid NOT NULL REFERENCES public.registry_claim_conflicts(id) ON DELETE CASCADE,
  audit_event_name text NOT NULL,
  previous_status text,
  new_status text,
  actor_id uuid,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_claim_conflict_events TO authenticated;
GRANT ALL ON public.registry_claim_conflict_events TO service_role;
ALTER TABLE public.registry_claim_conflict_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rcce_admin_select"
  ON public.registry_claim_conflict_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')
    OR public.has_role(auth.uid(),'compliance_owner'));

-- ============================================================
-- Claim interest events (pre-account funnel, Q2)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registry_claim_interest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token text NOT NULL,
  company_reference text,
  audit_event_name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_claim_interest_events TO authenticated;
GRANT INSERT ON public.registry_claim_interest_events TO anon;
GRANT ALL ON public.registry_claim_interest_events TO service_role;
ALTER TABLE public.registry_claim_interest_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rcie_anon_insert"
  ON public.registry_claim_interest_events FOR INSERT TO anon
  WITH CHECK (true);
CREATE POLICY "rcie_authn_insert"
  ON public.registry_claim_interest_events FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "rcie_admin_select"
  ON public.registry_claim_interest_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin')
    OR public.has_role(auth.uid(),'compliance_owner'));

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at_b7()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_b7_ncr_updated') THEN
    CREATE TRIGGER trg_b7_ncr_updated BEFORE UPDATE ON public.registry_new_company_requests
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_b7();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_b7_ccr_updated') THEN
    CREATE TRIGGER trg_b7_ccr_updated BEFORE UPDATE ON public.registry_company_correction_requests
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_b7();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_b7_rcc_updated') THEN
    CREATE TRIGGER trg_b7_rcc_updated BEFORE UPDATE ON public.registry_claim_conflicts
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_b7();
  END IF;
END $$;