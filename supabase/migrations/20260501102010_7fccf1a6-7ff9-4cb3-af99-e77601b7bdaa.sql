-- ============================================================================
-- RBAC Stage 3A — Frozen Role Assignment Block
-- RBAC Stage 3G — Test-Mode Production Lockout
-- Non-destructive. Existing rows preserved.
-- ============================================================================

-- ── Stage 3A ────────────────────────────────────────────────────────────────
-- Replace the legacy-admin-only trigger with a broader frozen-role trigger.
-- Frozen roles cannot be newly assigned via INSERT or via an UPDATE that
-- changes role to one of them. Pre-existing rows are untouched.

DROP TRIGGER IF EXISTS prevent_legacy_admin_assignment_trg ON public.user_roles;
DROP FUNCTION IF EXISTS public.prevent_legacy_admin_assignment();

CREATE OR REPLACE FUNCTION public.prevent_frozen_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_frozen_roles text[] := ARRAY[
    'admin',          -- legacy super-admin, replaced by platform_admin
    'api_admin',      -- parked
    'billing_admin',  -- parked
    'buyer',          -- transaction-side label, not RBAC
    'seller',         -- transaction-side label, not RBAC
    'broker'          -- transaction-side label, not RBAC
  ];
BEGIN
  -- INSERT into a frozen role: always block
  IF TG_OP = 'INSERT' AND NEW.role::text = ANY(v_frozen_roles) THEN
    RAISE EXCEPTION
      'Role % is frozen and cannot be newly assigned. See RBAC Stage 3A.', NEW.role
      USING ERRCODE = 'check_violation';
  END IF;

  -- UPDATE that *changes* role into a frozen role: block.
  -- UPDATE that leaves role unchanged (even on a frozen role): allow,
  -- so legitimate maintenance on the surviving api_admin row keeps working.
  IF TG_OP = 'UPDATE'
     AND NEW.role::text = ANY(v_frozen_roles)
     AND OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION
      'Role % is frozen and cannot be assigned via update. See RBAC Stage 3A.', NEW.role
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_frozen_role_assignment_trg
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_frozen_role_assignment();

COMMENT ON FUNCTION public.prevent_frozen_role_assignment() IS
  'RBAC Stage 3A: blocks new assignments of frozen roles (admin, api_admin, billing_admin, buyer, seller, broker). Preserves existing rows.';

-- ── Stage 3G ────────────────────────────────────────────────────────────────
-- Production lockout for test-mode bypass.
--
-- Source of truth for environment lives in admin_settings.value->>'tier'
-- under key='environment'. Defaults to 'sandbox' so current behaviour is
-- preserved. Production sites must explicitly upsert tier='production'.

INSERT INTO public.admin_settings (key, value)
VALUES ('environment', jsonb_build_object('tier', 'sandbox'))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_production_environment()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT lower(value->>'tier') = 'production'
      FROM public.admin_settings
      WHERE key = 'environment'
      LIMIT 1
    ),
    false
  );
$$;

COMMENT ON FUNCTION public.is_production_environment() IS
  'RBAC Stage 3G: returns true when admin_settings.environment.tier = production. Used to lock out test-mode bypass.';

-- Harden the bypass RPC: even if an admin flips test-mode flags on, this
-- returns false in production. Edge functions get a second layer via
-- ENVIRONMENT_TIER env var in _shared/test-mode-bypass.ts.

CREATE OR REPLACE FUNCTION public.is_test_mode_bypass_enabled(_gate text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT public.is_production_environment()
    AND COALESCE(
      (
        SELECT (value ->> 'enabled')::boolean
           AND COALESCE((value ->> _gate)::boolean, false)
        FROM public.admin_settings
        WHERE key = 'test_mode_bypass'
        LIMIT 1
      ),
      false
    );
$$;

COMMENT ON FUNCTION public.is_test_mode_bypass_enabled(text) IS
  'RBAC Stage 3G hardened: always returns false when environment tier is production. Production override must use the future break-glass / second-approval workflow, not test-mode bypass.';

-- Convenience: surface the lockout flag to UI so the admin panel can show a
-- production-lockout warning instead of silently accepting toggles.

CREATE OR REPLACE FUNCTION public.get_test_mode_lockout_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'production_locked', public.is_production_environment(),
    'tier', COALESCE(
      (SELECT value->>'tier' FROM public.admin_settings WHERE key = 'environment' LIMIT 1),
      'sandbox'
    )
  );
$$;

COMMENT ON FUNCTION public.get_test_mode_lockout_state() IS
  'RBAC Stage 3G: returns {production_locked, tier} for the admin UI to render the production lockout banner.';

GRANT EXECUTE ON FUNCTION public.is_production_environment() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_test_mode_lockout_state() TO authenticated, anon;