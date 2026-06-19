
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Role enum: add commercial_owner + compliance_owner (sign-off only)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'commercial_owner';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'compliance_owner';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. api_keys lifecycle columns
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS rotated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at     timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by     uuid,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS revoked_reason   text;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. api_request_logs trace columns
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.api_request_logs
  ADD COLUMN IF NOT EXISTS request_payload_hash text,
  ADD COLUMN IF NOT EXISTS rate_limit_decision  text,
  ADD COLUMN IF NOT EXISTS billable_overage     boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. api_clients dual sign-off columns
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.api_clients
  ADD COLUMN IF NOT EXISTS commercial_owner_sign_off_by uuid,
  ADD COLUMN IF NOT EXISTS commercial_owner_sign_off_at timestamptz,
  ADD COLUMN IF NOT EXISTS compliance_owner_sign_off_by uuid,
  ADD COLUMN IF NOT EXISTS compliance_owner_sign_off_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. api_production_approvals — append-only audit-grade register
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_production_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_client_id uuid NOT NULL REFERENCES public.api_clients(id) ON DELETE RESTRICT,
  approval_event text NOT NULL CHECK (approval_event IN (
    'submitted',
    'platform_admin_approved',
    'commercial_owner_signed_off',
    'compliance_owner_signed_off',
    'fully_approved',
    'rejected',
    'revoked'
  )),
  approved_role text NOT NULL CHECK (approved_role IN (
    'platform_admin', 'commercial_owner', 'compliance_owner', 'system'
  )),
  actor_user_id uuid,
  approved_scopes text[],
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.api_production_approvals TO authenticated;
GRANT ALL    ON public.api_production_approvals TO service_role;

ALTER TABLE public.api_production_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read all production approvals"
  ON public.api_production_approvals
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

CREATE POLICY "Service role writes production approvals"
  ON public.api_production_approvals
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Append-only: block UPDATE and DELETE for everyone except service_role
-- (service_role bypasses RLS; no policy = no access for the named roles).
CREATE INDEX IF NOT EXISTS api_production_approvals_client_idx
  ON public.api_production_approvals (api_client_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. api_v1_exceptions — time-bounded platform_admin exception register
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_v1_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_code text NOT NULL,
  rationale text NOT NULL,
  compensating_controls text NOT NULL,
  approved_by uuid,
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  expires_when text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.api_v1_exceptions TO authenticated;
GRANT ALL    ON public.api_v1_exceptions TO service_role;

ALTER TABLE public.api_v1_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read V1 exceptions"
  ON public.api_v1_exceptions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

CREATE POLICY "Service role manages V1 exceptions"
  ON public.api_v1_exceptions
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Seed the approved schema-level data separation exception (Batch 1 decision #3).
INSERT INTO public.api_v1_exceptions
  (exception_code, rationale, compensating_controls, expires_when, metadata)
SELECT
  'schema_level_data_separation_v1',
  'Production lookup is deliberately conservative and returns no_match only. There is no real approved production response-data table to physically separate yet. A time-bounded platform_admin exception was approved during Batch 1 to allow flag-separated sandbox/production tables until the first real production data source is wired.',
  'Sandbox records remain in api_sandbox_records. Production lookup remains conservative. Sandbox keys are blocked from production paths. Production keys are blocked from sandbox-only test endpoints. All keys, logs, responses, usage records and audit events remain environment-tagged. Exception expires when the first real production data source is wired.',
  'first_real_production_data_source_wired',
  jsonb_build_object(
    'workstream', 'public_api_v1_sandbox_production_separation',
    'batch', 1,
    'decision_id', 'open_question_3',
    'must_not_be_used_to_justify', 'mixing real production data with sandbox records'
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.api_v1_exceptions
   WHERE exception_code = 'schema_level_data_separation_v1' AND active = true
);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Forbidden-scope trigger on api_keys
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_api_key_scopes_allowed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s text;
  forbidden_exact constant text[] := ARRAY[
    'evidence_export',
    'governance_record_write',
    'verification_override',
    'payment_approve',
    'compliance_clearance',
    'poi:create',
    'wad:issue',
    'document_upload',
    'bank_detail_change',
    'client_data_export'
  ];
BEGIN
  IF NEW.scopes IS NULL THEN
    RETURN NEW;
  END IF;
  FOREACH s IN ARRAY NEW.scopes LOOP
    IF s ILIKE 'write:%' OR s = 'write' THEN
      RAISE EXCEPTION 'forbidden_v1_scope: %', s USING ERRCODE = 'check_violation';
    END IF;
    IF s ILIKE 'admin:%' OR s = 'admin' THEN
      RAISE EXCEPTION 'forbidden_v1_scope: %', s USING ERRCODE = 'check_violation';
    END IF;
    IF s = ANY(forbidden_exact) THEN
      RAISE EXCEPTION 'forbidden_v1_scope: %', s USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_keys_assert_scopes_allowed ON public.api_keys;
CREATE TRIGGER api_keys_assert_scopes_allowed
  BEFORE INSERT OR UPDATE OF scopes ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.assert_api_key_scopes_allowed();
