CREATE TABLE IF NOT EXISTS public._proof_results (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  step text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public._proof_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "_proof_results_no_access" ON public._proof_results FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public._proof_run()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_run uuid := gen_random_uuid();
  v_dove_id uuid; v_dove_orig_org uuid;
  v_dove_email text := 'dovedavies14@gmail.com';
  v_temp_org uuid := gen_random_uuid();
  v_initiator_org uuid := gen_random_uuid();
  v_match_id uuid := gen_random_uuid();
  v_engagement_id uuid := gen_random_uuid();
BEGIN
  SELECT id, org_id INTO v_dove_id, v_dove_orig_org
    FROM profiles WHERE email = v_dove_email;

  IF v_dove_id IS NULL THEN
    INSERT INTO _proof_results (run_id, step, detail) VALUES (v_run, 'skipped',
      'Proof prerequisite profile not present; proof block skipped during clean replay.');
    RETURN v_run;
  END IF;

  INSERT INTO organizations (id, name) VALUES
    (v_initiator_org, 'PROOF-INITIATOR-' || v_initiator_org),
    (v_temp_org, 'PROOF-TEMPSWAP-' || v_temp_org);

  INSERT INTO matches (id, org_id, buyer_org_id, seller_org_id, match_type, commodity, status, hash)
  VALUES (v_match_id, v_initiator_org, v_initiator_org, NULL, 'bid','PROOF cascade','matched','h-'||gen_random_uuid()::text);

  INSERT INTO poi_engagements (id, match_id, org_id, counterparty_email,
                               counterparty_org_id, counterparty_type, engagement_status)
  VALUES (v_engagement_id, v_match_id, v_initiator_org, v_dove_email, NULL, 'unknown','notification_sent');

  INSERT INTO _proof_results (run_id, step, detail) VALUES (v_run, '01_before',
    format('eng.org=%s match.seller=%s',
      COALESCE((SELECT counterparty_org_id::text FROM poi_engagements WHERE id=v_engagement_id),'NULL'),
      COALESCE((SELECT seller_org_id::text FROM matches WHERE id=v_match_id),'NULL')));

  -- THE EVENT
  UPDATE profiles SET org_id = v_temp_org WHERE id = v_dove_id;

  INSERT INTO _proof_results (run_id, step, detail) VALUES (v_run, '02_after_swap',
    format('eng.org=%s match.seller=%s',
      COALESCE((SELECT counterparty_org_id::text FROM poi_engagements WHERE id=v_engagement_id),'NULL'),
      COALESCE((SELECT seller_org_id::text FROM matches WHERE id=v_match_id),'NULL')));

  INSERT INTO _proof_results (run_id, step, detail) VALUES (v_run, '03_expected_org', v_temp_org::text);

  INSERT INTO _proof_results (run_id, step, detail)
  SELECT v_run, '04_audit',
         format('%s | target=%s | side=%s | email=%s | trigger=%s',
                action, target_id::text,
                COALESCE(details->>'filled_side','-'),
                COALESCE(details->>'matched_email','-'),
                details->>'trigger')
    FROM admin_audit_logs
   WHERE target_id IN (v_engagement_id, v_match_id)
   ORDER BY created_at;

  -- Restore + cleanup
  UPDATE profiles SET org_id = v_dove_orig_org WHERE id = v_dove_id;
  DELETE FROM admin_audit_logs WHERE target_id IN (v_engagement_id, v_match_id);
  DELETE FROM poi_engagements WHERE id = v_engagement_id;
  DELETE FROM matches WHERE id = v_match_id;
  DELETE FROM organizations WHERE id IN (v_initiator_org, v_temp_org);

  INSERT INTO _proof_results (run_id, step, detail) VALUES (v_run, '05_dove_restored_to',
    (SELECT org_id::text FROM profiles WHERE id = v_dove_id));
  INSERT INTO _proof_results (run_id, step, detail) VALUES (v_run, '06_dove_expected', v_dove_orig_org::text);

  RETURN v_run;
END $fn$;

SELECT public._proof_run();
DROP FUNCTION public._proof_run();
