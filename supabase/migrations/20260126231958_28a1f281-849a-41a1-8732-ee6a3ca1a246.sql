-- ============================================================
-- Security hardening: make PII/Evidence views backend-only
-- Fixes recurring scanner findings by enforcing deny-by-default grants.
-- ============================================================

-- 1) profiles_safe contains PII-derived fields (email via get_user_email)
--    Lock it down to service_role only.
REVOKE ALL ON TABLE public.profiles_safe FROM PUBLIC;
REVOKE ALL ON TABLE public.profiles_safe FROM anon;
REVOKE ALL ON TABLE public.profiles_safe FROM authenticated;
GRANT SELECT ON TABLE public.profiles_safe TO service_role;

-- 2) match_evidence should be backend-only (it contains sensitive match payloads)
--    Make the intent explicit (even if already locked down).
REVOKE ALL ON TABLE public.match_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.match_evidence FROM anon;
REVOKE ALL ON TABLE public.match_evidence FROM authenticated;
GRANT SELECT ON TABLE public.match_evidence TO service_role;

-- 3) Reduce function attack surface: get_user_email() is SECURITY DEFINER.
--    Since profiles_safe is now backend-only, revoke direct execution for anon/authenticated.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_user_email'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_user_email(uuid) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_user_email(uuid) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_user_email(uuid) FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_user_email(uuid) TO service_role';
  END IF;
END $$;

-- 4) Ensure both views stay security-invoker (defense-in-depth)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='profiles_safe' AND c.relkind='v'
  ) THEN
    EXECUTE 'ALTER VIEW public.profiles_safe SET (security_invoker = true)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='match_evidence' AND c.relkind='v'
  ) THEN
    EXECUTE 'ALTER VIEW public.match_evidence SET (security_invoker = true)';
  END IF;
END $$;
