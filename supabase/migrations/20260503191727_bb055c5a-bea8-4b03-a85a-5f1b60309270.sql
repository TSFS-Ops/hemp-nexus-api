CREATE OR REPLACE FUNCTION public._td02b_persist()
RETURNS void
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
BEGIN
SELECT id, org_id INTO v_match_id, v_org_id
FROM matches WHERE state = 'discovery' LIMIT 1;
IF v_match_id IS NULL THEN
-- Clean disposable-DB replay: no out-of-band 'discovery' match exists to
-- exercise this diagnostic proof against. Skip safely rather than writing
-- an audit_logs row with a NULL org_id, which violates the NOT NULL
-- constraint on audit_logs.org_id (proof/test script prerequisite absent).
RETURN;
END IF;
v_correct := public.compute_match_terms_hash(v_match_id);
v_null_res := public.atomic_generate_poi_v2(v_match_id, v_org_id, now(), gen_random_uuid(),
'{"declaration_ack":true,"atb_ack":true}'::jsonb, NULL);
v_blank_res := public.atomic_generate_poi_v2(v_match_id, v_org_id, now(), gen_random_uuid(),
'{"declaration_ack":true,"atb_ack":true}'::jsonb, ' ');
v_wrong_res := public.atomic_generate_poi_v2(v_match_id, v_org_id, now(), gen_random_uuid(),
'{"declaration_ack":true,"atb_ack":true}'::jsonb,
'0000000000000000000000000000000000000000000000000000000000000000');
INSERT INTO audit_logs (org_id, action, entity_type, entity_id, metadata)
VALUES (v_org_id, 'diagnostic.td02b', 'match', v_match_id,
jsonb_build_object(
'server_hash', v_correct,
'null_hash', v_null_res,
'blank_hash', v_blank_res,
'wrong_hash', v_wrong_res
));
END $$;

SELECT public._td02b_persist();
DROP FUNCTION public._td02b_persist();
