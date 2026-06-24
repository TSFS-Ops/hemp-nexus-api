
CREATE OR REPLACE FUNCTION public.p5b2_snapshot_finality_pack(
  p_record_id uuid,
  p_pack_reason text,
  p_organization_id uuid DEFAULT NULL,
  p_match_id uuid DEFAULT NULL,
  p_trade_request_id uuid DEFAULT NULL,
  p_counterparty_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := public.p5b2_actor_role(auth.uid());
  v_pack_id uuid;
  v_row RECORD;
  v_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'p5b2_snapshot_finality_pack: authentication required';
  END IF;
  IF NOT public.p5b2_has_any_role(v_actor, ARRAY['platform_admin','compliance_analyst','executive_approver','governance_reviewer']) THEN
    RAISE EXCEPTION 'p5b2_snapshot_finality_pack: actor_not_authorised';
  END IF;
  IF p_pack_reason IS NULL OR length(btrim(p_pack_reason))=0 THEN
    RAISE EXCEPTION 'p5b2_snapshot_finality_pack: pack_reason required';
  END IF;

  INSERT INTO public.p5_batch2_evidence_packs(
    organization_id, counterparty_id, match_id, trade_request_id,
    pack_reason, pack_status, sealed_by, metadata
  ) VALUES (
    p_organization_id, p_counterparty_id, p_match_id, p_trade_request_id,
    p_pack_reason, 'sealed', v_actor,
    jsonb_build_object('record_id', p_record_id, 'sealed_by_role', v_role)
  ) RETURNING id INTO v_pack_id;

  FOR v_row IN
    SELECT i.id, i.status, i.rating, i.current_version_id, v.file_hash
    FROM public.p5_batch2_evidence_items i
    LEFT JOIN public.p5_batch2_evidence_versions v ON v.id = i.current_version_id
    WHERE i.record_id = p_record_id AND i.current_version_id IS NOT NULL
  LOOP
    INSERT INTO public.p5_batch2_evidence_pack_items(
      pack_id, evidence_item_id, version_id,
      snapshot_status, snapshot_rating, snapshot_file_hash
    ) VALUES (
      v_pack_id, v_row.id, v_row.current_version_id,
      v_row.status, v_row.rating, COALESCE(v_row.file_hash, 'no-hash')
    );
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.p5_batch2_evidence_review_events(
    evidence_item_id, action, actor_user_id, actor_role, actor_type, metadata
  )
  SELECT ei.id, 'finality_pack_snapshot', v_actor, v_role, 'user',
         jsonb_build_object('pack_id', v_pack_id, 'pack_reason', p_pack_reason)
  FROM public.p5_batch2_evidence_items ei
  WHERE ei.record_id = p_record_id AND ei.current_version_id IS NOT NULL
  LIMIT 1;

  RETURN jsonb_build_object('pack_id', v_pack_id, 'item_count', v_count, 'pack_status', 'sealed');
END $$;
