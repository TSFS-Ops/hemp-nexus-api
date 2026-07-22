-- ============================================================
-- Institutional Funder Evidence Workspace — Batch 9
-- Denied-access audit trail (additive only)
--
-- Adds a narrow, purpose-built logging RPC that records denied /
-- not-found access attempts against Funder Workspace resources into
-- the EXISTING public.p5_batch3_funder_audit_events table. No new
-- table is introduced — this reuses the audit infrastructure already
-- shipped in Batch 1.
--
-- Why a separate RPC rather than logging inline inside fw_admin_* /
-- fw_funder_* RPCs at the point they RAISE EXCEPTION: a RAISE
-- EXCEPTION aborts the enclosing transaction, which would roll back
-- any row inserted earlier in that same function call. This function
-- is invoked as an independent statement by the caller AFTER it has
-- already caught the denial (or a null/not-found read), so the
-- INSERT commits on its own and is never lost to a failed
-- transaction elsewhere.
--
-- This migration does not alter any existing RPC's signature, return
-- contract or error behaviour. Client responses stay exactly as
-- opaque and fail-closed as before.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fw_log_access_event_v1(
  p_action text,
  p_object_type text,
  p_object_id uuid,
  p_result text,
  p_reason text
  ) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
v_org uuid;
BEGIN
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'fw.forbidden: authentication required';
END IF;
IF p_result NOT IN ('denied','not_found','error') THEN
RAISE EXCEPTION 'fw.validation: invalid access event result';
END IF;
IF coalesce(trim(p_action),'') = '' THEN
RAISE EXCEPTION 'fw.validation: action required';
END IF;
IF coalesce(trim(p_object_type),'') = '' THEN
RAISE EXCEPTION 'fw.validation: object_type required';
END IF;

-- Best-effort: the caller may not be a recognised funder user at all
-- (e.g. a non-funder account probing a funder-only route). We still
-- log the attempt with a NULL organisation in that case rather than
-- failing the log call itself.
BEGIN
v_org := public.p5b3_current_funder_org();
EXCEPTION WHEN OTHERS THEN
v_org := NULL;
END;

INSERT INTO public.p5_batch3_funder_audit_events(
  user_id, funder_organisation_id, action, object_type, object_id,
  prior_state, new_state, reason_code, source_channel
  ) VALUES (
  auth.uid(), v_org, p_action, p_object_type, p_object_id,
  NULL, jsonb_build_object('result', p_result), p_reason, 'fw_access_log_v1'
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.fw_log_access_event_v1(text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fw_log_access_event_v1(text, text, uuid, text, text) TO authenticated, service_role;

-- ─── RPC: platform-admin review of repeated denied/not-found attempts ──────
-- Satisfies "repeated-attempt data made available for later security
-- review" without exposing the underlying audit table's full contents
-- (which include unrelated successful-mutation rows) directly to the UI.
CREATE OR REPLACE FUNCTION public.fw_admin_access_denial_summary_v1(
  p_since timestamptz
  ) RETURNS TABLE (
  user_id uuid,
  funder_organisation_id uuid,
  object_type text,
  action text,
  attempt_count bigint,
  last_attempt_at timestamptz
  )
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
IF NOT public.p5b3_is_platform_admin() THEN
RAISE EXCEPTION 'fw.forbidden: platform_admin required';
END IF;

RETURN QUERY
SELECT
e.user_id,
e.funder_organisation_id,
e.object_type,
e.action,
count(*) AS attempt_count,
max(e.created_at) AS last_attempt_at
FROM public.p5_batch3_funder_audit_events e
WHERE e.source_channel = 'fw_access_log_v1'
AND e.new_state ->> 'result' IN ('denied','not_found')
AND e.created_at >= coalesce(p_since, now() - interval '30 days')
GROUP BY e.user_id, e.funder_organisation_id, e.object_type, e.action
ORDER BY count(*) DESC, max(e.created_at) DESC;
END; $$;

REVOKE EXECUTE ON FUNCTION public.fw_admin_access_denial_summary_v1(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fw_admin_access_denial_summary_v1(timestamptz) TO authenticated, service_role;
