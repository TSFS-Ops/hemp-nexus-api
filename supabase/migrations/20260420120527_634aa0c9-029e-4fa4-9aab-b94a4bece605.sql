-- Integrity check: surface any drift between engagement state and immutable log.
-- Mirrors the pattern used by check_match_state_invariants / check_engagement_email_delivery.
CREATE OR REPLACE FUNCTION public.check_engagement_log_integrity()
RETURNS TABLE(engagement_id uuid, issue_type text, details text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- 1. Engagement state disagrees with newest outreach log row
  RETURN QUERY
  SELECT pe.id,
         'STATE_LOG_DRIFT'::text,
         format('engagement_status=%s but latest log new_status=%s', pe.engagement_status::text, latest.new_status::text)::text
  FROM poi_engagements pe
  JOIN LATERAL (
    SELECT new_status FROM engagement_outreach_logs
    WHERE engagement_id = pe.id ORDER BY created_at DESC LIMIT 1
  ) latest ON true
  WHERE pe.engagement_status::text <> latest.new_status::text;

  -- 2. Admin updated an engagement but no matching outreach log row from the same admin within 10s
  RETURN QUERY
  SELECT aal.target_id,
         'ADMIN_UPDATE_NO_LOG'::text,
         format('admin_audit_logs row %s at %s has no matching outreach_log row from admin %s', aal.id, aal.created_at, aal.admin_user_id)::text
  FROM admin_audit_logs aal
  WHERE aal.action = 'engagement.updated'
    AND aal.created_at > now() - interval '90 days'
    AND NOT EXISTS (
      SELECT 1 FROM engagement_outreach_logs eol
      WHERE eol.engagement_id = aal.target_id
        AND eol.admin_user_id = aal.admin_user_id
        AND eol.created_at BETWEEN aal.created_at - interval '10 seconds' AND aal.created_at + interval '10 seconds'
    );

  -- 3. Counterparty respond audit row without matching outreach log row
  RETURN QUERY
  SELECT al.entity_id,
         'COUNTERPARTY_RESP_NO_LOG'::text,
         format('audit_logs row %s at %s has no matching counterparty outreach_log row', al.id, al.created_at)::text
  FROM audit_logs al
  WHERE al.action = 'engagement.counterparty_responded'
    AND al.created_at > now() - interval '90 days'
    AND NOT EXISTS (
      SELECT 1 FROM engagement_outreach_logs eol
      WHERE eol.engagement_id = al.entity_id
        AND eol.actor_type = 'counterparty'
        AND eol.created_at BETWEEN al.created_at - interval '10 seconds' AND al.created_at + interval '10 seconds'
    );
END;
$$;

-- Extend the project-wide integrity summary with the engagement log check
CREATE OR REPLACE FUNCTION public.run_data_integrity_checks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token_issues bigint;
  v_chain_issues bigint;
  v_state_issues bigint;
  v_email_issues bigint;
  v_doc_issues bigint;
  v_engagement_log_issues bigint;
BEGIN
  SELECT count(*) INTO v_token_issues FROM public.reconcile_token_balances() WHERE status = 'MISMATCH';
  SELECT count(*) INTO v_chain_issues FROM public.verify_event_chain_integrity();
  SELECT count(*) INTO v_state_issues FROM public.check_match_state_invariants();
  SELECT count(*) INTO v_email_issues FROM public.check_engagement_email_delivery();
  SELECT count(*) INTO v_doc_issues FROM public.check_document_version_integrity();
  SELECT count(*) INTO v_engagement_log_issues FROM public.check_engagement_log_integrity();

  RETURN jsonb_build_object(
    'checked_at', now(),
    'token_balance_mismatches', v_token_issues,
    'event_chain_issues', v_chain_issues,
    'match_state_violations', v_state_issues,
    'email_delivery_gaps', v_email_issues,
    'document_version_conflicts', v_doc_issues,
    'engagement_log_drifts', v_engagement_log_issues,
    'overall_status', CASE
      WHEN (v_token_issues + v_chain_issues + v_state_issues + v_email_issues + v_doc_issues + v_engagement_log_issues) = 0 THEN 'CLEAN'
      ELSE 'ISSUES_FOUND'
    END,
    'total_issues', v_token_issues + v_chain_issues + v_state_issues + v_email_issues + v_doc_issues + v_engagement_log_issues
  );
END;
$$;