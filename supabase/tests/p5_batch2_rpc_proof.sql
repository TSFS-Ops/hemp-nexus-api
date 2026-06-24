-- P-5 Batch 2 — Stage 3 RPC proof.
-- Runs inside a single transaction and ROLLS BACK at the end so no business
-- rows are mutated. Exercises every Stage 3 RPC and proves the constraints.

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_role_existed boolean;
  v_org uuid;
  v_record uuid;
  v_child uuid;
  v_item uuid;
  v_provider_item uuid;
  v_cond_item uuid;
  v_warn_item uuid;
  v_v1 uuid;
  v_v2 uuid;
  v_review_id uuid;
  v_pack jsonb;
  v_summary jsonb;
  v_violation_caught boolean := false;
  r jsonb;
BEGIN
  -- pick (or synthesise) an actor with platform_admin role
  SELECT user_id INTO v_user FROM public.user_roles WHERE role::text='platform_admin' LIMIT 1;
  IF v_user IS NULL THEN
    SELECT id INTO v_user FROM auth.users LIMIT 1;
    IF v_user IS NULL THEN
      RAISE NOTICE 'P5B2_STAGE3_PROOF_SKIPPED: no auth user available';
      ROLLBACK; RETURN;
    END IF;
    INSERT INTO public.user_roles(user_id, role) VALUES (v_user, 'platform_admin');
    v_role_existed := false;
  ELSE
    v_role_existed := true;
  END IF;

  -- impersonate v_user for SECURITY DEFINER auth.uid() checks
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  -- 1. create KYC record (org-less owner record is allowed)
  r := public.p5b2_create_kyc_record(
    p_record_type := 'company',
    p_display_name := 'Stage3 Proof Company',
    p_owner_user_id := v_user,
    p_correlation_id := 'p5b2-stage3-proof'
  );
  v_record := (r->>'record_id')::uuid;
  IF v_record IS NULL THEN RAISE EXCEPTION 'create_kyc_record returned null'; END IF;

  r := public.p5b2_create_kyc_record(
    p_record_type := 'director_officer',
    p_display_name := 'Stage3 Proof Director',
    p_owner_user_id := v_user
  );
  v_child := (r->>'record_id')::uuid;

  -- 2. link records (no cross-org because both are org-less)
  r := public.p5b2_link_records(v_record, v_child, 'director_of');
  IF r->>'link_id' IS NULL THEN RAISE EXCEPTION 'link_records returned null'; END IF;

  -- seed evidence items (we insert directly because there is no create_evidence_item RPC in Stage 3)
  INSERT INTO public.p5_batch2_evidence_items(record_id, category, requirement_level, status, supports, created_by, updated_by)
    VALUES (v_record, 'company', 'mandatory', 'missing', ARRAY['finality'], v_user, v_user) RETURNING id INTO v_item;
  INSERT INTO public.p5_batch2_evidence_items(record_id, category, requirement_level, status, supports, created_by, updated_by)
    VALUES (v_record, 'identity', 'conditional', 'missing', ARRAY['kyc'], v_user, v_user) RETURNING id INTO v_cond_item;
  INSERT INTO public.p5_batch2_evidence_items(record_id, category, requirement_level, status, supports, created_by, updated_by)
    VALUES (v_record, 'tax', 'mandatory', 'missing', ARRAY['compliance'], v_user, v_user) RETURNING id INTO v_warn_item;
  INSERT INTO public.p5_batch2_evidence_items(record_id, category, requirement_level, provider_dependency, status, supports, created_by, updated_by)
    VALUES (v_record, 'regulated', 'mandatory', true, 'missing', ARRAY['compliance'], v_user, v_user) RETURNING id INTO v_provider_item;

  -- 3. generate checklist
  v_summary := public.p5b2_generate_checklist(v_record);
  IF jsonb_array_length(v_summary->'missing_mandatory') < 1 THEN
    RAISE EXCEPTION 'checklist missing_mandatory empty';
  END IF;

  -- 4. upload evidence v1
  r := public.p5b2_upload_evidence_version(
    p_evidence_item_id := v_item,
    p_file_storage_path := 'stage3/proof/v1.pdf',
    p_file_hash := 'sha256:proof-v1',
    p_file_size_bytes := 1234,
    p_mime_type := 'application/pdf'
  );
  v_v1 := (r->>'version_id')::uuid;

  -- 5. reject with fixed reason
  r := public.p5b2_review_evidence(
    p_evidence_item_id := v_item,
    p_action := 'reject',
    p_rejection_reason := 'illegible_document',
    p_reviewer_note_internal := 'internal-only note',
    p_customer_safe_note := 'Please resubmit a clearer copy.'
  );
  IF r->>'new_status' <> 'rejected' THEN RAISE EXCEPTION 'reject did not set rejected'; END IF;

  -- 6. resubmit replacement with replacement_reason
  r := public.p5b2_upload_evidence_version(
    p_evidence_item_id := v_item,
    p_file_storage_path := 'stage3/proof/v2.pdf',
    p_file_hash := 'sha256:proof-v2',
    p_replacement_reason := 'rejected',
    p_replacement_note := 'clearer scan'
  );
  v_v2 := (r->>'version_id')::uuid;
  IF (r->>'replaced_previous')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'expected replaced_previous=true';
  END IF;

  -- 7. accept the replacement
  r := public.p5b2_review_evidence(v_item, 'accept', NULL, NULL, NULL, 'good');
  IF r->>'new_status' <> 'accepted' THEN RAISE EXCEPTION 'accept failed'; END IF;

  -- accept_with_warning on a different item
  PERFORM public.p5b2_upload_evidence_version(v_warn_item, 'stage3/proof/tax.pdf', 'sha256:tax-v1');
  r := public.p5b2_review_evidence(v_warn_item, 'accept_with_warning', NULL,
       NULL, 'Accepted with warning: document close to expiry.', 'acceptable');
  IF r->>'new_status' <> 'accepted_with_warning' THEN RAISE EXCEPTION 'accept_with_warning failed'; END IF;

  -- 8. waive conditional item
  r := public.p5b2_waive_evidence(v_cond_item, 'execution',
       'Not applicable for this transaction class.', (now() + interval '30 days'));
  IF r->>'waiver_id' IS NULL THEN RAISE EXCEPTION 'waiver insert failed'; END IF;

  -- 9. provider-dependent state, safe call
  r := public.p5b2_set_provider_state(
    p_evidence_item_id := v_provider_item,
    p_provider_status := 'provider_result_pending',
    p_provider_name := 'mock-provider',
    p_provider_live := false,
    p_provider_result_reference := NULL,
    p_reason := 'queued'
  );
  IF r->>'provider_status' <> 'provider_result_pending' THEN
    RAISE EXCEPTION 'set_provider_state did not update status';
  END IF;

  -- 10. prove provider_live=true without reference is BLOCKED
  v_violation_caught := false;
  BEGIN
    PERFORM public.p5b2_set_provider_state(
      p_evidence_item_id := v_provider_item,
      p_provider_status := 'manual_review_recorded_not_provider_verified',
      p_provider_live := true,
      p_provider_result_reference := NULL
    );
  EXCEPTION WHEN OTHERS THEN v_violation_caught := true;
  END;
  IF NOT v_violation_caught THEN
    RAISE EXCEPTION 'provider_live=true with NULL reference should have been blocked';
  END IF;

  -- 11. snapshot finality pack
  r := public.p5b2_snapshot_finality_pack(v_record, 'stage3-proof-finality');
  IF r->>'pack_id' IS NULL THEN RAISE EXCEPTION 'snapshot returned null pack'; END IF;
  v_pack := r;

  -- 12. log sensitive access (without exposing the sensitive value)
  r := public.p5b2_log_sensitive_access(
    p_access_kind := 'unmask',
    p_reason := 'Reviewing for compliance audit',
    p_evidence_item_id := v_item,
    p_version_id := v_v2,
    p_record_id := v_record
  );
  IF r->>'log_id' IS NULL THEN RAISE EXCEPTION 'sensitive access log insert failed'; END IF;

  -- 13. prove append-only on review events
  v_violation_caught := false;
  BEGIN
    UPDATE public.p5_batch2_evidence_review_events SET action = 'tampered'
      WHERE evidence_item_id = v_item;
  EXCEPTION WHEN OTHERS THEN v_violation_caught := true;
  END;
  IF NOT v_violation_caught THEN
    RAISE EXCEPTION 'review events UPDATE should be blocked by append-only trigger';
  END IF;

  v_violation_caught := false;
  BEGIN
    DELETE FROM public.p5_batch2_sensitive_access_log WHERE evidence_item_id = v_item;
  EXCEPTION WHEN OTHERS THEN v_violation_caught := true;
  END;
  IF NOT v_violation_caught THEN
    RAISE EXCEPTION 'sensitive access DELETE should be blocked';
  END IF;

  -- 14. prove pack items are append-only
  v_violation_caught := false;
  BEGIN
    UPDATE public.p5_batch2_evidence_pack_items SET snapshot_file_hash = 'tampered'
      WHERE pack_id = (v_pack->>'pack_id')::uuid;
  EXCEPTION WHEN OTHERS THEN v_violation_caught := true;
  END;
  IF NOT v_violation_caught THEN
    RAISE EXCEPTION 'pack items UPDATE should be blocked';
  END IF;

  -- 15. prove versions are immutable in their critical columns
  v_violation_caught := false;
  BEGIN
    UPDATE public.p5_batch2_evidence_versions SET file_hash = 'tampered' WHERE id = v_v2;
  EXCEPTION WHEN OTHERS THEN v_violation_caught := true;
  END;
  IF NOT v_violation_caught THEN
    RAISE EXCEPTION 'evidence_versions file_hash mutation should be blocked';
  END IF;

  -- 16. suspend and release
  PERFORM public.p5b2_suspend_release(v_warn_item, 'suspend', 'Compliance hold');
  PERFORM public.p5b2_suspend_release(v_warn_item, 'release', 'Hold cleared');

  -- 17. withdraw (non-deleting)
  PERFORM public.p5b2_withdraw_evidence(v_cond_item, 'Superseded by waiver and out of scope.');
  IF NOT EXISTS (SELECT 1 FROM public.p5_batch2_evidence_items WHERE id = v_cond_item) THEN
    RAISE EXCEPTION 'withdraw must not delete the row';
  END IF;

  -- 18. verify no raw sensitive value is returned by checklist summary
  v_summary := public.p5b2_generate_checklist(v_record);
  IF v_summary::text ~* '(passport_number|bank_account_number|tax_number|sha256:)' THEN
    -- file_hash is sha256: but it must NOT be present in the checklist output
    RAISE EXCEPTION 'checklist output leaked sensitive value';
  END IF;

  RAISE NOTICE 'P5B2_STAGE3_PROOF_OK';

  IF NOT v_role_existed THEN
    DELETE FROM public.user_roles WHERE user_id = v_user AND role::text='platform_admin';
  END IF;
END $$;

ROLLBACK;
