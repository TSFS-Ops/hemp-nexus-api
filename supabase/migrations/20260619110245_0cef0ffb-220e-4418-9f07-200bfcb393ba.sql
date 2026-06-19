
-- Public API V1 · Batch 2 — Key gating, scope linkage, request-log extensions, IP exception table.

-- 1. api_keys → link to api_clients (additive)
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS api_client_id uuid REFERENCES public.api_clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_api_client_id ON public.api_keys(api_client_id);

-- 2. api_request_logs → additive observability columns (all nullable, backward-compatible)
ALTER TABLE public.api_request_logs
  ADD COLUMN IF NOT EXISTS billable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scope_used text,
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS error_code text;

-- 3. IP allowlist exception register
CREATE TABLE IF NOT EXISTS public.api_ip_allowlist_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_client_id uuid NOT NULL REFERENCES public.api_clients(id) ON DELETE CASCADE,
  reason text NOT NULL,
  compensating_controls text,
  active boolean NOT NULL DEFAULT true,
  approved_by uuid,
  approved_at timestamptz,
  deactivated_by uuid,
  deactivated_at timestamptz,
  deactivated_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.api_ip_allowlist_exceptions TO authenticated;
GRANT ALL ON public.api_ip_allowlist_exceptions TO service_role;

ALTER TABLE public.api_ip_allowlist_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ip_exception_platform_admin_all"
  ON public.api_ip_allowlist_exceptions
  FOR ALL
  USING (public.has_role(auth.uid(), 'platform_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));

CREATE POLICY "ip_exception_admin_auditor_read"
  ON public.api_ip_allowlist_exceptions
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR public.has_role(auth.uid(), 'api_admin')
    OR public.has_role(auth.uid(), 'auditor')
  );

CREATE INDEX IF NOT EXISTS idx_ip_exception_client_active
  ON public.api_ip_allowlist_exceptions(api_client_id) WHERE active = true;

-- 4. updated_at trigger
CREATE OR REPLACE FUNCTION public.api_ip_exception_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS api_ip_exception_touch_trg ON public.api_ip_allowlist_exceptions;
CREATE TRIGGER api_ip_exception_touch_trg
  BEFORE UPDATE ON public.api_ip_allowlist_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.api_ip_exception_touch();

-- 5. Key issuance gate — fires on INSERT (creation) and on UPDATE that flips status back to active (rotation pattern keeps creating new rows, so primarily INSERT).
CREATE OR REPLACE FUNCTION public.api_keys_v1_client_gate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_client record;
  v_has_exception boolean;
BEGIN
  -- Only enforce when an api_client linkage is supplied. Legacy keys without
  -- api_client_id continue to behave as before (back-compat).
  IF NEW.api_client_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_client
  FROM public.api_clients
  WHERE id = NEW.api_client_id;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'API_CLIENT_NOT_FOUND' USING ERRCODE = 'check_violation';
  END IF;

  IF v_client.status IN ('suspended','revoked') THEN
    RAISE EXCEPTION 'API_CLIENT_BLOCKED_STATUS_%' , v_client.status USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.environment = 'production' THEN
    IF v_client.production_approved IS NOT TRUE THEN
      RAISE EXCEPTION 'API_CLIENT_PRODUCTION_NOT_APPROVED' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (
      v_client.signed_api_agreement_confirmed
      AND v_client.commercial_plan_approved
      AND v_client.sandbox_checklist_completed
      AND v_client.production_scopes_approved
      AND v_client.production_technical_contact_confirmed
      AND v_client.billing_details_confirmed
      AND v_client.retention_rules_confirmed
      AND v_client.security_contact_confirmed
      AND v_client.ip_allowlist_or_exception_confirmed
    ) THEN
      RAISE EXCEPTION 'API_CLIENT_PRODUCTION_CHECKLIST_INCOMPLETE' USING ERRCODE = 'check_violation';
    END IF;
    -- IP allowlist OR active approved exception
    IF NEW.allowed_ips IS NULL OR array_length(NEW.allowed_ips, 1) IS NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.api_ip_allowlist_exceptions
        WHERE api_client_id = NEW.api_client_id
          AND active = true
          AND approved_at IS NOT NULL
      ) INTO v_has_exception;
      IF NOT v_has_exception THEN
        RAISE EXCEPTION 'API_KEY_PRODUCTION_REQUIRES_IP_ALLOWLIST_OR_EXCEPTION' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF NEW.environment = 'sandbox' THEN
    IF v_client.sandbox_approved IS NOT TRUE THEN
      RAISE EXCEPTION 'API_CLIENT_SANDBOX_NOT_APPROVED' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS api_keys_v1_client_gate_trg ON public.api_keys;
CREATE TRIGGER api_keys_v1_client_gate_trg
  BEFORE INSERT ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.api_keys_v1_client_gate();
