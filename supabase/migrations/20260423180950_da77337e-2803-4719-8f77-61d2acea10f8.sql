-- Test-mode bypass: lets platform admins short-circuit external integrations
-- (IDV, sanctions, KYB, UBO, authority binding) so other parts of the
-- platform can be tested before real providers are wired in.

-- 1) Seed default admin_settings row (all flags off by default).
INSERT INTO public.admin_settings (key, value)
VALUES (
  'test_mode_bypass',
  jsonb_build_object(
    'enabled', false,
    'idv', false,
    'sanctions', false,
    'kyb', false,
    'ubo', false,
    'authority', false,
    'note', ''
  )
)
ON CONFLICT (key) DO NOTHING;

-- 2) Helper RPC: SECURITY DEFINER so edge functions (service role) and
-- authenticated admins can both check a single gate flag cheaply.
CREATE OR REPLACE FUNCTION public.is_test_mode_bypass_enabled(_gate text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
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

-- 3) Public-readable view of the bypass flags so the frontend can render
-- the global banner without requiring write access to admin_settings.
CREATE OR REPLACE FUNCTION public.get_test_mode_bypass_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.admin_settings WHERE key = 'test_mode_bypass' LIMIT 1),
    '{}'::jsonb
  );
$$;

-- Allow any authenticated user to read the state (so banner shows for everyone).
GRANT EXECUTE ON FUNCTION public.get_test_mode_bypass_state() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_test_mode_bypass_enabled(text) TO authenticated, service_role;