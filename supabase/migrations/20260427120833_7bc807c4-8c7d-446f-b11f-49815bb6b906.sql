CREATE TABLE public.match_counterparty_intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buyer','seller')),
  counterparty_name TEXT NOT NULL,
  website_url TEXT,
  linkedin_url TEXT,
  other_social_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  presence_confirmed BOOLEAN NOT NULL DEFAULT false,
  presence_confirmed_at TIMESTAMPTZ,
  presence_confirmed_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, side)
);

CREATE INDEX idx_mci_match ON public.match_counterparty_intel(match_id);
CREATE INDEX idx_mci_org ON public.match_counterparty_intel(org_id);

ALTER TABLE public.match_counterparty_intel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view counterparty intel"
ON public.match_counterparty_intel FOR SELECT TO authenticated
USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Org members can create counterparty intel"
ON public.match_counterparty_intel FOR INSERT TO authenticated
WITH CHECK (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Org members can update counterparty intel"
ON public.match_counterparty_intel FOR UPDATE TO authenticated
USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Platform admins can view all counterparty intel"
ON public.match_counterparty_intel FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'::app_role));

CREATE TRIGGER trg_mci_updated
BEFORE UPDATE ON public.match_counterparty_intel
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.operator_verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
  org_id UUID,
  subject_org_id UUID,
  subject_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('idv','org','both')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')),
  reason TEXT,
  reviewer_notes TEXT,
  raised_by UUID NOT NULL,
  assigned_to UUID,
  completed_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IN ('verified','rejected','inconclusive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ovr_status ON public.operator_verification_requests(status);
CREATE INDEX idx_ovr_match ON public.operator_verification_requests(match_id);
CREATE INDEX idx_ovr_subject_org ON public.operator_verification_requests(subject_org_id);

ALTER TABLE public.operator_verification_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view verification requests"
ON public.operator_verification_requests FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "Platform admins can create verification requests"
ON public.operator_verification_requests FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'platform_admin'::app_role));

CREATE POLICY "Platform admins can update verification requests"
ON public.operator_verification_requests FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'::app_role));

CREATE TRIGGER trg_ovr_updated
BEFORE UPDATE ON public.operator_verification_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


INSERT INTO public.admin_settings (key, value)
VALUES (
  'poi_pre_verification_policy',
  jsonb_build_object(
    'version', 1,
    'effective_from', now(),
    'rule', 'name_only_before_poi',
    'summary', 'No hard verification before POI. No paid API integrations before POI. Light public-source checks for the named counterparty are supported. Optional operator verification clip-on available where required. Hard verification (KYB/IDV/UBO) remains mandatory at WaD.',
    'set_by', 'product_owner_directive_2026_04_27'
  )
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();