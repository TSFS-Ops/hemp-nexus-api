-- P011 — Counterparty Rating Methodology Visibility
CREATE TYPE public.evidence_rating_band AS ENUM (
  'limited_information','public_source_supported','admin_reviewed','verification_complete','flagged'
);
CREATE TYPE public.evidence_rating_freshness AS ENUM ('fresh','stale','error','never_calculated');
CREATE TYPE public.evidence_rating_override_reason AS ENUM (
  'evidence_corrected','false_positive','new_document_reviewed','expired_check_reviewed',
  'dispute_resolved','admin_block','methodology_exception','data_error'
);

CREATE TABLE public.counterparty_evidence_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  counterparty_id UUID NOT NULL,
  rating_band public.evidence_rating_band NOT NULL DEFAULT 'limited_information',
  methodology_version TEXT NOT NULL DEFAULT '1.0',
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  calculation_trigger TEXT NOT NULL DEFAULT 'initial',
  freshness_state public.evidence_rating_freshness NOT NULL DEFAULT 'fresh',
  supporting_factors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_inputs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  stale_inputs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  workflow_effect_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  has_admin_override BOOLEAN NOT NULL DEFAULT false,
  override_id UUID NULL,
  last_audit_event_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, counterparty_id)
);

CREATE INDEX idx_cer_org ON public.counterparty_evidence_ratings(organisation_id);
CREATE INDEX idx_cer_counterparty ON public.counterparty_evidence_ratings(counterparty_id);
CREATE INDEX idx_cer_band ON public.counterparty_evidence_ratings(rating_band);
CREATE INDEX idx_cer_freshness ON public.counterparty_evidence_ratings(freshness_state);

GRANT SELECT ON public.counterparty_evidence_ratings TO authenticated;
GRANT ALL ON public.counterparty_evidence_ratings TO service_role;
ALTER TABLE public.counterparty_evidence_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "evidence_ratings_read_org_members"
  ON public.counterparty_evidence_ratings FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.org_id = counterparty_evidence_ratings.organisation_id)
    OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  );

CREATE POLICY "evidence_ratings_write_admin_only"
  ON public.counterparty_evidence_ratings FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );

CREATE TABLE public.counterparty_rating_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  counterparty_id UUID NOT NULL,
  old_rating public.evidence_rating_band NOT NULL,
  override_rating public.evidence_rating_band NOT NULL,
  reason_code public.evidence_rating_override_reason NOT NULL,
  reason_text TEXT NOT NULL,
  evidence_document_id UUID NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by UUID NULL REFERENCES auth.users(id),
  removed_at TIMESTAMPTZ NULL,
  removal_reason TEXT NULL
);

CREATE INDEX idx_cro_org ON public.counterparty_rating_overrides(organisation_id);
CREATE INDEX idx_cro_counterparty ON public.counterparty_rating_overrides(counterparty_id);
CREATE INDEX idx_cro_active ON public.counterparty_rating_overrides(organisation_id, counterparty_id) WHERE removed_at IS NULL;

GRANT SELECT ON public.counterparty_rating_overrides TO authenticated;
GRANT ALL ON public.counterparty_rating_overrides TO service_role;
ALTER TABLE public.counterparty_rating_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rating_overrides_read_admin_compliance"
  ON public.counterparty_rating_overrides FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_analyst'::public.app_role)
  );

CREATE POLICY "rating_overrides_write_admin_only"
  ON public.counterparty_rating_overrides FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );

CREATE OR REPLACE FUNCTION public.validate_counterparty_rating_override()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF char_length(coalesce(NEW.reason_text, '')) < 30 THEN
    RAISE EXCEPTION 'reason_text must be at least 30 characters';
  END IF;
  IF NEW.expires_at IS NULL THEN
    RAISE EXCEPTION 'expires_at is required';
  END IF;
  IF NEW.reason_code <> 'admin_block'::public.evidence_rating_override_reason
     AND NEW.expires_at > now() + INTERVAL '90 days' THEN
    RAISE EXCEPTION 'override expiry must not exceed 90 days (except for admin_block)';
  END IF;
  IF NEW.override_rating = 'verification_complete'::public.evidence_rating_band THEN
    RAISE EXCEPTION 'override cannot set verification_complete; live checks must support it';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_counterparty_rating_override
  BEFORE INSERT OR UPDATE ON public.counterparty_rating_overrides
  FOR EACH ROW EXECUTE FUNCTION public.validate_counterparty_rating_override();

CREATE TRIGGER trg_cer_updated_at
  BEFORE UPDATE ON public.counterparty_evidence_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_cro_updated_at
  BEFORE UPDATE ON public.counterparty_rating_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();