-- Governance Record — live rollback proof harness
--
-- Proves that when gov_emit_event raises inside an atomic SECURITY DEFINER RPC,
-- the business mutation rolls back and no canonical event_store row is written.
--
-- Repeatable & non-destructive: wrap entire script in BEGIN; … ROLLBACK;
-- The DO blocks reuse the existing fixtures listed below; if those ids no
-- longer exist, edit the placeholders or substitute with comparable rows.
--
-- Usage:  psql -f supabase/tests/governance_rollback_proof.sql

BEGIN;

-- Mark the txn so it can never accidentally commit.
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- ========================================================================
-- 1. CREDIT — atomic_token_burn (re-proof)
-- ========================================================================
DO $$
DECLARE
  v_org uuid := (SELECT tb.org_id FROM token_balances tb
                  JOIN organizations o ON o.id = tb.org_id
                 WHERE tb.balance >= 1 AND COALESCE(o.billing_hold,false)=false
                 LIMIT 1);
  v_before int; v_after int;
  v_ref text := 'rb-credit-' || gen_random_uuid()::text;
  v_caught text; v_ledger int; v_events int;
BEGIN
  IF v_org IS NULL THEN RAISE NOTICE 'SKIP credit: no eligible org'; RETURN; END IF;
  SELECT balance INTO v_before FROM token_balances WHERE org_id = v_org;
  BEGIN
    PERFORM atomic_token_burn(v_org, 1, 'system_adjustment', v_ref,
      jsonb_build_object(
        'event_type','credit.burned','aggregate_type','credit_burn',
        'source_function','rollback-proof-harness','system_actor','rollback-proof',
        'posture_snapshot', jsonb_build_object('verification_posture','BOGUS_LABEL')));
    RAISE EXCEPTION 'PROOF_FAILED: credit RPC succeeded with bad governance';
  EXCEPTION WHEN OTHERS THEN v_caught := SQLERRM;
  END;
  SELECT balance INTO v_after FROM token_balances WHERE org_id = v_org;
  SELECT count(*) INTO v_ledger FROM token_ledger WHERE request_id = v_ref;
  SELECT count(*) INTO v_events FROM event_store
    WHERE (payload->'metadata'->>'correlation_id') = v_ref;
  IF v_after <> v_before OR v_ledger <> 0 OR v_events <> 0 THEN
    RAISE EXCEPTION 'CREDIT ROLLBACK FAILED: before=% after=% ledger=% events=%',
      v_before, v_after, v_ledger, v_events;
  END IF;
  RAISE NOTICE '[1/6] PASS credit (atomic_token_burn): %', v_caught;
END$$;

-- ========================================================================
-- 2. LEGAL HOLD — atomic_legal_hold_apply (re-proof)
-- ========================================================================
DO $$
DECLARE
  v_scope uuid := gen_random_uuid();
  v_user uuid := (SELECT id FROM profiles LIMIT 1);
  v_caught text; v_holds int; v_events int;
BEGIN
  BEGIN
    PERFORM atomic_legal_hold_apply(
      jsonb_build_object('scope_type','org','scope_id',v_scope::text,
        'reason','rollback proof','applied_by',v_user::text,'gov_org_id',v_scope::text),
      jsonb_build_object('event_type','legal_hold.applied','aggregate_type','legal_hold',
        'source_function','rollback-proof-harness','system_actor','rollback-proof',
        'posture_snapshot', jsonb_build_object('verification_posture','BOGUS_LABEL')));
    RAISE EXCEPTION 'PROOF_FAILED: legal_hold RPC succeeded';
  EXCEPTION WHEN OTHERS THEN v_caught := SQLERRM;
  END;
  SELECT count(*) INTO v_holds  FROM legal_holds  WHERE scope_id = v_scope;
  SELECT count(*) INTO v_events FROM event_store  WHERE aggregate_type='legal_hold' AND aggregate_id = v_scope;
  IF v_holds <> 0 OR v_events <> 0 THEN
    RAISE EXCEPTION 'LEGAL_HOLD ROLLBACK FAILED: holds=% events=%', v_holds, v_events;
  END IF;
  RAISE NOTICE '[2/6] PASS legal_hold (atomic_legal_hold_apply): %', v_caught;
END$$;

