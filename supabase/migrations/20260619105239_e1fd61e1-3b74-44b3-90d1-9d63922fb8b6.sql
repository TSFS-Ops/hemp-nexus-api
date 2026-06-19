
-- 1. Table
CREATE TABLE public.api_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,

  -- Legal entity & contacts (onboarding)
  legal_entity_name text NOT NULL,
  registration_number text,
  country text NOT NULL,
  authorised_commercial_contact_name text,
  authorised_commercial_contact_email text,
  technical_contact_name text,
  technical_contact_email text,
  billing_contact_name text,
  billing_contact_email text,
  support_contact_name text,
  support_contact_email text,

  -- Intended integration
  intended_use_case text,
  expected_monthly_volume integer,
  proposed_integration_system text,
  requested_scopes text[] NOT NULL DEFAULT '{}',
  callback_url text,
  ip_details text,

  -- Sandbox stage
  sandbox_terms_accepted boolean NOT NULL DEFAULT false,
  sandbox_approved boolean NOT NULL DEFAULT false,
  sandbox_approved_by uuid REFERENCES auth.users(id),
  sandbox_approved_at timestamptz,

  -- Production approval checklist
  production_requested boolean NOT NULL DEFAULT false,
  signed_api_agreement_confirmed boolean NOT NULL DEFAULT false,
  commercial_plan_approved boolean NOT NULL DEFAULT false,
  sandbox_checklist_completed boolean NOT NULL DEFAULT false,
  production_scopes_approved boolean NOT NULL DEFAULT false,
  production_technical_contact_confirmed boolean NOT NULL DEFAULT false,
  billing_details_confirmed boolean NOT NULL DEFAULT false,
  retention_rules_confirmed boolean NOT NULL DEFAULT false,
  security_contact_confirmed boolean NOT NULL DEFAULT false,
  ip_allowlist_or_exception_confirmed boolean NOT NULL DEFAULT false,
  production_approved boolean NOT NULL DEFAULT false,
  production_approved_by uuid REFERENCES auth.users(id),
  production_approved_at timestamptz,

  -- Lifecycle
  status text NOT NULL DEFAULT 'draft',
  suspended_at timestamptz,
  suspended_by uuid REFERENCES auth.users(id),
  suspended_reason text,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revoked_reason text,

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),

  CONSTRAINT api_clients_status_check CHECK (status IN (
    'draft','sandbox_pending','sandbox_approved',
    'production_pending','production_approved',
    'suspended','revoked'
  ))
);

CREATE INDEX idx_api_clients_org_id ON public.api_clients(org_id);
CREATE INDEX idx_api_clients_status ON public.api_clients(status);

-- 2. Grants (platform_admin / api_admin / auditor are authenticated roles)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_clients TO authenticated;
GRANT ALL ON public.api_clients TO service_role;

-- 3. RLS
ALTER TABLE public.api_clients ENABLE ROW LEVEL SECURITY;

-- Platform admins: full
CREATE POLICY "Platform admins manage api_clients"
  ON public.api_clients
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- API admins: read only
CREATE POLICY "API admins read api_clients"
  ON public.api_clients
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'api_admin'));

-- Auditors: read only
CREATE POLICY "Auditors read api_clients"
  ON public.api_clients
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'auditor'));

-- 4. updated_at trigger
CREATE TRIGGER set_api_clients_updated_at
  BEFORE UPDATE ON public.api_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Production-approval checklist gate (DB-level)
CREATE OR REPLACE FUNCTION public.api_clients_enforce_production_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.production_approved = true
     AND (OLD.production_approved IS DISTINCT FROM NEW.production_approved
          OR TG_OP = 'INSERT')
  THEN
    IF NOT (
      COALESCE(NEW.signed_api_agreement_confirmed, false)
      AND COALESCE(NEW.commercial_plan_approved, false)
      AND COALESCE(NEW.sandbox_checklist_completed, false)
      AND COALESCE(NEW.production_scopes_approved, false)
      AND COALESCE(NEW.production_technical_contact_confirmed, false)
      AND COALESCE(NEW.billing_details_confirmed, false)
      AND COALESCE(NEW.retention_rules_confirmed, false)
      AND COALESCE(NEW.security_contact_confirmed, false)
      AND COALESCE(NEW.ip_allowlist_or_exception_confirmed, false)
      AND COALESCE(NEW.sandbox_approved, false)
    ) THEN
      RAISE EXCEPTION 'api_clients: production_approved requires full checklist (signed_api_agreement, commercial_plan, sandbox_checklist, production_scopes, production_technical_contact, billing_details, retention_rules, security_contact, ip_allowlist_or_exception, sandbox_approved must all be true)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER api_clients_production_checklist_gate
  BEFORE INSERT OR UPDATE ON public.api_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.api_clients_enforce_production_checklist();
