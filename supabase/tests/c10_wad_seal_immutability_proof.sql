-- C10 — Sealed WaD metadata immutability proof.
--
-- Manual / CI proof. Wrap in a transaction and ROLLBACK at the end so no
-- existing business data is mutated. Run as a superuser / service-role
-- connection so the trigger fires (it must fire for all roles).
--
-- Usage:
--   psql -f supabase/tests/c10_wad_seal_immutability_proof.sql
--
-- Asserts:
--   1. Unsealed WaD updates remain allowed (status, payload, etc.).
--   2. Updating sealed core fields raises sealed_wad_immutable.
--   3. Updating canonical_payload_json on a sealed WaD raises.
--   4. Updating evidence_bundle on a sealed WaD raises.
--   5. Updating seal_hash on a sealed WaD raises.
--   6. Updating ledger hash fields on a sealed WaD raises.
--   7. Deleting a sealed WaD raises.
--   8. Allowlisted revocation/supersession updates still succeed.
--   9. Trigger fires for service-role (no bypass).

BEGIN;

-- Fresh ephemeral WaD; rolled back at the end of this script.
DO $$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_poi   uuid := gen_random_uuid();
  v_wad   uuid;
  v_raised boolean;
BEGIN
  INSERT INTO public.wads (
    poi_id, org_id, status, canonical_payload_json, evidence_bundle, created_at, updated_at
  ) VALUES (
    v_poi, v_org, 'draft', '{"k":"v"}'::jsonb, '{}'::jsonb, now(), now()
  )
  RETURNING id INTO v_wad;

  -- (1) Unsealed update allowed.
  UPDATE public.wads
     SET canonical_payload_json = '{"k":"v2"}'::jsonb
   WHERE id = v_wad;

  -- Promote to sealed (this UPDATE itself must succeed because OLD.sealed_at IS NULL).
  UPDATE public.wads
     SET status        = 'sealed',
         seal_hash     = 'h_test',
         sealed_at     = now()
   WHERE id = v_wad;

  -- (2-6) Each protected mutation must raise sealed_wad_immutable.
  BEGIN
    UPDATE public.wads SET canonical_payload_json = '{"x":1}'::jsonb WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: canonical_payload_json update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.wads SET evidence_bundle = '{"y":1}'::jsonb WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: evidence_bundle update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.wads SET seal_hash = 'tampered' WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: seal_hash update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.wads SET ledger_entry_hash = 'tampered' WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: ledger_entry_hash update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.wads SET prev_ledger_entry_hash = 'tampered' WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: prev_ledger_entry_hash update was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
  END;

  -- (7) DELETE of sealed row blocked.
  BEGIN
    DELETE FROM public.wads WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: DELETE on sealed WaD was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
  END;

  -- (8) Allowlisted revocation/supersession + certificate updates succeed.
  UPDATE public.wads
     SET status         = 'revoked',
         revoked_at     = now(),
         revoked_by     = v_org,
         revoked_reason = 'proof test'
   WHERE id = v_wad;

  UPDATE public.wads
     SET certificate_generated_at = now(),
         certificate_path         = 'wads/proof.pdf'
   WHERE id = v_wad;

  RAISE NOTICE 'C10 wad seal immutability proof: PASS';
END$$;

ROLLBACK;
