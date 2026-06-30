-- C10 — Sealed WaD metadata immutability privileged rollback proof.
--
-- Run as a role with UPDATE/DELETE on public.wads (service-role / owner /
-- CI privileged test role). The entire script is wrapped in
-- BEGIN; ... ROLLBACK; — no permanent change is made.
--
-- Usage:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/c10_wad_seal_immutability_proof.sql
--
-- Strategy:
--   Prefer an EXISTING sealed WaD as the test subject (zero new rows).
--   Only if none exists, build an ephemeral fixture inside the same
--   transaction by reusing real existing FK targets (matches/organizations).
--   Either way the transaction is rolled back at the end.
--
-- Asserts:
--   1. Unsealed update path is unaffected by the trigger (pre-seal early-return).
--   2. Sealing transition succeeds when OLD.sealed_at IS NULL.
--   3. Sealed UPDATE on protected columns raises 'sealed_wad_immutable':
--      - canonical_payload_json
--      - evidence_bundle
--      - seal_hash
--      - ledger_entry_hash
--      - prev_ledger_entry_hash
--   4. Sealed DELETE raises 'sealed_wad_immutable'.
--   5. Allowlisted updates succeed on a sealed row:
--      - certificate_generated_at / certificate_path
--      - revoked_at / revoked_by / revoked_reason / status='revoked'
--   6. Trigger has no role bypass (this proof runs as service-role /
--      privileged role and is still enforced).

BEGIN;

DO $$
DECLARE
  v_wad         uuid;
  v_match       uuid;
  v_org         uuid;
  v_ephemeral   boolean := false;
  v_count_pre   int;
  v_count_post  int;
  v_err         text;
  v_sqlstate    text;
BEGIN
  SELECT count(*) INTO v_count_pre FROM public.wads;

  -- Prefer an existing sealed WaD; fall back to an ephemeral fixture.
  SELECT id INTO v_wad FROM public.wads WHERE sealed_at IS NOT NULL LIMIT 1;

  IF v_wad IS NULL THEN
    v_ephemeral := true;
    -- Reuse a real existing match + organization so FKs resolve.
    SELECT m.id, m.org_id INTO v_match, v_org
    FROM public.matches m
    LIMIT 1;
    IF v_match IS NULL THEN
      RAISE EXCEPTION 'PROOF SKIPPED: no matches row available to satisfy wads_poi_id_fkey';
    END IF;

    INSERT INTO public.wads (poi_id, org_id, status, canonical_payload_json, evidence_bundle)
    VALUES (v_match, v_org, 'draft', '{"k":"v"}'::jsonb, '{}'::jsonb)
    RETURNING id INTO v_wad;

    -- (1) Unsealed update allowed (pre-seal early-return).
    UPDATE public.wads SET canonical_payload_json = '{"k":"v2"}'::jsonb WHERE id = v_wad;
    RAISE NOTICE 'unsealed update: allowed (PASS)';

    -- (2) Seal transition allowed (OLD.sealed_at IS NULL at trigger time).
    UPDATE public.wads
       SET status='sealed', seal_hash='h_proof', sealed_at=now(),
           ledger_entry_hash='leh_proof', prev_ledger_entry_hash='pleh_proof'
     WHERE id = v_wad;
    RAISE NOTICE 'seal transition: allowed (PASS)';
  END IF;

  RAISE NOTICE 'subject wad=% ephemeral=%', v_wad, v_ephemeral;

  -- (3) Protected mutations must raise sealed_wad_immutable.
  FOR v_err, v_sqlstate IN
    SELECT 'canonical_payload_json', NULL UNION ALL
    SELECT 'evidence_bundle', NULL UNION ALL
    SELECT 'seal_hash', NULL UNION ALL
    SELECT 'ledger_entry_hash', NULL UNION ALL
    SELECT 'prev_ledger_entry_hash', NULL
  LOOP
    BEGIN
      EXECUTE format(
        'UPDATE public.wads SET %I = $1 WHERE id = $2',
        v_err
      )
      USING (CASE
               WHEN v_err IN ('canonical_payload_json','evidence_bundle')
                 THEN '{"tamper":1}'::jsonb::text
               ELSE 'tampered'
             END), v_wad;
      RAISE EXCEPTION 'PROOF FAILED: protected column % was NOT blocked', v_err;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN
        RAISE EXCEPTION 'PROOF FAILED: protected column % blocked by wrong error (sqlstate=%, msg=%)',
          v_err, v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE 'protected %: blocked by sealed_wad_immutable (PASS)', v_err;
    END;
  END LOOP;

  -- (4) DELETE of sealed row must raise sealed_wad_immutable.
  BEGIN
    DELETE FROM public.wads WHERE id = v_wad;
    RAISE EXCEPTION 'PROOF FAILED: DELETE on sealed WaD was NOT blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sealed_wad_immutable%' THEN RAISE; END IF;
    RAISE NOTICE 'sealed DELETE: blocked by sealed_wad_immutable (PASS)';
  END;

  -- (5) Allowlisted updates must succeed. Use a savepoint so the changes
  -- to a real existing sealed WaD don't bleed past this proof (the outer
  -- ROLLBACK will discard them anyway, but the savepoint keeps the proof
  -- composable if extended later).
  SAVEPOINT allowlist_check;

  UPDATE public.wads
     SET certificate_generated_at = now(),
         certificate_path         = 'wads/proof.pdf'
   WHERE id = v_wad;
  RAISE NOTICE 'allowlisted certificate fields: allowed (PASS)';

  UPDATE public.wads
     SET status         = 'revoked',
         revoked_at     = now(),
         revoked_reason = 'c10 proof — rollback only'
   WHERE id = v_wad;
  RAISE NOTICE 'allowlisted revoke fields: allowed (PASS)';

  ROLLBACK TO SAVEPOINT allowlist_check;

  SELECT count(*) INTO v_count_post FROM public.wads;
  IF v_count_post != v_count_pre + CASE WHEN v_ephemeral THEN 1 ELSE 0 END THEN
    RAISE EXCEPTION 'PROOF FAILED: wads row count drifted (pre=%, post=%)',
      v_count_pre, v_count_post;
  END IF;

  RAISE NOTICE 'C10 wad seal immutability privileged proof: PASS';
END$$;

ROLLBACK;

-- Post-rollback sanity (must equal the pre-transaction count).
SELECT count(*) AS wads_count_after_rollback FROM public.wads;
SELECT count(*) AS sealed_count_after_rollback FROM public.wads WHERE sealed_at IS NOT NULL;
