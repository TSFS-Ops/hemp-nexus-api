
CREATE TYPE public.facilitation_org_merge_status AS ENUM (
  'eligibility_checked', 'blocked', 'confirmed', 'completed', 'cancelled'
);

CREATE TABLE public.facilitation_organisation_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facilitation_case_id uuid NULL REFERENCES public.facilitation_cases(id) ON DELETE SET NULL,
  source_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  target_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  status public.facilitation_org_merge_status NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligibility_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_handling jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NULL,
  requested_by uuid NULL,
  confirmed_by uuid NULL,
  confirmed_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facilitation_org_merge_no_self CHECK (source_org_id <> target_org_id)
);

CREATE UNIQUE INDEX facilitation_organisation_merges_active_source_uniq
  ON public.facilitation_organisation_merges (source_org_id)
  WHERE status IN ('confirmed','completed');

CREATE INDEX facilitation_organisation_merges_target_idx
  ON public.facilitation_organisation_merges (target_org_id);
CREATE INDEX facilitation_organisation_merges_case_idx
  ON public.facilitation_organisation_merges (facilitation_case_id);

GRANT SELECT ON public.facilitation_organisation_merges TO authenticated;
GRANT ALL ON public.facilitation_organisation_merges TO service_role;

ALTER TABLE public.facilitation_organisation_merges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins and compliance analysts can read merges"
  ON public.facilitation_organisation_merges
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_analyst')
  );

CREATE OR REPLACE FUNCTION public.facilitation_organisation_merges_set_updated()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_facilitation_organisation_merges_updated
BEFORE UPDATE ON public.facilitation_organisation_merges
FOR EACH ROW EXECUTE FUNCTION public.facilitation_organisation_merges_set_updated();

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS merged_into_org_id uuid NULL
    REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS merged_by_merge_id uuid NULL
    REFERENCES public.facilitation_organisation_merges(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organizations_merged_into_idx
  ON public.organizations (merged_into_org_id)
  WHERE merged_into_org_id IS NOT NULL;
