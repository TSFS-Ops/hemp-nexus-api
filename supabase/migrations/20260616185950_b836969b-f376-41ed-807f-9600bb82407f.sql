
-- Batch 5: manual check + contact-attempt capture for facilitation cases.
-- No live integrations, no automation — these are admin-entered records only.

CREATE TABLE IF NOT EXISTS public.facilitation_case_registry_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL,
  provider_name TEXT NOT NULL,
  lookup_date DATE NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('clear','possible_match','no_match','unavailable','failed')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low','unknown')),
  source_reference TEXT,
  note TEXT,
  evidence_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fcrc_case ON public.facilitation_case_registry_checks(case_id, created_at DESC);

GRANT SELECT, INSERT ON public.facilitation_case_registry_checks TO authenticated;
GRANT ALL ON public.facilitation_case_registry_checks TO service_role;

ALTER TABLE public.facilitation_case_registry_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fcrc_select_admin_or_owner" ON public.facilitation_case_registry_checks
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_analyst')
    OR EXISTS (SELECT 1 FROM public.facilitation_cases fc WHERE fc.id = facilitation_case_registry_checks.case_id AND fc.case_owner_id = auth.uid())
  );

-- Sanctions / PEP screening results
CREATE TABLE IF NOT EXISTS public.facilitation_case_sanctions_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL,
  screening_date DATE NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('clear','possible_match','confirmed_match','unavailable','failed')),
  screening_source TEXT NOT NULL,
  matched_name TEXT,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical','unknown')),
  compliance_decision TEXT NOT NULL CHECK (compliance_decision IN ('no_issue','review_required','blocked','cleared_after_review')),
  note TEXT,
  evidence_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fcsc_case ON public.facilitation_case_sanctions_checks(case_id, created_at DESC);

GRANT SELECT, INSERT ON public.facilitation_case_sanctions_checks TO authenticated;
GRANT ALL ON public.facilitation_case_sanctions_checks TO service_role;

ALTER TABLE public.facilitation_case_sanctions_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fcsc_select_admin_or_owner" ON public.facilitation_case_sanctions_checks
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_analyst')
    OR EXISTS (SELECT 1 FROM public.facilitation_cases fc WHERE fc.id = facilitation_case_sanctions_checks.case_id AND fc.case_owner_id = auth.uid())
  );

-- Manual call / contact attempts
CREATE TABLE IF NOT EXISTS public.facilitation_case_contact_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('phone','email_outside_system','meeting','other')),
  contact_at TIMESTAMPTZ NOT NULL,
  recipient TEXT,
  contact_details_used TEXT,
  result TEXT NOT NULL CHECK (result IN ('no_answer','left_message','reached_counterparty','wrong_contact','declined','requested_more_information','other')),
  note TEXT,
  next_action_date DATE,
  evidence_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fcca_case ON public.facilitation_case_contact_attempts(case_id, created_at DESC);

GRANT SELECT, INSERT ON public.facilitation_case_contact_attempts TO authenticated;
GRANT ALL ON public.facilitation_case_contact_attempts TO service_role;

ALTER TABLE public.facilitation_case_contact_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fcca_select_admin_or_owner" ON public.facilitation_case_contact_attempts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_analyst')
    OR EXISTS (SELECT 1 FROM public.facilitation_cases fc WHERE fc.id = facilitation_case_contact_attempts.case_id AND fc.case_owner_id = auth.uid())
  );
