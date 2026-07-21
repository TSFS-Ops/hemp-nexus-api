CREATE OR REPLACE FUNCTION public._proof_test_backfill_trigger_v3()
RETURNS TABLE (step text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dove_id uuid;
  v_dove_email text := 'dovedavies14@gmail.com';
  v_dove_orig_org uuid;
  v_temp_org uuid := gen_random_uuid();
  v_initiator_org uuid := gen_random_uuid();
  v_match_id uuid := gen_random_uuid();
  v_engagement_id uuid := gen_random_uuid();
  v_audit_count int;
  v_engagement_org uuid;
  v_match_seller uuid;
BEGIN
  SELECT id, org_id INTO v_dove_id, v_dove_orig_org
    FROM profiles WHERE email = v_dove_email;
  IF v_dove_id IS NULL THEN
    RETURN QUERY SELECT 'skipped'::text,
      'Proof prerequisite profile not present; proof block skipped during clean replay.'::text;
    RETURN;
  END IF;

  INSERT INTO organizations (id, name) VALUES
    (v_initiator_org, 'PROOF-INITIATOR-' || v_initiator_org),
    (v_temp_org,      'PROOF-TEMPSWAP-'  || v_temp_org);

  INSERT INTO matches (id, org_id, buyer_org_id, seller_org_id, match_type, commodity, status, hash)
  VALUES (v_match_id, v_initiator_org, v_initiator_org, NULL,
          'bid', 'PROOF cascade', 'matched', 'h-' || gen_random_uuid()::text);

  INSERT INTO poi_engagements (id, match_id, org_id, counterparty_email,
                               counterparty_org_id, counterparty_type, engagement_status)
  VALUES (v_engagement_id, v_match_id, v_initiator_org, v_dove_email,
          NULL, 'unknown', 'notification_sent');

  RETURN QUERY SELECT 'before'::text,
    format('eng.org=%s match.seller=%s',
      COALESCE((SELECT counterparty_org_id::text FROM poi_engagements WHERE id=v_engagement_id),'NULL'),
      COALESCE((SELECT seller_org_id::text FROM matches WHERE id=v_match_id),'NULL'));

  -- THE EVENT: swap Dove's org_id to a temp org -> trigger fires.
  -- (Both old and new are non-NULL; the trigger condition is OLD IS DISTINCT FROM NEW)
  UPDATE profiles SET org_id = v_temp_org WHERE id = v_dove_id;

  -- Now the engagement should be bound to v_temp_org (because v_temp_org is what
  -- Dove's profile carried at the moment the trigger fired)
  SELECT counterparty_org_id INTO v_engagement_org FROM poi_engagements WHERE id = v_engagement_id;
  SELECT seller_org_id INTO v_match_seller FROM matches WHERE id = v_match_id;

  RETURN QUERY SELECT 'after_swap_to_temp'::text,
    format('eng.org=%s match.seller=%s',
           COALESCE(v_engagement_org::text,'NULL'),
           COALESCE(v_match_seller::text,'NULL'));
  RETURN QUERY SELECT 'expected_temp_org'::text, v_temp_org::text;

  SELECT COUNT(*) INTO v_audit_count
    FROM admin_audit_logs
   WHERE target_id IN (v_engagement_id, v_match_id);
  RETURN QUERY SELECT 'audit_count'::text, v_audit_count::text;

  RETURN QUERY
    SELECT 'audit'::text,
           format('action=%s target=%s side=%s email=%s trigger=%s',
                  action, target_id::text,
                  COALESCE(details->>'filled_side','-'),
                  COALESCE(details->>'matched_email','-'),
                  details->>'trigger')
      FROM admin_audit_logs
     WHERE target_id IN (v_engagement_id, v_match_id)
     ORDER BY created_at;

  -- Restore Dove first, then cleanup synthetic noise
  UPDATE profiles SET org_id = v_dove_orig_org WHERE id = v_dove_id;

  DELETE FROM admin_audit_logs WHERE target_id IN (v_engagement_id, v_match_id);
  DELETE FROM poi_engagements WHERE id = v_engagement_id;
  DELETE FROM matches WHERE id = v_match_id;
  DELETE FROM organizations WHERE id IN (v_initiator_org, v_temp_org);

  RETURN QUERY SELECT 'dove_org_restored'::text,
    (SELECT org_id::text FROM profiles WHERE id = v_dove_id);
  RETURN QUERY SELECT 'dove_org_expected'::text, v_dove_orig_org::text;
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public._proof_test_backfill_trigger_v3() LOOP
    RAISE NOTICE 'PROOF | % | %', r.step, r.detail;
  END LOOP;
END $$;

DROP FUNCTION public._proof_test_backfill_trigger_v3();
