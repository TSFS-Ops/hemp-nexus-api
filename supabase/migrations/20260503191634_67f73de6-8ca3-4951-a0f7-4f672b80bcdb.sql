-- Temporary probe: run the four T-D02b cases as service_role-equivalent
-- (SECURITY DEFINER) and capture the returned JSON. Dropped at the end.
CREATE OR REPLACE FUNCTION public._td02b_probe()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match_id uuid;
  v_org_id uuid;
  v_correct text;
  v_null_res jsonb;
  v_blank_res jsonb;
  v_wrong_res jsonb;
  v_correct_res jsonb;
BEGIN
  SELECT id, org_id INTO v_match_id, v_org_id
  FROM matches WHERE state = 'discovery' LIMIT 1;

  IF v_match_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no discovery match available');
  END IF;

  v_correct := public.compute_match_terms_hash(v_match_id);

  v_null_res    := public.atomic_generate_poi_v2(v_match_id, v_org_id, now(), gen_random_uuid(),
                     '{"declaration_ack":true,"atb_ack":true}'::jsonb, NULL);
  v_blank_res   := public.atomic_generate_poi_v2(v_match_id, v_org_id, now(), gen_random_uuid(),
                     '{"declaration_ack":true,"atb_ack":true}'::jsonb, '   ');
  v_wrong_res   := public.atomic_generate_poi_v2(v_match_id, v_org_id, now(), gen_random_uuid(),
                     '{"declaration_ack":true,"atb_ack":true}'::jsonb,
                     '0000000000000000000000000000000000000000000000000000000000000000');
  -- Don't actually mint — just check that the error code is NOT a hash error.
  -- Run inside a sub-transaction we roll back.
  BEGIN
    v_correct_res := public.atomic_generate_poi_v2(v_match_id, v_org_id, now(), gen_random_uuid(),
                       '{"declaration_ack":true,"atb_ack":true}'::jsonb, v_correct);
    RAISE EXCEPTION 'rollback_probe' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN
    -- swallow — we just want the result captured above
    NULL;
  END;

  RETURN jsonb_build_object(
    'match_id', v_match_id,
    'server_hash', v_correct,
    'null_hash',    v_null_res,
    'blank_hash',   v_blank_res,
    'wrong_hash',   v_wrong_res,
    'correct_hash', v_correct_res
  );
END;
$$;

-- Run it.
DO $$
DECLARE r jsonb;
BEGIN
  r := public._td02b_probe();
  RAISE NOTICE 'TD02B_PROBE_RESULT=%', r;
END $$;

-- Clean up.
DROP FUNCTION public._td02b_probe();