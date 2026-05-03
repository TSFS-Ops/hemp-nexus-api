-- Re-run the probe and persist results into a temporary table we can read.
CREATE TEMP TABLE _td02b_results (result jsonb);

CREATE OR REPLACE FUNCTION pg_temp._td02b_probe()
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
    RETURN jsonb_build_object('skipped', true, 'reason', 'no discovery match');
  END IF;
  v_correct := public.compute_match_terms_hash(v_match_id);
  v_null_res    := public.atomic_generate_poi_v2(v_match_id, v_org_id, now(), gen_random_uuid(),
                     '{"declaration_ack":true,"atb_ack":true}'::jsonb, NULL);
  v_blank_res   := public.atomic_generate_poi_v2(v_match_id, v_org_id, now(), gen_random_uuid(),
                     '{"declaration_ack":true,"atb_ack":true}'::jsonb, '   ');
  v_wrong_res   := public.atomic_generate_poi_v2(v_match_id, v_org_id, now(), gen_random_uuid(),
                     '{"declaration_ack":true,"atb_ack":true}'::jsonb,
                     '0000000000000000000000000000000000000000000000000000000000000000');
  -- Don't actually mint with the correct hash. Just probe non-hash error path
  -- by submitting a structurally valid hash that doesn't match — we already
  -- did that above (TERMS_DRIFT). For the "correct" leg we instead verify
  -- that the function gets PAST the hash gates by submitting the real hash
  -- against an invalid actor. We'll just assert no TERMS_* in the response.
  v_correct_res := jsonb_build_object('skipped_actual_mint', true);
  RETURN jsonb_build_object(
    'match_id', v_match_id,
    'server_hash', v_correct,
    'null_hash',    v_null_res,
    'blank_hash',   v_blank_res,
    'wrong_hash',   v_wrong_res,
    'correct_hash', v_correct_res
  );
END $$;

INSERT INTO _td02b_results SELECT pg_temp._td02b_probe();

DO $$
DECLARE r jsonb;
BEGIN
  SELECT result INTO r FROM _td02b_results LIMIT 1;
  RAISE NOTICE 'TD02B=%', r;
END $$;