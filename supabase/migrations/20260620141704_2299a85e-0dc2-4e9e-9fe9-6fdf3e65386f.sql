
-- Batch 3 — M004 Claim Your Company workflow tables.

-- =========================================================
-- 1. registry_company_claims
-- =========================================================
CREATE TABLE public.registry_company_claims (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  claimant_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_reference TEXT NOT NULL,
  company_name TEXT NOT NULL,
  registration_number TEXT,
  country_code TEXT NOT NULL,
  claimant_name TEXT NOT NULL,
  claimant_email TEXT NOT NULL,
  claimant_role TEXT NOT NULL,
  company_relationship TEXT NOT NULL,
  company_email_domain TEXT,
  declaration_of_authority BOOLEAN NOT NULL DEFAULT FALSE,
  consent_to_contact BOOLEAN NOT NULL DEFAULT FALSE,
  consent_to_process_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'claim_started',
  internal_notes TEXT,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_company_claims_claimant ON public.registry_company_claims(claimant_user_id);
CREATE INDEX idx_registry_company_claims_company_ref ON public.registry_company_claims(company_reference);
CREATE INDEX idx_registry_company_claims_status ON public.registry_company_claims(status);

GRANT SELECT, INSERT, UPDATE ON public.registry_company_claims TO authenticated;
GRANT ALL ON public.registry_company_claims TO service_role;
ALTER TABLE public.registry_company_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claimant can see own claim"
  ON public.registry_company_claims FOR SELECT TO authenticated
  USING (claimant_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner'));

CREATE POLICY "claimant can insert own claim"
  ON public.registry_company_claims FOR INSERT TO authenticated
  WITH CHECK (claimant_user_id = auth.uid());

CREATE POLICY "claimant can update own non-status fields"
  ON public.registry_company_claims FOR UPDATE TO authenticated
  USING (claimant_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner'))
  WITH CHECK (claimant_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner'));

-- Block direct status mutations from clients - status only changes via the
-- registry-company-claim edge function (service_role bypasses RLS).
CREATE OR REPLACE FUNCTION public.registry_company_claims_block_status_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'claim_status_mutation_forbidden_via_table';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_registry_company_claims_block_status
  BEFORE UPDATE ON public.registry_company_claims
  FOR EACH ROW EXECUTE FUNCTION public.registry_company_claims_block_status_mutation();

CREATE TRIGGER trg_registry_company_claims_updated_at
  BEFORE UPDATE ON public.registry_company_claims
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 2. registry_company_claim_evidence (METADATA ONLY)
-- =========================================================
CREATE TABLE public.registry_company_claim_evidence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES public.registry_company_claims(id) ON DELETE CASCADE,
  evidence_kind TEXT NOT NULL,
  description TEXT NOT NULL,
  external_reference TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_company_claim_evidence_claim ON public.registry_company_claim_evidence(claim_id);

GRANT SELECT, INSERT ON public.registry_company_claim_evidence TO authenticated;
GRANT ALL ON public.registry_company_claim_evidence TO service_role;
ALTER TABLE public.registry_company_claim_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claimant can see own claim evidence"
  ON public.registry_company_claim_evidence FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.registry_company_claims c WHERE c.id = claim_id
    AND (c.claimant_user_id = auth.uid()
      OR public.has_role(auth.uid(), 'platform_admin')
      OR public.has_role(auth.uid(), 'compliance_owner'))));

CREATE POLICY "claimant can add own claim evidence"
  ON public.registry_company_claim_evidence FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.registry_company_claims c
      WHERE c.id = claim_id AND c.claimant_user_id = auth.uid()));

-- =========================================================
-- 3. registry_company_claim_events (audit)
-- =========================================================
CREATE TABLE public.registry_company_claim_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES public.registry_company_claims(id) ON DELETE CASCADE,
  audit_event_name TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_company_claim_events_claim ON public.registry_company_claim_events(claim_id);
CREATE INDEX idx_registry_company_claim_events_name ON public.registry_company_claim_events(audit_event_name);

GRANT SELECT ON public.registry_company_claim_events TO authenticated;
GRANT ALL ON public.registry_company_claim_events TO service_role;
ALTER TABLE public.registry_company_claim_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claimant or admin can read claim events"
  ON public.registry_company_claim_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.registry_company_claims c WHERE c.id = claim_id
    AND (c.claimant_user_id = auth.uid()
      OR public.has_role(auth.uid(), 'platform_admin')
      OR public.has_role(auth.uid(), 'compliance_owner'))));

-- =========================================================
-- 4. registry_company_claim_reviews
-- =========================================================
CREATE TABLE public.registry_company_claim_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES public.registry_company_claims(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id),
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL,
  acknowledged_not_verification BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_company_claim_reviews_claim ON public.registry_company_claim_reviews(claim_id);

GRANT SELECT ON public.registry_company_claim_reviews TO authenticated;
GRANT ALL ON public.registry_company_claim_reviews TO service_role;
ALTER TABLE public.registry_company_claim_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can read claim reviews"
  ON public.registry_company_claim_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
    OR EXISTS (SELECT 1 FROM public.registry_company_claims c
      WHERE c.id = claim_id AND c.claimant_user_id = auth.uid()));
