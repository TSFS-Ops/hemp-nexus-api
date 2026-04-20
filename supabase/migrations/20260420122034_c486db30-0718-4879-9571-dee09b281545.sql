-- Drop existing function first since return signature is changing
DROP FUNCTION IF EXISTS public.check_engagement_log_integrity();

-- ============================================================================
-- PART 1: Backfill 7 expired engagements with system log rows
-- ============================================================================
INSERT INTO engagement_outreach_logs (
  engagement_id, actor_type, admin_user_id, admin_email, admin_name,
  entry_type, contact_method, contact_detail, previous_status, new_status, notes
)
SELECT
  pe.id,
  'system',
  NULL,
  NULL,
  'Lifecycle Scheduler (legacy backfill)',
  'system_action',
  NULL,
  NULL,
  'notification_sent',
  'expired',
  'Reconciliation backfill (2026-04-20): legacy expiry predates immutable outreach log path. ' ||
  'Recorded for chain integrity. Original expiry timestamp: ' || pe.expires_at::text
FROM poi_engagements pe
WHERE pe.engagement_status = 'expired'
  AND NOT EXISTS (
    SELECT 1 FROM engagement_outreach_logs eol
    WHERE eol.engagement_id = pe.id AND eol.actor_type = 'system'
  );

-- ============================================================================
-- PART 2: Backfill contaminated names
-- ============================================================================
UPDATE matches SET buyer_name = 'Pending verification (legacy)'
  WHERE buyer_name LIKE '%@%' AND length(buyer_name) < 320;
UPDATE matches SET seller_name = 'Pending verification (legacy)'
  WHERE seller_name LIKE '%@%' AND length(seller_name) < 320;
UPDATE organizations SET name = 'Pending verification (legacy)'
  WHERE name LIKE '%@%' AND length(name) < 320;
UPDATE organizations SET legal_name = 'Pending verification (legacy)'
  WHERE legal_name LIKE '%@%' AND length(legal_name) < 320;

INSERT INTO admin_audit_logs (admin_user_id, action, target_type, details)
VALUES (NULL, 'data.backfill.email_in_name_purge', 'matches_organizations',
  jsonb_build_object(
    'reason', 'Legacy data carried email addresses in name fields, contaminating evidence packs',
    'replacement_value', 'Pending verification (legacy)',
    'executed_at', now(),
    'migration', '20260420_engagement_integrity_repair'
  ));

-- ============================================================================
-- PART 3: CHECK constraints preventing future email-as-name writes
-- ============================================================================
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_buyer_name_no_email;
ALTER TABLE matches ADD CONSTRAINT matches_buyer_name_no_email
  CHECK (buyer_name IS NULL OR buyer_name NOT LIKE '%@%' OR length(buyer_name) >= 320);

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_seller_name_no_email;
ALTER TABLE matches ADD CONSTRAINT matches_seller_name_no_email
  CHECK (seller_name IS NULL OR seller_name NOT LIKE '%@%' OR length(seller_name) >= 320);

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS orgs_name_no_email;
ALTER TABLE organizations ADD CONSTRAINT orgs_name_no_email
  CHECK (name IS NULL OR name NOT LIKE '%@%' OR length(name) >= 320);

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS orgs_legal_name_no_email;
ALTER TABLE organizations ADD CONSTRAINT orgs_legal_name_no_email
  CHECK (legal_name IS NULL OR legal_name NOT LIKE '%@%' OR length(legal_name) >= 320);

