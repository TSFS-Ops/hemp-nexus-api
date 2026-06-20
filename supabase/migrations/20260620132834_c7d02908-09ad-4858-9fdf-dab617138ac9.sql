
-- Batch 1 — Business Registry Foundation (M001 / M018 / M019)

-- ── M019 readiness state enum ───────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.registry_readiness_state AS ENUM (
    'not_started',
    'shell_ready',
    'test_data_ready',
    'provider_pending',
    'data_pending',
    'licence_pending',
    'admin_only',
    'client_demo_ready',
    'production_ready',
    'disabled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── M018 decision category / status enums ──────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.business_decision_category AS ENUM (
    'country',
    'data_source',
    'provider',
    'public_display',
    'api_output',
    'outreach_use',
    'commercial_use',
    'institutional_demo',
    'wording'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.business_decision_status AS ENUM (
    'proposed',
    'under_review',
    'approved',
    'rejected',
    'expired',
    'superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── registry_modules ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.registry_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code text NOT NULL UNIQUE,
  module_name text NOT NULL,
  category text NOT NULL,
  current_state public.registry_readiness_state NOT NULL DEFAULT 'not_started',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.registry_modules TO authenticated;
GRANT ALL ON public.registry_modules TO service_role;

ALTER TABLE public.registry_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "registry_modules_read_authenticated"
  ON public.registry_modules FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "registry_modules_write_platform_admin"
  ON public.registry_modules FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );

-- ── registry_readiness_states (append-only history) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.registry_readiness_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code text NOT NULL REFERENCES public.registry_modules(module_code) ON DELETE CASCADE,
  country_code text,
  provider text,
  surface text NOT NULL DEFAULT 'default',
  previous_state public.registry_readiness_state,
  new_state public.registry_readiness_state NOT NULL,
  reason text NOT NULL,
  evidence_url text,
  actor_id uuid,
  effective_at timestamptz NOT NULL DEFAULT now(),
  audit_event_name text NOT NULL DEFAULT 'registry_readiness_state_changed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registry_readiness_states_module_idx
  ON public.registry_readiness_states(module_code, effective_at DESC);

GRANT SELECT ON public.registry_readiness_states TO authenticated;
GRANT ALL ON public.registry_readiness_states TO service_role;

ALTER TABLE public.registry_readiness_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "registry_readiness_states_read_authenticated"
  ON public.registry_readiness_states FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "registry_readiness_states_insert_admin"
  ON public.registry_readiness_states FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );

-- ── business_decisions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category public.business_decision_category NOT NULL,
  decision_key text NOT NULL,
  status public.business_decision_status NOT NULL DEFAULT 'proposed',
  rationale text NOT NULL,
  scope_org_id uuid,
  is_public boolean NOT NULL DEFAULT false,
  effective_at timestamptz,
  review_at timestamptz,
  expiry_at timestamptz,
  owner_role text,
  approved_by uuid,
  superseded_by uuid REFERENCES public.business_decisions(id) ON DELETE SET NULL,
  evidence_url text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, decision_key)
);

CREATE INDEX IF NOT EXISTS business_decisions_category_status_idx
  ON public.business_decisions(category, status);

GRANT SELECT ON public.business_decisions TO authenticated;
GRANT ALL ON public.business_decisions TO service_role;

ALTER TABLE public.business_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_decisions_read_scope"
  ON public.business_decisions FOR SELECT
  TO authenticated
  USING (
    is_public = true
    OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "business_decisions_write_admin"
  ON public.business_decisions FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );

-- ── business_decision_events (append-only history) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.business_decision_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.business_decisions(id) ON DELETE CASCADE,
  previous_status public.business_decision_status,
  new_status public.business_decision_status NOT NULL,
  reason text NOT NULL,
  actor_id uuid,
  audit_event_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_decision_events_decision_idx
  ON public.business_decision_events(decision_id, created_at DESC);

GRANT SELECT ON public.business_decision_events TO authenticated;
GRANT ALL ON public.business_decision_events TO service_role;

ALTER TABLE public.business_decision_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_decision_events_read_scope"
  ON public.business_decision_events FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "business_decision_events_insert_admin"
  ON public.business_decision_events FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
  );

-- ── updated_at triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_registry_modules_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_registry_modules ON public.registry_modules;
CREATE TRIGGER trg_touch_registry_modules
  BEFORE UPDATE ON public.registry_modules
  FOR EACH ROW EXECUTE FUNCTION public.touch_registry_modules_updated_at();

CREATE OR REPLACE FUNCTION public.touch_business_decisions_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_business_decisions ON public.business_decisions;
CREATE TRIGGER trg_touch_business_decisions
  BEFORE UPDATE ON public.business_decisions
  FOR EACH ROW EXECUTE FUNCTION public.touch_business_decisions_updated_at();

-- ── Seed the 19 modules ─────────────────────────────────────────────────────
INSERT INTO public.registry_modules (module_code, module_name, category, current_state) VALUES
  ('M001','Business Registry shell','shell','shell_ready'),
  ('M002','Public Company Search','search','not_started'),
  ('M003','Company profile view','profile','not_started'),
  ('M004','Claim Your Company workflow','claim','not_started'),
  ('M005','Authority-to-act workflow','authority','not_started'),
  ('M006','Consent-based bank-detail capture','bank_detail','not_started'),
  ('M007','Verified Bank Detail status model','bank_detail','not_started'),
  ('M008','Institutional verified-profile API facade','api','not_started'),
  ('M009','Institutional payment-detail status API facade','api','not_started'),
  ('M010','Registry data provenance framework','provenance','not_started'),
  ('M011','Country coverage framework','coverage','not_started'),
  ('M012','Registry import-batch framework','import','not_started'),
  ('M013','AI outreach drafter','outreach','not_started'),
  ('M014','Human approval queue for outreach','outreach','not_started'),
  ('M015','Business Registry admin operations dashboard','admin','not_started'),
  ('M016','API client/admin management dashboard','api','not_started'),
  ('M017','Client-safe demo/readiness dashboard','readiness','not_started'),
  ('M018','Business decision register','governance','shell_ready'),
  ('M019','Module readiness / product truth layer','governance','shell_ready')
ON CONFLICT (module_code) DO NOTHING;

-- Seed initial readiness history rows for the three shell_ready modules
INSERT INTO public.registry_readiness_states (module_code, new_state, reason, audit_event_name)
SELECT m.module_code, 'shell_ready'::public.registry_readiness_state,
       'Initial seed — Batch 1 shell created',
       'registry_readiness_state_changed'
FROM public.registry_modules m
WHERE m.module_code IN ('M001','M018','M019')
ON CONFLICT DO NOTHING;
