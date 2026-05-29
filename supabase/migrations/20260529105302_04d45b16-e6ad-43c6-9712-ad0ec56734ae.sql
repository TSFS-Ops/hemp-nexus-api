
-- =====================================================================
-- Batch 4: Enterprise Identity — SSO/SAML config shell + SCIM lifecycle
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. org_sso_configs
-- ---------------------------------------------------------------------
CREATE TABLE public.org_sso_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'saml',
  metadata_url text,
  metadata_xml_ref text,
  verified_domains text[] NOT NULL DEFAULT ARRAY[]::text[],
  entity_id text,
  acs_url text,
  certificate_status text NOT NULL DEFAULT 'none',
  supabase_sso_provider_id text,
  status text NOT NULL DEFAULT 'not_configured',
  last_tested_at timestamptz,
  last_test_result text,
  failure_reason text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_sso_configs_provider_chk
    CHECK (provider IN ('saml','oidc-placeholder')),
  CONSTRAINT org_sso_configs_cert_chk
    CHECK (certificate_status IN ('none','present','expiring','expired')),
  CONSTRAINT org_sso_configs_status_chk
    CHECK (status IN ('not_configured','pending_metadata','configured_not_connected','live','failed','disabled')),
  CONSTRAINT org_sso_configs_test_result_chk
    CHECK (last_test_result IS NULL OR last_test_result IN ('pass','fail'))
);

CREATE INDEX idx_org_sso_configs_status ON public.org_sso_configs(status);
CREATE INDEX idx_org_sso_configs_org_id ON public.org_sso_configs(org_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_sso_configs TO authenticated;
GRANT ALL ON public.org_sso_configs TO service_role;

ALTER TABLE public.org_sso_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage all SSO configs"
  ON public.org_sso_configs
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Org admins read own SSO config"
  ON public.org_sso_configs
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'org_admin'::public.app_role)
    AND org_id = (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "Org admins update own SSO config"
  ON public.org_sso_configs
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'org_admin'::public.app_role)
    AND org_id = (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'org_admin'::public.app_role)
    AND org_id = (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "Org admins insert own SSO config"
  ON public.org_sso_configs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'org_admin'::public.app_role)
    AND org_id = (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  );

-- updated_at trigger (reuse standard helper if exists, else create)
CREATE OR REPLACE FUNCTION public.tg_org_sso_configs_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER org_sso_configs_touch_updated_at
  BEFORE UPDATE ON public.org_sso_configs
  FOR EACH ROW EXECUTE FUNCTION public.tg_org_sso_configs_touch_updated_at();

-- Status-promotion guard: status can only become 'live' from a verified
-- connection-test path. We enforce that by requiring last_test_result='pass'
-- AND supabase_sso_provider_id IS NOT NULL whenever a row transitions to 'live'.
-- The dedicated `org-sso-test-connection` edge fn sets all three atomically
-- via service_role. Normal config updates that try to set status='live'
-- without satisfying these conditions are rejected at the DB level.
CREATE OR REPLACE FUNCTION public.tg_org_sso_configs_guard_live_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'live' THEN
    IF NEW.last_test_result IS DISTINCT FROM 'pass'
       OR NEW.supabase_sso_provider_id IS NULL
       OR NEW.last_tested_at IS NULL THEN
      RAISE EXCEPTION
        'SSO status cannot be set to live without a passing connection test (need last_test_result=pass, supabase_sso_provider_id, last_tested_at)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER org_sso_configs_guard_live_status
  BEFORE INSERT OR UPDATE ON public.org_sso_configs
  FOR EACH ROW EXECUTE FUNCTION public.tg_org_sso_configs_guard_live_status();

-- ---------------------------------------------------------------------
-- 2. org_scim_user_states
-- ---------------------------------------------------------------------
CREATE TABLE public.org_scim_user_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'invited',
  source text NOT NULL DEFAULT 'manual',
  external_id text,
  last_state_change_at timestamptz NOT NULL DEFAULT now(),
  last_state_change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_scim_user_states_state_chk
    CHECK (state IN ('invited','active','suspended','deprovisioned')),
  CONSTRAINT org_scim_user_states_source_chk
    CHECK (source IN ('manual','scim','sso_jit')),
  CONSTRAINT org_scim_user_states_org_user_uq UNIQUE (org_id, user_id)
);

CREATE INDEX idx_org_scim_user_states_org_id ON public.org_scim_user_states(org_id);
CREATE INDEX idx_org_scim_user_states_user_id ON public.org_scim_user_states(user_id);
CREATE INDEX idx_org_scim_user_states_state ON public.org_scim_user_states(state);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_scim_user_states TO authenticated;
GRANT ALL ON public.org_scim_user_states TO service_role;

ALTER TABLE public.org_scim_user_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage all SCIM states"
  ON public.org_scim_user_states
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Org admins read own org SCIM states"
  ON public.org_scim_user_states
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'org_admin'::public.app_role)
    AND org_id = (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "Org admins write own org SCIM states"
  ON public.org_scim_user_states
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'org_admin'::public.app_role)
    AND org_id = (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "Org admins update own org SCIM states"
  ON public.org_scim_user_states
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'org_admin'::public.app_role)
    AND org_id = (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'org_admin'::public.app_role)
    AND org_id = (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.tg_org_scim_user_states_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.last_state_change_at = now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER org_scim_user_states_touch_updated_at
  BEFORE UPDATE ON public.org_scim_user_states
  FOR EACH ROW EXECUTE FUNCTION public.tg_org_scim_user_states_touch_updated_at();
