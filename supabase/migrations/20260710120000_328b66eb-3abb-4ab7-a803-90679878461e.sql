-- Fix: allow trusted service-role edge functions to record IDV results via p5scr_record_idv.
-- Root cause: this RPC previously only permitted platform_admin (has_role check against
-- auth.uid()). idv-person-verify and idv-manual-review call it via a service-role client with
-- no forwarded user JWT, so auth.uid() resolves to NULL and the check always failed, causing
-- idv-person-verify to return HTTP 500 (RECORD_FAILED) for every submission regardless of
-- caller, route, or country.
--
-- Fix: add a narrow allowance for auth.role() = 'service_role' alongside the existing
-- platform_admin path. This does not broaden GRANTs (still authenticated only, never anon or
-- PUBLIC) and does not touch any RLS SELECT policy -- provider/IDV records remain readable by
-- platform_admin only.
--
-- Verified safe callers at the time of this migration (see evidence file for full analysis):
--   - supabase/functions/idv-person-verify/index.ts -- validates subject.person_external_ref
--     equals the calling user's id BEFORE calling this RPC.
--   - supabase/functions/idv-manual-review/index.ts -- validates the calling user has the
--     platform_admin role (via a separate has_role RPC call) BEFORE calling this RPC.
-- A client cannot forge auth.role() = 'service_role' without possessing the secret
-- SUPABASE_SERVICE_ROLE_KEY, which is never exposed to the browser.
-- Any future service-role caller added to this RPC MUST replicate an equivalent
-- ownership/authority check before invoking it -- this RPC no longer performs that check
-- itself for service-role callers.

CREATE OR REPLACE FUNCTION public.p5scr_record_idv(
    p_subject_id uuid,
    p_state text,
    p_provider_ref text DEFAULT NULL,
    p_provider_live_now boolean DEFAULT false,
    p_activation_signed_off_at timestamptz DEFAULT NULL,
    p_expires_at timestamptz DEFAULT NULL,
    p_raw_provider_payload_admin_only jsonb DEFAULT NULL
  ) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_event text;
BEGIN
  IF NOT (
      public.has_role(auth.uid(), 'platform_admin')
      OR auth.role() = 'service_role'
    ) THEN
    RAISE EXCEPTION 'p5scr: platform_admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.p5scr_idv_records(
        subject_id, state, provider_ref,
        provider_live_now, activation_signed_off_at,
        decided_at, expires_at, raw_provider_payload_admin_only, recorded_by)
  VALUES (
        p_subject_id, p_state, p_provider_ref,
        p_provider_live_now, p_activation_signed_off_at,
        now(), p_expires_at, p_raw_provider_payload_admin_only, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.p5scr_check_state(subject_id, category, state, decided_at, expires_at)
    VALUES (p_subject_id, 'idv_person', p_state, now(), p_expires_at)
    ON CONFLICT (subject_id, category) DO UPDATE
      SET state = EXCLUDED.state, decided_at = EXCLUDED.decided_at,
          expires_at = EXCLUDED.expires_at, updated_at = now();

  v_event := CASE
    WHEN p_state IN ('cleared','cleared_with_conditions') THEN 'p5_screening.idv_completed'
    WHEN p_state IN ('failed','rejected') THEN 'p5_screening.idv_failed'
    ELSE 'p5_screening.idv_required'
  END;
  INSERT INTO public.p5scr_audit_events(event, subject_id, category, actor_user_id, payload_admin_only)
    VALUES (v_event, p_subject_id, 'idv_person', auth.uid(),
                jsonb_build_object('idv_record_id', v_id, 'state', p_state));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.p5scr_record_idv(uuid, text, text, boolean, timestamptz, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5scr_record_idv(uuid, text, text, boolean, timestamptz, timestamptz, jsonb) TO authenticated;
