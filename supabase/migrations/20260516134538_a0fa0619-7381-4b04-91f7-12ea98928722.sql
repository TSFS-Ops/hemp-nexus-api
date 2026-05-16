
-- ──────────────────────────────────────────────────────────────────────
-- Batch G — Fix 1: Generic admin_settings change audit trigger
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_admin_settings_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sensitive boolean;
BEGIN
  IF OLD.value IS NOT DISTINCT FROM NEW.value THEN
    RETURN NEW;
  END IF;

  v_sensitive := NEW.key IN ('billing_availability', 'test_mode_bypass', 'general');

  INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    'admin_settings.changed',
    'admin_settings',
    NULL,
    jsonb_build_object(
      'key', NEW.key,
      'previous_value', OLD.value,
      'new_value', NEW.value,
      'actor_user_id', auth.uid(),
      'sensitive', v_sensitive,
      'changed_at', now()
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_admin_settings_change ON public.admin_settings;
CREATE TRIGGER trg_log_admin_settings_change
AFTER UPDATE ON public.admin_settings
FOR EACH ROW
WHEN (OLD.value IS DISTINCT FROM NEW.value)
EXECUTE FUNCTION public.log_admin_settings_change();

-- ──────────────────────────────────────────────────────────────────────
-- Batch G — Fix 2: AAL2/MFA BEFORE UPDATE guard for sensitive settings
-- Blocks platform_admin from flipping billing_availability,
-- test_mode_bypass, or general/maintenance unless their session JWT
-- carries aal=aal2. Service-role / backend writes (no JWT or
-- role=service_role/postgres) are deliberately exempt so backfill
-- migrations, edge functions and cron tasks are not broken.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_admin_settings_aal2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims jsonb;
  v_role text;
  v_aal text;
  v_sensitive_keys text[] := ARRAY['billing_availability', 'test_mode_bypass', 'general'];
BEGIN
  IF NOT (NEW.key = ANY(v_sensitive_keys)) THEN
    RETURN NEW;
  END IF;
  IF OLD.value IS NOT DISTINCT FROM NEW.value THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_claims := current_setting('request.jwt.claims', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_claims := NULL;
  END;

  v_role := COALESCE(v_claims ->> 'role', '');
  v_aal  := COALESCE(v_claims ->> 'aal', '');

  -- Backend / service-role writes are exempt; only end-user PostgREST
  -- sessions (role 'authenticated') are forced through AAL2.
  IF v_claims IS NULL OR v_role IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF v_aal <> 'aal2' THEN
    RAISE EXCEPTION
      'AAL2_REQUIRED: changing sensitive admin_setting "%" requires an MFA-challenged session', NEW.key
      USING ERRCODE = '42501',
            HINT = 'Re-authenticate with your authenticator app and retry.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_admin_settings_aal2 ON public.admin_settings;
CREATE TRIGGER trg_enforce_admin_settings_aal2
BEFORE UPDATE ON public.admin_settings
FOR EACH ROW
WHEN (OLD.value IS DISTINCT FROM NEW.value)
EXECUTE FUNCTION public.enforce_admin_settings_aal2();

-- ──────────────────────────────────────────────────────────────────────
-- Batch G — Fix 3: Extend atomic_token_credit with optional extra metadata
-- so admin manual credits can stamp credit_kind, payment_reference,
-- actor, target org, demo flag etc. without losing the existing
-- transactional ledger write. Existing 4-arg callers (purchase webhook,
-- verify path) keep working unchanged thanks to the DEFAULT.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_token_credit(
  p_org_id uuid,
  p_amount integer,
  p_reason text DEFAULT 'purchase'::text,
  p_reference_id text DEFAULT NULL::text,
  p_extra_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_balance integer;
  v_old_balance integer;
  v_metadata jsonb;
BEGIN
  SELECT balance INTO v_old_balance FROM token_balances WHERE org_id = p_org_id;

  UPDATE token_balances
  SET balance = balance + p_amount,
      updated_at = now()
  WHERE org_id = p_org_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    v_old_balance := 0;
    INSERT INTO token_balances (org_id, balance, minimum_required, updated_at)
    VALUES (p_org_id, p_amount, 0, now())
    ON CONFLICT (org_id) DO UPDATE
      SET balance = token_balances.balance + p_amount,
          updated_at = now()
    RETURNING balance INTO v_new_balance;
  END IF;

  v_metadata := jsonb_build_object(
    'source', 'atomic_token_credit',
    'credited', p_amount,
    'balance_before', COALESCE(v_old_balance, 0),
    'balance_after', v_new_balance,
    'reason', p_reason
  );

  IF p_extra_metadata IS NOT NULL AND jsonb_typeof(p_extra_metadata) = 'object' THEN
    v_metadata := v_metadata || p_extra_metadata;
  END IF;

  INSERT INTO token_ledger (
    org_id, endpoint, tokens_burned, outcome, remaining_balance,
    request_id, action_type, metadata
  ) VALUES (
    p_org_id,
    COALESCE(p_reason, 'credit'),
    0,
    'allowed',
    v_new_balance,
    COALESCE(p_reference_id, gen_random_uuid()::text),
    'credit',
    v_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'credited', p_amount,
    'reason', p_reason,
    'reference_id', p_reference_id
  );
END;
$function$;

-- Preserve SECDEF Stage D1 lockdown: service_role-only EXECUTE.
REVOKE ALL ON FUNCTION public.atomic_token_credit(uuid, integer, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atomic_token_credit(uuid, integer, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_token_credit(uuid, integer, text, text, jsonb) TO service_role;