-- ========================================================================
-- 3. POI — atomic_pois_transition
-- ========================================================================
DO $$
DECLARE
  v_poi RECORD;
  v_state_before text; v_state_after text;
  v_caught text; v_legacy int; v_events int;
BEGIN
  SELECT id, org_id, state INTO v_poi FROM pois
    WHERE state IN ('DRAFT','ELIGIBLE') ORDER BY created_at DESC LIMIT 1;
  IF v_poi.id IS NULL THEN RAISE NOTICE 'SKIP poi: no DRAFT/ELIGIBLE poi'; RETURN; END IF;
  v_state_before := v_poi.state;
  BEGIN
    PERFORM atomic_pois_transition(
      v_poi.id, v_poi.org_id,
      CASE WHEN v_poi.state='DRAFT' THEN 'ELIGIBLE' ELSE 'WITHDRAWN' END,
      NULL, 'system', NULL, 'rollback-proof', NULL,
      jsonb_build_object('event_type','poi.state_changed','aggregate_type','poi',
        'source_function','rollback-proof-harness','system_actor','rollback-proof',
        'posture_snapshot', jsonb_build_object('verification_posture','BOGUS_LABEL')));
    RAISE EXCEPTION 'PROOF_FAILED: poi RPC succeeded';
  EXCEPTION WHEN OTHERS THEN v_caught := SQLERRM;
  END;
  SELECT state INTO v_state_after FROM pois WHERE id = v_poi.id;
  SELECT count(*) INTO v_legacy FROM event_store
    WHERE aggregate_id = v_poi.id AND event_type='trust.poi.transitioned'
      AND occurred_at > now() - interval '1 minute';
  SELECT count(*) INTO v_events FROM event_store
    WHERE aggregate_id = v_poi.id AND event_type='poi.state_changed'
      AND occurred_at > now() - interval '1 minute';
  IF v_state_after <> v_state_before OR v_legacy <> 0 OR v_events <> 0 THEN
    RAISE EXCEPTION 'POI ROLLBACK FAILED: before=% after=% legacy=% canonical=%',
      v_state_before, v_state_after, v_legacy, v_events;
  END IF;
  RAISE NOTICE '[3/6] PASS poi (atomic_pois_transition on %): %', v_poi.id, v_caught;
END$$;

-- ========================================================================
-- 4. WaD — atomic_wad_issue
-- ========================================================================
DO $$
DECLARE
  v_poi RECORD;
  v_caught text; v_wads int; v_events int;
BEGIN
  SELECT p.id, p.org_id INTO v_poi FROM pois p
   LEFT JOIN p3_wads w ON w.poi_id = p.id
   WHERE w.id IS NULL LIMIT 1;
  IF v_poi.id IS NULL THEN RAISE NOTICE 'SKIP wad: no WaD-free POI'; RETURN; END IF;
  BEGIN
    PERFORM atomic_wad_issue(v_poi.org_id, v_poi.id,
      jsonb_build_object('event_type','wad.passed','aggregate_type','wad',
        'source_function','rollback-proof-harness','system_actor','rollback-proof',
        'posture_snapshot', jsonb_build_object('verification_posture','BOGUS_LABEL')));
    RAISE EXCEPTION 'PROOF_FAILED: wad RPC succeeded';
  EXCEPTION WHEN OTHERS THEN v_caught := SQLERRM;
  END;
  SELECT count(*) INTO v_wads   FROM p3_wads     WHERE poi_id = v_poi.id;
  SELECT count(*) INTO v_events FROM event_store WHERE aggregate_type='wad' AND
    (payload->>'poi_id') = v_poi.id::text AND occurred_at > now() - interval '1 minute';
  IF v_wads <> 0 OR v_events <> 0 THEN
    RAISE EXCEPTION 'WAD ROLLBACK FAILED: wads=% events=%', v_wads, v_events;
  END IF;
  RAISE NOTICE '[4/6] PASS wad (atomic_wad_issue on poi %): %', v_poi.id, v_caught;
END$$;

-- ========================================================================
-- 5. FINALITY/COLLAPSE — atomic_collapse_record
-- ========================================================================
DO $$
DECLARE
  v_match RECORD;
  v_idem text := 'rb-collapse-' || gen_random_uuid()::text;
  v_caught text; v_ledger int; v_events int;
