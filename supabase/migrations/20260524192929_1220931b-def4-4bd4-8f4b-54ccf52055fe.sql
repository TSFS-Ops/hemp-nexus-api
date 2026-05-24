-- COMP-002 / COMP-012 Phase 2A — compliance freshness gates

-- 1. compliance_holds table
CREATE TABLE IF NOT EXISTS public.compliance_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_id uuid REFERENCES public.entities(id),
  hold_type text NOT NULL,
  reason text NOT NULL,
  source_check_id uuid,
  source_check_type text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid,
  released_at timestamptz,
  released_by uuid,
  release_reason text,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_holds_hold_type_check CHECK (hold_type IN (
    'sanctions_rescreen_required',
    'compliance_hold_sanctions_rescreen',
    'compliance_hold_sanctions_potential_match',
    'verification_refresh_required',
    'compliance_hold_verification_refresh',
    'compliance_hold_verification_failed'
  )),
  CONSTRAINT compliance_holds_status_check CHECK (status IN ('active','released','closed')),
  CONSTRAINT compliance_holds_source_type_check CHECK (
    source_check_type IS NULL OR source_check_type IN ('screening_run','screening_result','compliance_case','ubo_link','manual')
  )
);

CREATE INDEX IF NOT EXISTS idx_compliance_holds_org_active
  ON public.compliance_holds (org_id, status);
CREATE INDEX IF NOT EXISTS idx_compliance_holds_entity_active
  ON public.compliance_holds (entity_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_holds_active
  ON public.compliance_holds (org_id, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), hold_type)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.tg_compliance_holds_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compliance_holds_touch ON public.compliance_holds;
CREATE TRIGGER trg_compliance_holds_touch
  BEFORE UPDATE ON public.compliance_holds
  FOR EACH ROW EXECUTE FUNCTION public.tg_compliance_holds_touch_updated_at();

ALTER TABLE public.compliance_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages compliance_holds" ON public.compliance_holds;
CREATE POLICY "Service role manages compliance_holds"
  ON public.compliance_holds
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS "Platform admins read all compliance_holds" ON public.compliance_holds;
CREATE POLICY "Platform admins read all compliance_holds"
  ON public.compliance_holds
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'platform_admin'::app_role));

DROP POLICY IF EXISTS "Org members read own compliance_holds" ON public.compliance_holds;
CREATE POLICY "Org members read own compliance_holds"
  ON public.compliance_holds
  FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- 2. Extend operator_verification_requests for compliance queue use
ALTER TABLE public.operator_verification_requests
  ADD COLUMN IF NOT EXISTS compliance_hold_id uuid REFERENCES public.compliance_holds(id) ON DELETE SET NULL;

ALTER TABLE public.operator_verification_requests
  ALTER COLUMN raised_by DROP NOT NULL;

ALTER TABLE public.operator_verification_requests
  DROP CONSTRAINT IF EXISTS operator_verification_requests_kind_check;
ALTER TABLE public.operator_verification_requests
  ADD CONSTRAINT operator_verification_requests_kind_check
  CHECK (kind = ANY (ARRAY[
    'idv','org','both',
    'sanctions_rescreen','sanctions_potential_match',
    'verification_refresh','verification_failed'
  ]));

CREATE INDEX IF NOT EXISTS idx_ovr_compliance_hold
  ON public.operator_verification_requests (compliance_hold_id)
  WHERE compliance_hold_id IS NOT NULL;
