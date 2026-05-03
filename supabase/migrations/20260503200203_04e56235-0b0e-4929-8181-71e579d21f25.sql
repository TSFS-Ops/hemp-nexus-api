CREATE OR REPLACE FUNCTION public._d04_test_force_fail(
  p_match_id uuid,
  p_org_id uuid,
  p_acks jsonb,
  p_terms_hash text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.atomic_generate_poi_v2(
    p_match_id,
    p_org_id,
    now(),
    '00000000-0000-0000-0000-000000000001'::uuid,
    p_acks,
    p_terms_hash
  );
$$;

REVOKE ALL ON FUNCTION public._d04_test_force_fail(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._d04_test_force_fail(uuid, uuid, jsonb, text) TO service_role;