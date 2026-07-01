-- Batch B3 — WaD attestation sealed-parent immutability proof.
--
-- Rollback-only. Requires a role with UPDATE/DELETE on
-- public.wad_attestations and public.wads (owner / service_role / CI
-- privileged test role). Sandbox roles without those privileges will
-- hit the RLS/privilege check before the trigger — record that as
-- "pending privileged verification" rather than failure.
--
-- Strategy:
--   Build an ephemeral WaD + attestation fixture inside the transaction
--   using an existing matches row for the FK, verify pre-seal edits are
--   allowed, seal the parent, then verify post-seal UPDATE/DELETE are
--   blocked and DELETE of the sealed parent is blocked by C10.

BEGIN;

DO $proof$
DECLARE
  v_wad       uuid;
  v_att       uuid;
  v_match     uuid;
  v_org       uuid;
  v_user      uuid;
  v_pre_count int;
  v_post_count int;
BEGIN
  SELECT count(*) INTO v_pre_count FROM public.wad_attestations;

  SELECT m.id, m.org_id INTO v_match, v_org FROM public.matches m LIMIT 1;
  IF v_match IS NULL THEN
    RAISE NOTICE 'PROOF_SKIPPED: no matches row to satisfy wads.poi_id FK';
    RETURN;
  END IF;

  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'PROOF_SKIPPED: no auth.users row to satisfy wad_attestations.user_id';
    RETURN;
  END IF;

  INSERT INTO public.wads (poi_id, org_id, status, canonical_payload_json, evidence_bundle)
  VALUES (v_match, v_org, 'draft', '{"k":"v"}'::jsonb, '{}'::jsonb)
  RETURNING id INTO v_wad;

  INSERT INTO public.wad_attestations
    (wad_id, user_id, org_id, role, attested_name)
  VALUES
    (v_wad, v_user, v_org, 'buyer', 'B3 Proof Signer')
  RETURNING id INTO v_att;

  -- (1) pre-seal UPDATE allowed
  UPDATE public.wad_attestations SET attested_name = 'B3 Proof Signer v2' WHERE id = v_att;
  RAISE NOTICE 'pre-seal UPDATE: allowed (PASS)';

  -- (2) pre-seal DELETE allowed (then re-insert for post-seal tests)
  DELETE FROM public.wad_attestations WHERE id = v_att;
  RAISE NOTICE 'pre-seal DELETE: allowed (PASS)';

  INSERT INTO public.wad_attestations
    (id, wad_id, user_id, org_id, role, attested_name)
  VALUES
    (v_att, v_wad, v_user, v_org, 'buyer', 'B3 Proof Signer sealed');

  -- Seal the parent WaD (allowed under C10 because OLD.sealed_at IS NULL)
  UPDATE public.wads
     SET status = 'sealed',
         seal_hash = 'b3_proof_hash',
         sealed_at = now(),
         ledger_entry_hash = 'b3_leh',
         prev_ledger_entry_hash = 'b3_pleh'
   WHERE id = v_wad;

  -- (3) post-seal UPDATE blocked
  BEGIN
    UPDATE public.wad_attestations SET attested_name = 'tamper' WHERE id = v_att;
    RAISE EXCEPTION 'PROOF_FAIL: post-seal UPDATE was not blocked';
  EXCEPTION WHEN check_violation THEN
    IF position('wad_attestation_sealed_parent_immutable' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'PROOF_FAIL: post-seal UPDATE raised wrong message: %', SQLERRM;
    END IF;
    RAISE NOTICE 'post-seal UPDATE: blocked (PASS)';
  END;

  -- (4) post-seal DELETE blocked
  BEGIN
    DELETE FROM public.wad_attestations WHERE id = v_att;
    RAISE EXCEPTION 'PROOF_FAIL: post-seal DELETE was not blocked';
  EXCEPTION WHEN check_violation THEN
    IF position('wad_attestation_sealed_parent_immutable' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'PROOF_FAIL: post-seal DELETE raised wrong message: %', SQLERRM;
    END IF;
    RAISE NOTICE 'post-seal DELETE: blocked (PASS)';
  END;

  -- (5) sealed parent WaD DELETE still blocked by C10 (prevents cascade path)
  BEGIN
    DELETE FROM public.wads WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF_FAIL: C10 did not block sealed parent DELETE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN
      RAISE EXCEPTION 'PROOF_FAIL: sealed parent DELETE raised unexpected: %', SQLERRM;
    END IF;
    RAISE NOTICE 'C10 sealed parent DELETE: blocked (PASS)';
  END;

  RAISE NOTICE 'Batch B3 wad_attestation sealed-parent immutability proof: PASS';
END
$proof$;

ROLLBACK;

-- Post-rollback sanity
SELECT count(*) AS wad_attestations_count_after_rollback FROM public.wad_attestations;
