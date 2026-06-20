-- =========================================================
-- Batch 5 — Institutional API & Client Management (M008/M009/M016)
-- =========================================================

CREATE TABLE public.registry_api_clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  status TEXT NOT NULL DEFAULT 'pending',
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  rate_limit_per_day INTEGER NOT NULL DEFAULT 10000,
  contact_email TEXT,
  admin_notes TEXT,
  billing_readiness_tier TEXT,
  suspended_reason TEXT,
  suspended_at TIMESTAMPTZ,
  suspended_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT registry_api_clients_environment_chk CHECK (environment IN ('sandbox','production')),
  CONSTRAINT registry_api_clients_status_chk CHECK (status IN ('pending','active','suspended','revoked'))
);
CREATE INDEX idx_registry_api_clients_org ON public.registry_api_clients(organization_id);
CREATE INDEX idx_registry_api_clients_status ON public.registry_api_clients(status);

GRANT SELECT ON public.registry_api_clients TO authenticated;
GRANT ALL ON public.registry_api_clients TO service_role;
ALTER TABLE public.registry_api_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "registry_api_clients admin read" ON public.registry_api_clients
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
  );

CREATE OR REPLACE FUNCTION public.registry_api_clients_block_status_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'registry_api_clients status mutations require the audited registry-api-client-manage edge function';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_registry_api_clients_block_status_mutation
  BEFORE UPDATE ON public.registry_api_clients
  FOR EACH ROW EXECUTE FUNCTION public.registry_api_clients_block_status_mutation();


CREATE TABLE public.registry_api_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.registry_api_clients(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  revoked_reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT registry_api_keys_environment_chk CHECK (environment IN ('sandbox','production')),
  CONSTRAINT registry_api_keys_status_chk CHECK (status IN ('active','revoked','expired'))
);
CREATE INDEX idx_registry_api_keys_client ON public.registry_api_keys(client_id);
CREATE INDEX idx_registry_api_keys_prefix ON public.registry_api_keys(key_prefix);

GRANT SELECT (id, client_id, key_prefix, environment, status, expires_at, last_used_at, revoked_at, revoked_by, revoked_reason, created_by, created_at)
  ON public.registry_api_keys TO authenticated;
REVOKE SELECT (key_hash) ON public.registry_api_keys FROM authenticated;
GRANT ALL ON public.registry_api_keys TO service_role;
ALTER TABLE public.registry_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "registry_api_keys admin read" ON public.registry_api_keys
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
  );

CREATE OR REPLACE FUNCTION public.registry_api_keys_block_status_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'registry_api_keys status mutations require the audited registry-api-client-manage edge function';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_registry_api_keys_block_status_mutation
  BEFORE UPDATE ON public.registry_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.registry_api_keys_block_status_mutation();


CREATE TABLE public.registry_api_request_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.registry_api_clients(id) ON DELETE SET NULL,
  key_id UUID REFERENCES public.registry_api_keys(id) ON DELETE SET NULL,
  environment TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  scope_requested TEXT,
  scope_granted BOOLEAN NOT NULL DEFAULT FALSE,
  rate_limited BOOLEAN NOT NULL DEFAULT FALSE,
  business_decision_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  result_state TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER,
  request_id TEXT,
  ip_address TEXT,
  payload_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_api_request_logs_client ON public.registry_api_request_logs(client_id, created_at DESC);
CREATE INDEX idx_registry_api_request_logs_endpoint ON public.registry_api_request_logs(endpoint, created_at DESC);

GRANT SELECT ON public.registry_api_request_logs TO authenticated;
GRANT ALL ON public.registry_api_request_logs TO service_role;
ALTER TABLE public.registry_api_request_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "registry_api_request_logs admin read" ON public.registry_api_request_logs
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
  );


CREATE TABLE public.registry_api_audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.registry_api_clients(id) ON DELETE SET NULL,
  key_id UUID REFERENCES public.registry_api_keys(id) ON DELETE SET NULL,
  audit_event_name TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id),
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_api_audit_events_client ON public.registry_api_audit_events(client_id, created_at DESC);
CREATE INDEX idx_registry_api_audit_events_name ON public.registry_api_audit_events(audit_event_name, created_at DESC);

GRANT SELECT ON public.registry_api_audit_events TO authenticated;
GRANT ALL ON public.registry_api_audit_events TO service_role;
ALTER TABLE public.registry_api_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "registry_api_audit_events admin read" ON public.registry_api_audit_events
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'compliance_owner')
  );


CREATE OR REPLACE FUNCTION public.update_updated_at_column_b5()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_registry_api_clients_updated_at
  BEFORE UPDATE ON public.registry_api_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column_b5();
