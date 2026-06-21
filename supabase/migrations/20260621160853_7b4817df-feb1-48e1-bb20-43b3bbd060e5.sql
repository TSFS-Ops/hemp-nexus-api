
-- Batch 11 — extend existing claim & evidence tables
ALTER TABLE public.registry_company_claims
  ADD COLUMN IF NOT EXISTS claimant_type TEXT,
  ADD COLUMN IF NOT EXISTS company_legal_form TEXT,
  ADD COLUMN IF NOT EXISTS is_professional_representative BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_reviewer_user_id UUID,
  ADD COLUMN IF NOT EXISTS evidence_completeness JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conflict_id UUID,
  ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'claim_started',
  ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS resubmission_allowed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.registry_company_claim_evidence
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS evidence_state TEXT NOT NULL DEFAULT 'metadata_only',
  ADD COLUMN IF NOT EXISTS sensitive BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS document_name TEXT,
  ADD COLUMN IF NOT EXISTS issuing_authority TEXT,
  ADD COLUMN IF NOT EXISTS issue_date DATE,
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS reviewer_user_id UUID,
  ADD COLUMN IF NOT EXISTS review_notes TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS provenance_link TEXT,
  ADD COLUMN IF NOT EXISTS claimant_statement TEXT,
  ADD COLUMN IF NOT EXISTS file_path TEXT;

-- Review events
CREATE TABLE IF NOT EXISTS public.registry_company_claim_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.registry_company_claims(id) ON DELETE CASCADE,
  reviewer_user_id UUID,
  reviewer_role TEXT,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  evidence_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_company_claim_review_events TO authenticated;
GRANT ALL ON public.registry_company_claim_review_events TO service_role;
ALTER TABLE public.registry_company_claim_review_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY rccre_admin_read ON public.registry_company_claim_review_events
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
  );
CREATE POLICY rccre_service_all ON public.registry_company_claim_review_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Internal admin notes
CREATE TABLE IF NOT EXISTS public.registry_company_claim_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.registry_company_claims(id) ON DELETE CASCADE,
  author_user_id UUID,
  author_role TEXT,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_company_claim_notes TO authenticated;
GRANT ALL ON public.registry_company_claim_notes TO service_role;
ALTER TABLE public.registry_company_claim_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY rccn_admin_read ON public.registry_company_claim_notes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
  );
CREATE POLICY rccn_service_all ON public.registry_company_claim_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Reviewer assignments
CREATE TABLE IF NOT EXISTS public.registry_company_claim_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.registry_company_claims(id) ON DELETE CASCADE,
  assigned_user_id UUID,
  assigned_by_user_id UUID,
  assigned_role TEXT,
  assignment_type TEXT NOT NULL DEFAULT 'reviewer',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unassigned_at TIMESTAMPTZ
);
GRANT SELECT ON public.registry_company_claim_assignments TO authenticated;
GRANT ALL ON public.registry_company_claim_assignments TO service_role;
ALTER TABLE public.registry_company_claim_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY rcca_admin_read ON public.registry_company_claim_assignments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
    OR assigned_user_id = auth.uid()
  );
CREATE POLICY rcca_service_all ON public.registry_company_claim_assignments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Status notification LOG (no external send)
CREATE TABLE IF NOT EXISTS public.registry_company_claim_status_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.registry_company_claims(id) ON DELETE CASCADE,
  recipient_user_id UUID,
  channel TEXT NOT NULL DEFAULT 'in_app',
  audit_event_name TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  delivery_state TEXT NOT NULL DEFAULT 'logged_only',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_company_claim_status_notifications TO authenticated;
GRANT ALL ON public.registry_company_claim_status_notifications TO service_role;
ALTER TABLE public.registry_company_claim_status_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY rccsn_own_or_admin ON public.registry_company_claim_status_notifications
  FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
  );
CREATE POLICY rccsn_service_all ON public.registry_company_claim_status_notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_rccre_claim ON public.registry_company_claim_review_events(claim_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rccn_claim ON public.registry_company_claim_notes(claim_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rcca_claim_active ON public.registry_company_claim_assignments(claim_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_rccsn_claim ON public.registry_company_claim_status_notifications(claim_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rcc_workflow_status ON public.registry_company_claims(workflow_status);
CREATE INDEX IF NOT EXISTS idx_rcc_assigned ON public.registry_company_claims(assigned_reviewer_user_id) WHERE assigned_reviewer_user_id IS NOT NULL;
