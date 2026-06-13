
CREATE SEQUENCE IF NOT EXISTS public.facilitation_case_number_seq START 1;

CREATE TABLE public.facilitation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number text NOT NULL UNIQUE,
  requesting_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  requesting_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  trade_request_id uuid NOT NULL REFERENCES public.trade_requests(id) ON DELETE RESTRICT,
  poi_engagement_id uuid NULL REFERENCES public.poi_engagements(id) ON DELETE SET NULL,
  counterparty_legal_name text NOT NULL,
  counterparty_trading_name text NULL,
  counterparty_country text NOT NULL,
  counterparty_city text NULL,
  counterparty_website text NULL,
  counterparty_email text NULL,
  counterparty_phone text NULL,
  counterparty_contact_name text NULL,
  product_or_commodity text NOT NULL,
  role text NOT NULL CHECK (role IN ('buyer','seller')),
  estimated_value_amount numeric(20,2) NOT NULL CHECK (estimated_value_amount >= 0),
  estimated_value_currency text NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('low','normal','high','critical')),
  reason text NOT NULL,
  how_user_knows_counterparty text NOT NULL,
  how_user_knows_notes text NULL,
  permission_to_contact boolean NOT NULL,
  user_declaration_accepted boolean NOT NULL,
  user_declaration_accepted_at timestamptz NOT NULL DEFAULT now(),
  internal_status text NOT NULL DEFAULT 'new' CHECK (internal_status IN (
    'new','awaiting_assignment','admin_reviewing','more_information_needed',
    'compliance_review_required','blocked_by_compliance','duplicate_review',
    'ready_for_contact','contact_attempted','awaiting_counterparty_response',
    'counterparty_responded','counterparty_declined','ready_for_known_counterparty_poi',
    'converted_to_known_counterparty_poi','unable_to_proceed','cancelled_by_requester','closed'
  )),
  user_facing_status text NOT NULL DEFAULT 'request_received',
  case_owner_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  closing_reason text NULL,
  final_outcome text NULL CHECK (final_outcome IS NULL OR final_outcome IN (
    'converted_to_known_counterparty_poi','linked_to_existing_organisation',
    'new_counterparty_profile_created','more_information_not_provided',
    'counterparty_declined','unable_to_contact','blocked_by_compliance',
    'duplicate_case','cancelled_by_requester','outside_supported_scope',
    'closed_by_admin_decision'
  )),
  linked_organization_id uuid NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL
);

GRANT SELECT, INSERT, UPDATE ON public.facilitation_cases TO authenticated;
GRANT ALL ON public.facilitation_cases TO service_role;
GRANT USAGE ON SEQUENCE public.facilitation_case_number_seq TO service_role;

ALTER TABLE public.facilitation_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fc_select_own_org" ON public.facilitation_cases
FOR SELECT TO authenticated
USING (requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "fc_select_admin" ON public.facilitation_cases
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_admin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
  OR case_owner_id = auth.uid()
);

CREATE POLICY "fc_insert_requester" ON public.facilitation_cases
FOR INSERT TO authenticated
WITH CHECK (
  requesting_user_id = auth.uid()
  AND requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
);

CREATE INDEX idx_fc_org ON public.facilitation_cases(requesting_org_id);
CREATE INDEX idx_fc_owner ON public.facilitation_cases(case_owner_id);
CREATE INDEX idx_fc_status ON public.facilitation_cases(internal_status);
CREATE INDEX idx_fc_created ON public.facilitation_cases(created_at DESC);

CREATE OR REPLACE FUNCTION public.facilitation_cases_set_derived()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year text := to_char(now(), 'YYYY');
  v_seq bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.case_number IS NULL OR NEW.case_number = '' THEN
      v_seq := nextval('public.facilitation_case_number_seq');
      NEW.case_number := 'FAC-' || v_year || '-' || lpad(v_seq::text, 6, '0');
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.user_facing_status := CASE NEW.internal_status
    WHEN 'new' THEN 'request_received'
    WHEN 'awaiting_assignment' THEN 'request_received'
    WHEN 'admin_reviewing' THEN 'reviewing'
    WHEN 'more_information_needed' THEN 'more_information_needed'
    WHEN 'compliance_review_required' THEN 'under_internal_review'
    WHEN 'blocked_by_compliance' THEN 'unable_to_proceed'
    WHEN 'duplicate_review' THEN 'under_internal_review'
    WHEN 'ready_for_contact' THEN 'preparing_contact'
    WHEN 'contact_attempted' THEN 'contact_attempted'
    WHEN 'awaiting_counterparty_response' THEN 'waiting_for_response'
    WHEN 'counterparty_responded' THEN 'counterparty_responded'
    WHEN 'counterparty_declined' THEN 'counterparty_declined'
    WHEN 'ready_for_known_counterparty_poi' THEN 'ready_to_proceed'
    WHEN 'converted_to_known_counterparty_poi' THEN 'poi_started'
    WHEN 'unable_to_proceed' THEN 'unable_to_proceed'
    WHEN 'cancelled_by_requester' THEN 'cancelled'
    WHEN 'closed' THEN 'closed'
    ELSE 'request_received'
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER facilitation_cases_set_derived_trg
BEFORE INSERT OR UPDATE ON public.facilitation_cases
FOR EACH ROW EXECUTE FUNCTION public.facilitation_cases_set_derived();

CREATE TABLE public.facilitation_case_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NULL,
  size_bytes bigint NULL,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.facilitation_case_evidence TO authenticated;
GRANT ALL ON public.facilitation_case_evidence TO service_role;

ALTER TABLE public.facilitation_case_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fce_select_org_or_admin" ON public.facilitation_case_evidence
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id = case_id
      AND (
        fc.requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
        OR public.has_role(auth.uid(), 'platform_admin'::app_role)
        OR public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
        OR fc.case_owner_id = auth.uid()
      )
  )
);

CREATE POLICY "fce_insert_uploader" ON public.facilitation_case_evidence
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id = case_id
      AND (
        fc.requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
        OR public.has_role(auth.uid(), 'platform_admin'::app_role)
        OR public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
        OR fc.case_owner_id = auth.uid()
      )
  )
);

CREATE INDEX idx_fce_case ON public.facilitation_case_evidence(case_id);

CREATE TABLE public.facilitation_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  actor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action LIKE 'facilitation_case.%'),
  from_status text NULL,
  to_status text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.facilitation_case_events TO authenticated;
GRANT ALL ON public.facilitation_case_events TO service_role;

ALTER TABLE public.facilitation_case_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fcev_select_admin" ON public.facilitation_case_events
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_admin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id = case_id AND fc.case_owner_id = auth.uid()
  )
);

CREATE INDEX idx_fcev_case ON public.facilitation_case_events(case_id, created_at DESC);
