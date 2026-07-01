-- Batch J2 rollback-only proof.
-- Verifies public.assert_match_document_sealed_immutability blocks UPDATE/DELETE
-- on match_documents rows referenced by sealed, non-revoked WaD evidence bundles,
-- and allows mutation on unreferenced/unsealed/revoked-only cases.
--
-- All work happens inside a single transaction that is rolled back at the end.
-- Requires privileges to insert into public.matches, public.match_documents,
-- and public.wads. If those privileges are unavailable in the runtime, treat
-- this proof as pending and rely on the static guard.

BEGIN;

DO $proof$
DECLARE
  v_org uuid := gen_random_uuid();
  v_match uuid := gen_random_uuid();
  v_doc_sealed uuid := gen_random_uuid();
  v_doc_unsealed uuid := gen_random_uuid();
  v_doc_revoked uuid := gen_random_uuid();
  v_doc_dup uuid := gen_random_uuid();
  v_hash text := 'deadbeef00000000000000000000000000000000000000000000000000000001';
  v_hash_dup text := 'deadbeef00000000000000000000000000000000000000000000000000000002';
  v_wad_sealed uuid := gen_random_uuid();
  v_wad_unsealed uuid := gen_random_uuid();
  v_wad_revoked uuid := gen_random_uuid();
  v_err text;
BEGIN
  -- Minimal fixture rows (schemas allow the columns referenced). Any additional
  -- NOT NULL columns will surface here as an error and the proof will report it.

  INSERT INTO public.matches (id, buyer_org_id, seller_org_id, status)
    VALUES (v_match, v_org, v_org, 'active');

  INSERT INTO public.match_documents (id, match_id, org_id, doc_type, filename, storage_path, sha256_hash, status, is_current_version, version, root_document_id)
    VALUES
      (v_doc_sealed,   v_match, v_org, 'other', 'a.pdf', 'p/a', v_hash,     'uploaded', true, 1, v_doc_sealed),
      (v_doc_unsealed, v_match, v_org, 'other', 'b.pdf', 'p/b', v_hash_dup, 'uploaded', true, 1, v_doc_unsealed),
      (v_doc_revoked,  v_match, v_org, 'other', 'c.pdf', 'p/c', v_hash_dup, 'uploaded', true, 1, v_doc_revoked),
      (v_doc_dup,      v_match, v_org, 'other', 'd.pdf', 'p/d', v_hash,     'uploaded', true, 1, v_doc_dup); -- duplicate hash of sealed doc

  INSERT INTO public.wads (id, poi_id, sealed_at, revoked_at, evidence_bundle)
    VALUES
      (v_wad_sealed,   v_match, now(), NULL,
        jsonb_build_object('documents', jsonb_build_array(jsonb_build_object('id', v_doc_sealed, 'sha256_hash', v_hash)))),
      (v_wad_unsealed, v_match, NULL, NULL,
        jsonb_build_object('documents', jsonb_build_array(jsonb_build_object('id', v_doc_unsealed)))),
      (v_wad_revoked,  v_match, now(), now(),
        jsonb_build_object('documents', jsonb_build_array(jsonb_build_object('id', v_doc_revoked))));

  -- 1. sealed reference blocks UPDATE
  BEGIN
    UPDATE public.match_documents SET title = 'nope' WHERE id = v_doc_sealed;
    RAISE EXCEPTION 'PROOF FAIL: sealed doc UPDATE was not blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%sealed_match_document_immutable%' THEN
      RAISE EXCEPTION 'PROOF FAIL: wrong error marker: %', v_err;
    END IF;
  END;

  -- 2. sealed reference blocks DELETE
  BEGIN
    DELETE FROM public.match_documents WHERE id = v_doc_sealed;
    RAISE EXCEPTION 'PROOF FAIL: sealed doc DELETE was not blocked';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%sealed_match_document_immutable%' THEN
      RAISE EXCEPTION 'PROOF FAIL: wrong error marker: %', v_err;
    END IF;
  END;

  -- 3. unreferenced doc (never in any bundle) — but v_doc_dup shares hash only
  --    with sealed doc. It must NOT be treated as sealed.
  UPDATE public.match_documents SET title = 'ok-hash-dup' WHERE id = v_doc_dup;
  DELETE FROM public.match_documents WHERE id = v_doc_dup;

  -- 4. doc referenced only by unsealed WaD: UPDATE/DELETE allowed
  UPDATE public.match_documents SET title = 'ok-unsealed' WHERE id = v_doc_unsealed;
  DELETE FROM public.match_documents WHERE id = v_doc_unsealed;

  -- 5. doc referenced by revoked WaD only: UPDATE/DELETE allowed
  UPDATE public.match_documents SET title = 'ok-revoked' WHERE id = v_doc_revoked;
  DELETE FROM public.match_documents WHERE id = v_doc_revoked;

  -- 6. storage deletion trigger still present
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.match_documents'::regclass
      AND tgname = 'trg_match_documents_cleanup'
  ) THEN
    RAISE EXCEPTION 'PROOF FAIL: storage cleanup trigger missing';
  END IF;

  RAISE NOTICE 'BATCH_J2 PROOF OK';
END
$proof$;

ROLLBACK;
