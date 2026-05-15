-- Batch O Phase 2b Step 6 — admin_record_legacy_detections
--
-- Idempotently records that currently inconsistent legacy matches have
-- been detected. For each row:
--   * compute canonical ordered inconsistency reason codes (mirrors the
--     TS `inconsistencyReasons` predicate);
--   * compute deterministic signature `v1:<match_id>:<sortedReasons|none>`;
--   * INSERT into public.match_legacy_detection_emits ON CONFLICT DO NOTHING;
--   * if the insert took effect, write ONE audit_logs row with
--     action 'match.legacy_state_reconciliation_required';
--   * if it did not, count as already-recorded (no duplicate audit).
--
-- Hard scope:
--   * No UPDATE on public.matches.
--   * No POI / WaD / payment / credit / notification / rating / compliance
--     / public-status / lifecycle / SLA write.
--   * SECURITY DEFINER, service_role only — invoked exclusively by the
--     `admin-match-legacy-record-detections` edge function.

CREATE OR REPLACE FUNCTION public.admin_record_legacy_detections(
  p_admin_user_id uuid,
  p_match_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin        boolean;
  v_terminal_poi    text[] := ARRAY[
    'EXPIRED','REJECTED','ANNULLED','CANCELLED','COMPLETED','SETTLED'
  ];
  v_terminal_status text[] := ARRAY['completed','cancelled','annulled'];
  v_row             record;
  v_reasons         text[];
  v_signature       text;
  v_inserted        boolean;
  v_scanned         integer := 0;
  v_recorded        integer := 0;
  v_already         integer := 0;
  v_skipped         integer := 0;
  v_summary         jsonb := '[]'::jsonb;
  v_now             timestamptz := now();
BEGIN
  IF p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_user_id required' USING ERRCODE = '22023';
  END IF;
  SELECT public.is_admin(p_admin_user_id) INTO v_is_admin;
  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT m.*
      FROM public.matches m
     WHERE (p_match_ids IS NULL OR m.id = ANY (p_match_ids))
     ORDER BY m.created_at DESC
     LIMIT 500
  LOOP
    v_scanned := v_scanned + 1;

    -- Canonical ordered reason codes (mirrors TS inconsistencyReasons).
    v_reasons := ARRAY(
      SELECT r FROM (
        VALUES
          (1, CASE WHEN (v_row.metadata ->> 'legacy_repair_required') = 'true'
                   THEN 'legacy_repair_required' END),
          (2, CASE WHEN (v_row.metadata ->> 'state_reconciliation_required') = 'true'
                   THEN 'state_reconciliation_required' END),
          (3, CASE WHEN v_row.status = 'settled' AND v_row.poi_state = 'DRAFT'
                   THEN 'settled_with_draft_poi' END),
          (4, CASE WHEN v_row.state = 'completed'
                    AND v_row.poi_state IS NOT NULL
                    AND v_row.poi_state <> ''
                    AND v_row.poi_state <> 'ISSUED'
                    AND NOT (v_row.poi_state = ANY (v_terminal_poi))
                   THEN 'completed_state_with_open_poi' END),
          (5, CASE WHEN v_row.settled_at IS NOT NULL
                    AND v_row.status <> 'settled'
                    AND NOT (v_row.status = ANY (v_terminal_status))
                   THEN 'settled_at_without_settled_status' END),
          (6, CASE WHEN v_row.buyer_committed_at IS NOT NULL
                    AND v_row.seller_committed_at IS NOT NULL
                    AND v_row.state = 'discovery'
                   THEN 'both_committed_but_still_discovery' END),
          (7, CASE WHEN v_row.buyer_org_id IS NOT NULL
                    AND v_row.seller_org_id IS NOT NULL
                    AND v_row.buyer_org_id = v_row.seller_org_id
                   THEN 'same_org_both_sides' END)
      ) AS t(ord, r)
      WHERE r IS NOT NULL
      ORDER BY ord
    );

    IF array_length(v_reasons, 1) IS NULL THEN
      v_skipped := v_skipped + 1;
      v_summary := v_summary || jsonb_build_array(jsonb_build_object(
        'match_id', v_row.id,
        'status', 'skipped_consistent'
      ));
      CONTINUE;
    END IF;

    -- Deterministic signature: must match supabase/functions/_shared/match-detection-signature.ts
    v_signature := 'v1:' || v_row.id::text || ':' ||
      coalesce(
        (SELECT string_agg(r, ',' ORDER BY r)
           FROM unnest(v_reasons) AS r),
        'none'
      );

    INSERT INTO public.match_legacy_detection_emits
      (match_id, signature, reasons, emitted_by_user_id, emitted_at)
    VALUES (
      v_row.id,
      v_signature,
      to_jsonb(v_reasons),
      p_admin_user_id,
      v_now
    )
    ON CONFLICT (match_id, signature) DO NOTHING
    RETURNING true INTO v_inserted;

    IF coalesce(v_inserted, false) THEN
      v_recorded := v_recorded + 1;

      INSERT INTO public.audit_logs (
        org_id, actor_user_id, action, entity_type, entity_id, metadata
      ) VALUES (
        v_row.org_id,
        p_admin_user_id,
        'match.legacy_state_reconciliation_required',
        'match',
        v_row.id,
        jsonb_build_object(
          'match_id', v_row.id,
          'buyer_org_id', v_row.buyer_org_id,
          'seller_org_id', v_row.seller_org_id,
          'before', jsonb_build_object(
            'status', v_row.status,
            'state', v_row.state,
            'poi_state', v_row.poi_state
          ),
          'reasons', to_jsonb(v_reasons),
          'signature', v_signature,
          'user_visibility_after', 'hidden',
          'admin_queue_created', true,
          'progression_blocked', true,
          'credit_burned', false,
          'payment_event_created', false,
          'detected_at', v_now
        )
      );

      v_summary := v_summary || jsonb_build_array(jsonb_build_object(
        'match_id', v_row.id,
        'status', 'recorded',
        'reasons', to_jsonb(v_reasons)
      ));
    ELSE
      v_already := v_already + 1;
      v_summary := v_summary || jsonb_build_array(jsonb_build_object(
        'match_id', v_row.id,
        'status', 'already_recorded'
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'scanned', v_scanned,
    'recorded', v_recorded,
    'already_recorded', v_already,
    'skipped', v_skipped,
    'summary', v_summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_legacy_detections(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_legacy_detections(uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.admin_record_legacy_detections(uuid, uuid[]) IS
  'Batch O Phase 2b Step 6 (MT-008): idempotently records detection of inconsistent legacy matches. Inserts into match_legacy_detection_emits ON CONFLICT DO NOTHING and writes one match.legacy_state_reconciliation_required audit row only when the insert took effect. Service-role only — invoked by admin-match-legacy-record-detections edge function. Never mutates matches or any POI/WaD/payment/credit/notification table.';
