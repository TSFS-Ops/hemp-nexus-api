
-- ============================================================================
-- P-5 Screening & IDV — Phase 4 API-safe read projections
-- Read-only. No new tables. No mutation. No live calls.
-- Allowed wording (SSOT verbatim):
--   'Screening pending', 'Provider pending', 'Manual review required',
--   'Identity verification required', 'Screening expired',
--   'Not ready - counterparty checks pending'
-- ============================================================================

-- 1) p5scr_api_subject_status -----------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_api_subject_status(
  p_subject_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb; v_admin_review boolean; v_provider_pending boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'affected_check', cs.category,
      'readiness_status',
        CASE cs.state
          WHEN 'screening_pending'        THEN 'Screening pending'
          WHEN 'idv_pending'              THEN 'Identity verification required'
          WHEN 'provider_pending'         THEN 'Provider pending'
          WHEN 'manual_review_required'   THEN 'Manual review required'
          WHEN 'screening_expired'        THEN 'Screening expired'
          WHEN 'not_started'              THEN 'Not ready - counterparty checks pending'
          WHEN 'failed'                   THEN 'Not ready - counterparty checks pending'
          WHEN 'rejected'                 THEN 'Not ready - counterparty checks pending'
          ELSE NULL
        END,
      'last_checked_at', cs.decided_at,
      'expires_at', cs.expires_at
    )), '[]'::jsonb),
    bool_or(cs.state = 'manual_review_required'),
    bool_or(cs.state = 'provider_pending')
    INTO v_rows, v_admin_review, v_provider_pending
    FROM public.p5scr_check_state cs
   WHERE cs.subject_id = p_subject_id
     AND cs.state IN ('not_started','screening_pending','idv_pending',
                      'provider_pending','manual_review_required','screening_expired',
                      'failed','rejected');

  RETURN jsonb_build_object(
    'ready', (jsonb_array_length(v_rows) = 0),
    'blockers', v_rows,
    'admin_review_required', COALESCE(v_admin_review, false),
    'provider_pending', COALESCE(v_provider_pending, false),
    'retry_pending', false
  );
END $$;
REVOKE ALL ON FUNCTION public.p5scr_api_subject_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_api_subject_status(uuid) TO authenticated;

-- 2) p5scr_api_gate_readiness -----------------------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_api_gate_readiness(
  p_subject_id uuid,
  p_gate text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_blockers jsonb; v_ready boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'affected_party', s.party_role,
           'affected_check', cs.category,
           'readiness_status',
             CASE cs.state
               WHEN 'screening_pending'      THEN 'Screening pending'
               WHEN 'idv_pending'            THEN 'Identity verification required'
               WHEN 'provider_pending'       THEN 'Provider pending'
               WHEN 'manual_review_required' THEN 'Manual review required'
               WHEN 'screening_expired'      THEN 'Screening expired'
               WHEN 'not_started'            THEN 'Not ready - counterparty checks pending'
               WHEN 'failed'                 THEN 'Not ready - counterparty checks pending'
               WHEN 'rejected'               THEN 'Not ready - counterparty checks pending'
               ELSE NULL
             END,
           'last_checked_at', cs.decided_at,
           'expires_at', cs.expires_at,
           'admin_review_required', (cs.state = 'manual_review_required'),
           'provider_pending', (cs.state = 'provider_pending'),
           'retry_pending', false
         )), '[]'::jsonb)
    INTO v_blockers
    FROM public.p5scr_check_state cs
    JOIN public.p5scr_subjects s ON s.id = cs.subject_id
   WHERE cs.subject_id = p_subject_id
     AND CASE
           WHEN p_gate IN ('poi_create','poi_accept','wad_create')
             THEN cs.state IN ('failed','rejected')
           ELSE cs.state IN ('not_started','screening_pending','idv_pending',
                             'provider_pending','manual_review_required','screening_expired',
                             'failed','rejected')
         END;

  v_ready := (jsonb_array_length(v_blockers) = 0);
  RETURN jsonb_build_object(
    'ready', v_ready,
    'readiness_status', CASE WHEN v_ready THEN NULL
      ELSE 'Not ready - counterparty checks pending' END,
    'blockers', v_blockers);
END $$;
REVOKE ALL ON FUNCTION public.p5scr_api_gate_readiness(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_api_gate_readiness(uuid, text) TO authenticated;