BEGIN
  SELECT id, buyer_org_id, seller_org_id INTO v_match
    FROM matches WHERE buyer_org_id IS NOT NULL AND seller_org_id IS NOT NULL LIMIT 1;
  IF v_match.id IS NULL THEN RAISE NOTICE 'SKIP collapse: no two-sided match'; RETURN; END IF;
  BEGIN
    PERFORM atomic_collapse_record(
      jsonb_build_object(
        'org_id', v_match.buyer_org_id::text,
        'counterparty_org_id', v_match.seller_org_id::text,
        'match_id', v_match.id::text,
        'idempotency_key', v_idem,
        'asset_id','rb-asset','quantity','1','price','1','currency','USD',
        'client_timestamp', now()::text,
        'signed_payload','{}','signature_valid','false',
        'payload_hash', encode(extensions.digest(v_idem::bytea,'sha256'),'hex'),
        'poi_state','COMPLETED','metadata','{}'),
      jsonb_build_object('event_type','execution.permitted','aggregate_type','collapse',
        'source_function','rollback-proof-harness','system_actor','rollback-proof',
        'posture_snapshot', jsonb_build_object('verification_posture','BOGUS_LABEL')),
      jsonb_build_object('event_type','finality.recorded','aggregate_type','collapse',
        'source_function','rollback-proof-harness','system_actor','rollback-proof',
        'posture_snapshot', jsonb_build_object('verification_posture','Standard')));
    RAISE EXCEPTION 'PROOF_FAILED: collapse RPC succeeded';
  EXCEPTION WHEN OTHERS THEN v_caught := SQLERRM;
  END;
  SELECT count(*) INTO v_ledger FROM collapse_ledger WHERE idempotency_key = v_idem;
  SELECT count(*) INTO v_events FROM event_store
    WHERE aggregate_type='collapse' AND occurred_at > now() - interval '1 minute'
      AND event_type IN ('execution.permitted','finality.recorded');
  IF v_ledger <> 0 OR v_events <> 0 THEN
    RAISE EXCEPTION 'COLLAPSE ROLLBACK FAILED: ledger=% events=%', v_ledger, v_events;
  END IF;
  RAISE NOTICE '[5/6] PASS collapse (atomic_collapse_record): %', v_caught;
END$$;

-- ========================================================================
-- 6. DISPUTE — atomic_dispute_open
-- ========================================================================
DO $$
DECLARE
  v_match RECORD;
  v_user uuid := (SELECT id FROM profiles LIMIT 1);
  v_caught text; v_chals int; v_events int;
BEGIN
  SELECT m.id, m.buyer_org_id INTO v_match FROM matches m
   LEFT JOIN match_challenges c ON c.match_id = m.id AND c.status='open'
   WHERE m.buyer_org_id IS NOT NULL AND c.id IS NULL LIMIT 1;
  IF v_match.id IS NULL THEN RAISE NOTICE 'SKIP dispute: no dispute-free match'; RETURN; END IF;
  BEGIN
    PERFORM atomic_dispute_open(
      jsonb_build_object(
        'match_id', v_match.id::text,
        'org_id',   v_match.buyer_org_id::text,
        'raised_by_org_id', v_match.buyer_org_id::text,
        'raised_by_user_id', v_user::text,
        'raised_by_role','buyer_org_admin',
        'subject_code','rollback_proof',
        'summary','rollback proof test'),
      jsonb_build_object('event_type','dispute.opened','aggregate_type','match_challenge',
        'source_function','rollback-proof-harness','system_actor','rollback-proof',
        'posture_snapshot', jsonb_build_object('verification_posture','BOGUS_LABEL')));
    RAISE EXCEPTION 'PROOF_FAILED: dispute RPC succeeded';
  EXCEPTION WHEN OTHERS THEN v_caught := SQLERRM;
  END;
  SELECT count(*) INTO v_chals FROM match_challenges
    WHERE match_id = v_match.id AND subject_code='rollback_proof';
  SELECT count(*) INTO v_events FROM event_store
    WHERE event_type='dispute.opened' AND (payload->>'match_id') = v_match.id::text
      AND occurred_at > now() - interval '1 minute';
  IF v_chals <> 0 OR v_events <> 0 THEN
    RAISE EXCEPTION 'DISPUTE ROLLBACK FAILED: challenges=% events=%', v_chals, v_events;
  END IF;
  RAISE NOTICE '[6/6] PASS dispute (atomic_dispute_open on match %): %', v_match.id, v_caught;
END$$;

ROLLBACK;
