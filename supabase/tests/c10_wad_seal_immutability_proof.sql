-- C10 — Sealed WaD metadata immutability privileged rollback proof.
--
-- Run as a role with UPDATE/DELETE on public.wads (service-role / owner /
-- CI privileged test role). Wrapped in BEGIN; ... ROLLBACK; — nothing persists.
--
-- Usage:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/c10_wad_seal_immutability_proof.sql
--
-- Strategy:
--   Prefer an EXISTING sealed WaD as the test subject (zero new rows).
--   Only if none exists, build an ephemeral fixture inside the same
--   transaction by reusing real existing FK targets (matches/organizations).
--   Either way the transaction is rolled back at the end.

BEGIN;

DO $$
DECLARE
  v_wad        uuid;
  v_match      uuid;
  v_org        uuid;
  v_ephemeral  boolean := false;
  v_count_pre  int;
  v_count_post int;
  v_expected   int;
BEGIN
  SELECT count(*) INTO v_count_pre FROM public.wads;

  SELECT id INTO v_wad FROM public.wads WHERE sealed_at IS NOT NULL LIMIT 1;

  IF v_wad IS NULL THEN
    v_ephemeral := true;
    SELECT m.id, m.org_id INTO v_match, v_org FROM public.matches m LIMIT 1;
    IF v_match IS NULL THEN
      RAISE EXCEPTION 'PROOF SKIPPED: no matches row available to satisfy wads_poi_id_fkey';
    END IF;
    INSERT INTO public.wads (poi_id, org_id, status, canonical_payload_json, evidence_bundle)
    VALUES (v_match, v_org, 'draft', '{"k":"v"}'::jsonb, '{}'::jsonb)
    RETURNING id INTO v_wad;

    -- (1) Unsealed update allowed.
    UPDATE public.wads SET canonical_payload_json = '{"k":"v2"}'::jsonb WHERE id = v_wad;
    RAISE NOTICE 'unsealed update: allowed (PASS)';

    -- (2) Seal transition allowed.
    UPDATE public.wads
       SET status='sealed', seal_hash='h_proof', sealed_at=now(),
           ledger_entry_hash='leh_proof', prev_ledger_entry_hash='pleh_proof'
     WHERE id = v_wad;
    RAISE NOTICE 'seal transition: allowed (PASS)';
  END IF;

  RAISE NOTICE 'subject wad=% ephemeral=%', v_wad, v_ephemeral;

  -- (3a) protected: canonical_payload_json
  BEGIN
    UPDATE public.wads SET canonical_payload_json='{"tamper":1}'::jsonb WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: canonical_payload_json not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
    RAISE NOTICE 'protected canonical_payload_json: blocked (PASS)';
  END;

  -- (3b) protected: evidence_bundle
  BEGIN
    UPDATE public.wads SET evidence_bundle='{"tamper":1}'::jsonb WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: evidence_bundle not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
    RAISE NOTICE 'protected evidence_bundle: blocked (PASS)';
  END;

  -- (3c) protected: seal_hash
  BEGIN
    UPDATE public.wads SET seal_hash='tampered' WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: seal_hash not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
    RAISE NOTICE 'protected seal_hash: blocked (PASS)';
  END;

  -- (3d) protected: ledger_entry_hash
  BEGIN
    UPDATE public.wads SET ledger_entry_hash='tampered' WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: ledger_entry_hash not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
    RAISE NOTICE 'protected ledger_entry_hash: blocked (PASS)';
  END;

  -- (3e) protected: prev_ledger_entry_hash
  BEGIN
    UPDATE public.wads SET prev_ledger_entry_hash='tampered' WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: prev_ledger_entry_hash not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
    RAISE NOTICE 'protected prev_ledger_entry_hash: blocked (PASS)';
  END;

  -- (4) sealed DELETE blocked
  BEGIN
    DELETE FROM public.wads WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: DELETE not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
    RAISE NOTICE 'sealed DELETE: blocked (PASS)';
  END;

  -- (5) allowlisted updates succeed
  UPDATE public.wads
     SET certificate_generated_at = now(),
         certificate_path         = 'wads/proof.pdf'
   WHERE id = v_wad;
  RAISE NOTICE 'allowlisted certificate fields: allowed (PASS)';

  UPDATE public.wads
     SET status='revoked', revoked_at=now(), revoked_reason='c10 proof — rollback only'
   WHERE id = v_wad;
  RAISE NOTICE 'allowlisted revoke fields: allowed (PASS)';

  SELECT count(*) INTO v_count_post FROM public.wads;
  v_expected := v_count_pre + CASE WHEN v_ephemeral THEN 1 ELSE 0 END;
  IF v_count_post <> v_expected THEN
    RAISE EXCEPTION 'PROOF FAILED: wads count drift pre=% post=% expected=%',
      v_count_pre, v_count_post, v_expected;
  END IF;

  RAISE NOTICE 'C10 wad seal immutability privileged proof: PASS';
END$$;

ROLLBACK;

-- Post-rollback sanity
SELECT count(*) AS wads_count_after_rollback FROM public.wads;
SELECT count(*) AS sealed_count_after_rollback FROM public.wads WHERE sealed_at IS NOT NULL;
