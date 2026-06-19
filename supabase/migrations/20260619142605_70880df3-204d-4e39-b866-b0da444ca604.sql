-- Public API V1 · Sandbox/Production Batch 3 — Key Lifecycle & Production Access

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Expiry-warning state columns (30 / 14 / 3 day windows for production;
--    sandbox keeps the legacy single warning + a distinct sandbox column).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS expiry_warning_30d_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS expiry_warning_14d_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS expiry_warning_3d_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS sandbox_expiry_warning_sent_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Append-only enforcement on api_production_approvals (defence-in-depth
--    against service_role mistakes — RLS alone is bypassed by service_role).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_production_approvals_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'api_production_approvals is append-only (action=%, id=%)',
    TG_OP, COALESCE(OLD.id::text, 'unknown');
END;
$$;

DROP TRIGGER IF EXISTS api_production_approvals_no_update ON public.api_production_approvals;
CREATE TRIGGER api_production_approvals_no_update
  BEFORE UPDATE ON public.api_production_approvals
  FOR EACH ROW EXECUTE FUNCTION public.api_production_approvals_append_only();

DROP TRIGGER IF EXISTS api_production_approvals_no_delete ON public.api_production_approvals;
CREATE TRIGGER api_production_approvals_no_delete
  BEFORE DELETE ON public.api_production_approvals
  FOR EACH ROW EXECUTE FUNCTION public.api_production_approvals_append_only();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Production-key issuance gate — extend the existing client-status trigger
--    to require commercial_owner + compliance_owner sign-offs and a default
--    production expiry of ≤ 12 months. Sandbox defaults to ≤ 90 days.
--    This complements the Batch 2 forbidden-scope trigger; it does NOT
--    replace any existing checks.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_keys_v1_lifecycle_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_client public.api_clients%ROWTYPE;
  v_max_expiry timestamptz;
BEGIN
  IF NEW.environment IS NULL THEN
    RETURN NEW;
  END IF;

  -- Apply default expiry when caller omitted it.
  IF NEW.expires_at IS NULL THEN
    IF NEW.environment = 'production' THEN
      NEW.expires_at := now() + interval '12 months';
    ELSIF NEW.environment = 'sandbox' THEN
      NEW.expires_at := now() + interval '90 days';
    END IF;
  END IF;

  -- Cap expiry windows. No perpetual production keys.
  IF NEW.environment = 'production' THEN
    v_max_expiry := now() + interval '12 months' + interval '1 day';
    IF NEW.expires_at > v_max_expiry THEN
      RAISE EXCEPTION 'API_KEY_PRODUCTION_EXPIRY_EXCEEDS_12_MONTHS';
    END IF;
  ELSIF NEW.environment = 'sandbox' THEN
    v_max_expiry := now() + interval '90 days' + interval '1 day';
    IF NEW.expires_at > v_max_expiry THEN
      RAISE EXCEPTION 'API_KEY_SANDBOX_EXPIRY_EXCEEDS_90_DAYS';
    END IF;
  END IF;

  -- Production keys must have dual sign-offs on the linked client.
  IF NEW.environment = 'production' AND NEW.api_client_id IS NOT NULL THEN
    SELECT * INTO v_client FROM public.api_clients WHERE id = NEW.api_client_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'API_CLIENT_NOT_FOUND';
    END IF;
    IF v_client.commercial_owner_sign_off_by IS NULL
       OR v_client.commercial_owner_sign_off_at IS NULL THEN
      RAISE EXCEPTION 'API_CLIENT_COMMERCIAL_OWNER_SIGN_OFF_REQUIRED';
    END IF;
    IF v_client.compliance_owner_sign_off_by IS NULL
       OR v_client.compliance_owner_sign_off_at IS NULL THEN
      RAISE EXCEPTION 'API_CLIENT_COMPLIANCE_OWNER_SIGN_OFF_REQUIRED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_keys_lifecycle_defaults ON public.api_keys;
CREATE TRIGGER api_keys_lifecycle_defaults
  BEFORE INSERT ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.api_keys_v1_lifecycle_defaults();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Helpful index for expiry sweeper queries
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS api_keys_env_status_expires_idx
  ON public.api_keys (environment, status, expires_at);