-- ============================================================================
-- PART 4: Transactional engagement transition function
-- ============================================================================
CREATE OR REPLACE FUNCTION public.atomic_engagement_transition(
  p_engagement_id uuid,
  p_actor_type text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_new_status text,
  p_entry_type text,
  p_contact_method text DEFAULT NULL,
  p_contact_detail text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_audit_action text DEFAULT NULL,
  p_audit_org_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_engagement RECORD;
  v_lock_key bigint;
  v_log_id uuid;
  v_prev_status text;
BEGIN
  v_lock_key := ('x' || substr(md5(p_engagement_id::text), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_engagement FROM poi_engagements WHERE id = p_engagement_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  v_prev_status := v_engagement.engagement_status::text;

  IF v_prev_status = p_new_status THEN
    IF EXISTS (
      SELECT 1 FROM engagement_outreach_logs
      WHERE engagement_id = p_engagement_id
        AND actor_type = p_actor_type
        AND new_status = p_new_status
        AND created_at > now() - interval '5 seconds'
    ) THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'engagement_status', p_new_status);
    END IF;
  END IF;

  UPDATE poi_engagements
  SET engagement_status = p_new_status::engagement_status,
      contacted_at = CASE WHEN p_new_status = 'contacted' AND contacted_at IS NULL THEN now() ELSE contacted_at END,
      responded_at = CASE WHEN p_new_status IN ('accepted','declined') AND responded_at IS NULL THEN now() ELSE responded_at END
  WHERE id = p_engagement_id;

  INSERT INTO engagement_outreach_logs (
    engagement_id, actor_type, admin_user_id, admin_email, admin_name,
    entry_type, contact_method, contact_detail,
    previous_status, new_status, notes
  ) VALUES (
    p_engagement_id, p_actor_type, p_actor_user_id, p_actor_email, p_actor_name,
    p_entry_type, p_contact_method, p_contact_detail,
    v_prev_status, p_new_status, p_notes
  )
  RETURNING id INTO v_log_id;

  IF p_audit_action IS NOT NULL AND p_audit_org_id IS NOT NULL THEN
    IF p_actor_type = 'admin' THEN
      INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
      VALUES (
        p_actor_user_id, p_audit_action, 'poi_engagement', p_engagement_id,
        jsonb_build_object('engagement_id', p_engagement_id, 'previous_status', v_prev_status,
          'new_status', p_new_status, 'outreach_log_id', v_log_id, 'transactional', true)
      );
    ELSE
      INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (
        p_audit_org_id, p_actor_user_id, p_audit_action, 'poi_engagement', p_engagement_id,
        jsonb_build_object('engagement_id', p_engagement_id, 'previous_status', v_prev_status,
          'new_status', p_new_status, 'outreach_log_id', v_log_id, 'transactional', true)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'idempotent', false,
    'engagement_id', p_engagement_id, 'previous_status', v_prev_status,
    'new_status', p_new_status, 'outreach_log_id', v_log_id);
END;
$$;

-- ============================================================================
-- PART 5: Repair log chain gaps for the 2 affected engagements
-- ============================================================================
INSERT INTO engagement_outreach_logs (
  engagement_id, actor_type, admin_user_id, admin_email, admin_name,
  entry_type, contact_method, contact_detail, previous_status, new_status, notes
)
SELECT
  pe.id, 'system', NULL, NULL, 'Chain Reconciler (2026-04-20)',
  'system_action', NULL, NULL,
  (SELECT new_status FROM engagement_outreach_logs eol
   WHERE eol.engagement_id = pe.id ORDER BY created_at DESC LIMIT 1),
  pe.engagement_status::text,
  'Chain reconciliation anchor: closes legacy chain breaks. Ground truth = ' ||
  pe.engagement_status::text || '. From this row forward, the chain is unbroken.'
FROM poi_engagements pe
WHERE pe.id IN (
  '11e3c2f5-8222-46fd-9e5a-1504c2ebc934',
  '97871cb0-d832-4b2a-9da0-bcc3003e6217'
)
AND (
  SELECT new_status FROM engagement_outreach_logs eol
  WHERE eol.engagement_id = pe.id ORDER BY created_at DESC LIMIT 1
) <> pe.engagement_status::text;

-- ============================================================================
-- PART 6: Expanded integrity checker
-- ============================================================================
CREATE FUNCTION public.check_engagement_log_integrity()
RETURNS TABLE(engagement_id uuid, issue_type text, details text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT pe.id, 'STATE_LOG_DRIFT'::text,
         format('engagement_status=%s but latest log new_status=%s', pe.engagement_status, latest.new_status)::text
  FROM poi_engagements pe
  JOIN LATERAL (
    SELECT new_status FROM engagement_outreach_logs
    WHERE engagement_id = pe.id ORDER BY created_at DESC LIMIT 1
  ) latest ON true
  WHERE pe.engagement_status::text <> latest.new_status;

  RETURN QUERY
  SELECT pe.id, 'ADMIN_UPDATE_NO_LOG'::text,
         format('admin_audit_logs row %s has no matching outreach log', aal.id)::text
  FROM poi_engagements pe
  JOIN admin_audit_logs aal
    ON aal.target_id::uuid = pe.id
    AND aal.action = 'engagement.updated'
    AND aal.created_at > now() - interval '30 days'
  LEFT JOIN engagement_outreach_logs eol
    ON eol.engagement_id = pe.id
    AND eol.admin_user_id = aal.admin_user_id
    AND eol.created_at BETWEEN aal.created_at - interval '10 seconds' AND aal.created_at + interval '10 seconds'
  WHERE eol.id IS NULL;

  RETURN QUERY
  SELECT pe.id, 'COUNTERPARTY_RESP_NO_LOG'::text,
         format('audit_logs row %s has no matching counterparty outreach log', al.id)::text
  FROM poi_engagements pe
  JOIN audit_logs al
    ON al.entity_id::uuid = pe.id
    AND al.action = 'engagement.counterparty_responded'
    AND al.created_at > now() - interval '30 days'
  LEFT JOIN engagement_outreach_logs eol
    ON eol.engagement_id = pe.id
    AND eol.actor_type = 'counterparty'
    AND eol.created_at BETWEEN al.created_at - interval '10 seconds' AND al.created_at + interval '10 seconds'
  WHERE eol.id IS NULL;

  RETURN QUERY
  SELECT pe.id, 'EXPIRED_NO_SYSTEM_LOG'::text,
         'engagement is expired but no system_action log row exists'::text
  FROM poi_engagements pe
  WHERE pe.engagement_status = 'expired'
    AND NOT EXISTS (
      SELECT 1 FROM engagement_outreach_logs eol
      WHERE eol.engagement_id = pe.id AND eol.actor_type = 'system'
    );

  RETURN QUERY
  SELECT pe.id, 'NAME_EMAIL_CONTAMINATION'::text,
         format('match %s carries email-shaped value in buyer_name or seller_name', m.id)::text
  FROM poi_engagements pe
  JOIN matches m ON m.id = pe.match_id
  WHERE pe.engagement_status = 'accepted'
    AND ((m.buyer_name LIKE '%@%' AND length(m.buyer_name) < 320)
      OR (m.seller_name LIKE '%@%' AND length(m.seller_name) < 320));

  RETURN QUERY
  WITH ranked AS (
    SELECT engagement_id, previous_status, new_status, created_at,
      LAG(new_status) OVER (PARTITION BY engagement_id ORDER BY created_at) AS prev_log_status,
      ROW_NUMBER() OVER (PARTITION BY engagement_id ORDER BY created_at) AS rn
    FROM engagement_outreach_logs
  )
  SELECT r.engagement_id, 'CHAIN_GAP'::text,
         format('row at %s expects previous_status=%s but actual prior new_status=%s',
                r.created_at, r.previous_status, r.prev_log_status)::text
  FROM ranked r
  WHERE r.rn > 1 AND r.prev_log_status IS DISTINCT FROM r.previous_status;
END;
$$;

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
  v_eng_drifts bigint;
  v_eng_admin_orph bigint;
  v_eng_cp_orph bigint;
  v_eng_expired_orph bigint;
  v_eng_name bigint;
  v_eng_chain bigint;
BEGIN
  SELECT count(*) INTO v_token_issues FROM public.reconcile_token_balances() WHERE status = 'MISMATCH';
  SELECT count(*) INTO v_chain_issues FROM public.verify_event_chain_integrity();
  SELECT count(*) INTO v_state_issues FROM public.check_match_state_invariants();
  SELECT count(*) INTO v_email_issues FROM public.check_engagement_email_delivery();
  SELECT count(*) INTO v_doc_issues FROM public.check_document_version_integrity();

  SELECT count(*) FILTER (WHERE issue_type = 'STATE_LOG_DRIFT') INTO v_eng_drifts FROM public.check_engagement_log_integrity();
  SELECT count(*) FILTER (WHERE issue_type = 'ADMIN_UPDATE_NO_LOG') INTO v_eng_admin_orph FROM public.check_engagement_log_integrity();
  SELECT count(*) FILTER (WHERE issue_type = 'COUNTERPARTY_RESP_NO_LOG') INTO v_eng_cp_orph FROM public.check_engagement_log_integrity();
  SELECT count(*) FILTER (WHERE issue_type = 'EXPIRED_NO_SYSTEM_LOG') INTO v_eng_expired_orph FROM public.check_engagement_log_integrity();
  SELECT count(*) FILTER (WHERE issue_type = 'NAME_EMAIL_CONTAMINATION') INTO v_eng_name FROM public.check_engagement_log_integrity();
  SELECT count(*) FILTER (WHERE issue_type = 'CHAIN_GAP') INTO v_eng_chain FROM public.check_engagement_log_integrity();

  RETURN jsonb_build_object(
    'checked_at', now(),
    'token_balance_mismatches', v_token_issues,
    'event_chain_issues', v_chain_issues,
    'match_state_violations', v_state_issues,
    'email_delivery_gaps', v_email_issues,
    'document_version_conflicts', v_doc_issues,
    'engagement_log_drifts', v_eng_drifts,
    'engagement_admin_orphans', v_eng_admin_orph,
    'engagement_counterparty_orphans', v_eng_cp_orph,
    'engagement_expired_no_log', v_eng_expired_orph,
    'engagement_name_email_contamination', v_eng_name,
    'engagement_chain_gaps', v_eng_chain,
    'overall_status', CASE
      WHEN (v_token_issues + v_chain_issues + v_state_issues + v_email_issues + v_doc_issues
          + v_eng_drifts + v_eng_admin_orph + v_eng_cp_orph + v_eng_expired_orph
          + v_eng_name + v_eng_chain) = 0 THEN 'CLEAN'
      ELSE 'ISSUES_FOUND'
    END,
    'total_issues', (v_token_issues + v_chain_issues + v_state_issues + v_email_issues + v_doc_issues
        + v_eng_drifts + v_eng_admin_orph + v_eng_cp_orph + v_eng_expired_orph
        + v_eng_name + v_eng_chain)
  );
END;
$$;