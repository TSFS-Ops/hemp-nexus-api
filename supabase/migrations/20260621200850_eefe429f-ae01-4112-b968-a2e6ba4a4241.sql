
-- Batch 15 — Institutional API hardening (backend Phase 1)

-- 1. Extend registry_api_clients (additive, no rename)
ALTER TABLE public.registry_api_clients
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS client_type text,
  ADD COLUMN IF NOT EXISTS contact_owner text,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS allowed_use_cases text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS allowed_countries text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS ip_allowlist text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS rate_limit_profile text,
  ADD COLUMN IF NOT EXISTS usage_limit_profile text,
  ADD COLUMN IF NOT EXISTS billing_usage_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_acknowledged_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS review_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS revoked_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registry_api_clients_mode_chk') THEN
    ALTER TABLE public.registry_api_clients
      ADD CONSTRAINT registry_api_clients_mode_chk
      CHECK (mode IN ('disabled','sandbox','demo','limited_production','production'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registry_api_clients_lifecycle_chk') THEN
    ALTER TABLE public.registry_api_clients
      ADD CONSTRAINT registry_api_clients_lifecycle_chk
      CHECK (lifecycle_status IN ('draft','pending_approval','sandbox_active','demo_active','production_pending','production_active','suspended','revoked','expired','disabled'));
  END IF;
END $$;

-- 2. Extend registry_api_keys with key_type/label/rotation
ALTER TABLE public.registry_api_keys
  ADD COLUMN IF NOT EXISTS key_type text NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS last_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS rotation_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registry_api_keys_key_type_chk') THEN
    ALTER TABLE public.registry_api_keys
      ADD CONSTRAINT registry_api_keys_key_type_chk
      CHECK (key_type IN ('sandbox','production'));
  END IF;
END $$;

-- Forbidden scope tokens, used by CHECK on scopes table
CREATE OR REPLACE FUNCTION public.registry_api_scope_is_forbidden(_scope text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _scope = ANY (ARRAY[
    'registry.bank.raw.read',
    'registry.bank.unmasked.read',
    'registry.personal_contact.raw.read',
    'registry.evidence.raw.read'
  ]::text[])
$$;

-- 3. registry_api_client_scopes
CREATE TABLE IF NOT EXISTS public.registry_api_client_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.registry_api_clients(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, scope_key),
  CONSTRAINT registry_api_client_scopes_not_forbidden CHECK (NOT public.registry_api_scope_is_forbidden(scope_key))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_api_client_scopes TO authenticated;
GRANT ALL ON public.registry_api_client_scopes TO service_role;
ALTER TABLE public.registry_api_client_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b15 scopes admin read" ON public.registry_api_client_scopes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));
CREATE POLICY "b15 scopes admin write" ON public.registry_api_client_scopes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 4. registry_api_client_countries
CREATE TABLE IF NOT EXISTS public.registry_api_client_countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.registry_api_clients(id) ON DELETE CASCADE,
  country_code text NOT NULL CHECK (length(country_code)=2 AND country_code = upper(country_code)),
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, country_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_api_client_countries TO authenticated;
GRANT ALL ON public.registry_api_client_countries TO service_role;
ALTER TABLE public.registry_api_client_countries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b15 countries admin read" ON public.registry_api_client_countries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));
CREATE POLICY "b15 countries admin write" ON public.registry_api_client_countries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 5. registry_api_client_use_cases
CREATE TABLE IF NOT EXISTS public.registry_api_client_use_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.registry_api_clients(id) ON DELETE CASCADE,
  use_case_key text NOT NULL,
  description text,
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, use_case_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_api_client_use_cases TO authenticated;
GRANT ALL ON public.registry_api_client_use_cases TO service_role;
ALTER TABLE public.registry_api_client_use_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b15 use_cases admin read" ON public.registry_api_client_use_cases FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));
CREATE POLICY "b15 use_cases admin write" ON public.registry_api_client_use_cases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 6. registry_api_rate_limit_profiles
CREATE TABLE IF NOT EXISTS public.registry_api_rate_limit_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text UNIQUE NOT NULL,
  per_minute integer NOT NULL DEFAULT 30,
  per_day integer NOT NULL DEFAULT 1000,
  per_month integer NOT NULL DEFAULT 25000,
  per_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_api_rate_limit_profiles TO authenticated;
GRANT ALL ON public.registry_api_rate_limit_profiles TO service_role;
ALTER TABLE public.registry_api_rate_limit_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b15 rl profiles admin read" ON public.registry_api_rate_limit_profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));
CREATE POLICY "b15 rl profiles admin write" ON public.registry_api_rate_limit_profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role));

-- Seed conservative defaults
INSERT INTO public.registry_api_rate_limit_profiles (profile_key, per_minute, per_day, per_month, description)
VALUES
  ('conservative_sandbox', 10, 200, 5000, 'Sandbox default — conservative.'),
  ('conservative_demo', 10, 200, 5000, 'Demo default — conservative.'),
  ('conservative_production', 30, 2000, 50000, 'Production default — conservative.')
ON CONFLICT (profile_key) DO NOTHING;

-- 7. registry_api_usage_events (per-request log; no payloads)
CREATE TABLE IF NOT EXISTS public.registry_api_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  client_id uuid REFERENCES public.registry_api_clients(id) ON DELETE SET NULL,
  key_id uuid REFERENCES public.registry_api_keys(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  scope text,
  mode text,
  country text,
  identifier_type text,
  result_state text,
  usable boolean NOT NULL DEFAULT false,
  status_code integer,
  ip_hash text,
  user_agent text,
  audit_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_b15_usage_client_time ON public.registry_api_usage_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b15_usage_request ON public.registry_api_usage_events (request_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_api_usage_events TO authenticated;
GRANT ALL ON public.registry_api_usage_events TO service_role;
ALTER TABLE public.registry_api_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b15 usage admin read" ON public.registry_api_usage_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 8. registry_api_blocked_events
CREATE TABLE IF NOT EXISTS public.registry_api_blocked_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  client_id uuid REFERENCES public.registry_api_clients(id) ON DELETE SET NULL,
  key_id uuid REFERENCES public.registry_api_keys(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  scope text,
  mode text,
  country text,
  block_reason text NOT NULL,
  block_category text NOT NULL,
  status_code integer NOT NULL,
  ip_hash text,
  user_agent text,
  audit_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_b15_blocked_client_time ON public.registry_api_blocked_events (client_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_api_blocked_events TO authenticated;
GRANT ALL ON public.registry_api_blocked_events TO service_role;
ALTER TABLE public.registry_api_blocked_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b15 blocked admin read" ON public.registry_api_blocked_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 9. registry_api_approval_events
CREATE TABLE IF NOT EXISTS public.registry_api_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.registry_api_clients(id) ON DELETE CASCADE,
  approval_type text NOT NULL,
  decision text NOT NULL,
  acknowledgement_text text,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registry_api_approval_events_type_chk CHECK (approval_type IN ('sandbox','demo','production','suspend','revoke','expire','reactivate')),
  CONSTRAINT registry_api_approval_events_decision_chk CHECK (decision IN ('approved','declined','recorded'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_api_approval_events TO authenticated;
GRANT ALL ON public.registry_api_approval_events TO service_role;
ALTER TABLE public.registry_api_approval_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b15 approvals admin read" ON public.registry_api_approval_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 10. registry_api_test_console_events
CREATE TABLE IF NOT EXISTS public.registry_api_test_console_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id),
  client_id uuid REFERENCES public.registry_api_clients(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  mode text,
  identifier_type text,
  identifier_hash text,
  result_state text,
  usable boolean NOT NULL DEFAULT false,
  gate_decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registry_api_test_console_events TO authenticated;
GRANT ALL ON public.registry_api_test_console_events TO service_role;
ALTER TABLE public.registry_api_test_console_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b15 testconsole admin read" ON public.registry_api_test_console_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));
