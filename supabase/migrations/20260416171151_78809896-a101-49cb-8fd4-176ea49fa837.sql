
-- =============================================================
-- DATA INTEGRITY RECONCILIATION FUNCTIONS
-- =============================================================

-- 1. TOKEN BALANCE RECONCILIATION
-- Compares token_balances.balance against the computed sum from token_ledger
CREATE OR REPLACE FUNCTION public.reconcile_token_balances()
RETURNS TABLE(
  org_id uuid,
  recorded_balance integer,
  computed_balance integer,
  total_burned bigint,
  total_credited bigint,
  discrepancy integer,
  status text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH ledger_sums AS (
    SELECT
      tl.org_id,
      COALESCE(SUM(tl.tokens_burned) FILTER (WHERE tl.outcome = 'allowed'), 0)::bigint AS burned,
      COALESCE(SUM(tl.tokens_burned) FILTER (WHERE tl.action_type = 'credit' OR tl.action_type = 'refund'), 0)::bigint AS credited
    FROM token_ledger tl
    GROUP BY tl.org_id
  )
  SELECT
    tb.org_id,
    tb.balance AS recorded_balance,
    (1000 - COALESCE(ls.burned, 0) + COALESCE(ls.credited, 0))::integer AS computed_balance,
    COALESCE(ls.burned, 0) AS total_burned,
    COALESCE(ls.credited, 0) AS total_credited,
    (tb.balance - (1000 - COALESCE(ls.burned, 0) + COALESCE(ls.credited, 0)))::integer AS discrepancy,
    CASE
      WHEN tb.balance = (1000 - COALESCE(ls.burned, 0) + COALESCE(ls.credited, 0))::integer THEN 'ok'
      ELSE 'MISMATCH'
    END AS status
  FROM token_balances tb
  LEFT JOIN ledger_sums ls ON ls.org_id = tb.org_id
  ORDER BY ABS(tb.balance - (1000 - COALESCE(ls.burned, 0) + COALESCE(ls.credited, 0))::integer) DESC;
END;
$$;

-- 2. EVENT CHAIN INTEGRITY VERIFICATION
-- Checks that match_events hash chain is unbroken and matches.event_chain_hash agrees
CREATE OR REPLACE FUNCTION public.verify_event_chain_integrity()
RETURNS TABLE(
  match_id uuid,
  issue_type text,
  details text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Check 1: Broken chain links (previous_event_hash doesn't match prior row's payload_hash)
  RETURN QUERY
  WITH ordered_events AS (
    SELECT
      me.match_id,
      me.id AS event_id,
      me.payload_hash,
      me.previous_event_hash,
      me.created_at,
      LAG(me.payload_hash) OVER (PARTITION BY me.match_id ORDER BY me.created_at) AS expected_prev
    FROM match_events me
  )
  SELECT
    oe.match_id,
    'CHAIN_BREAK'::text AS issue_type,
    format('Event %s: previous_event_hash=%s but expected=%s', oe.event_id, COALESCE(oe.previous_event_hash, 'NULL'), COALESCE(oe.expected_prev, 'NULL'))::text AS details
  FROM ordered_events oe
  WHERE oe.expected_prev IS NOT NULL
    AND oe.previous_event_hash IS DISTINCT FROM oe.expected_prev;

  -- Check 2: matches.event_chain_hash doesn't match the latest event's payload_hash
  RETURN QUERY
  WITH latest_events AS (
    SELECT DISTINCT ON (me.match_id)
      me.match_id,
      me.payload_hash AS latest_hash
    FROM match_events me
    ORDER BY me.match_id, me.created_at DESC
  )
  SELECT
    m.id AS match_id,
    'HASH_DRIFT'::text AS issue_type,
    format('matches.event_chain_hash=%s but latest event hash=%s', COALESCE(m.event_chain_hash, 'NULL'), le.latest_hash)::text AS details
  FROM matches m
  JOIN latest_events le ON le.match_id = m.id
  WHERE m.event_chain_hash IS DISTINCT FROM le.latest_hash;

  -- Check 3: Matches past discovery with no event_chain_hash
  RETURN QUERY
  SELECT
    m.id AS match_id,
    'MISSING_HASH'::text AS issue_type,
    format('Match in state=%s but event_chain_hash is NULL', m.state)::text AS details
  FROM matches m
  WHERE m.state != 'discovery'
    AND m.event_chain_hash IS NULL;
END;
$$;

-- 3. MATCH STATE INVARIANT CHECKS
-- Validates state machine rules: committed must have settled_at, poi_state, events, etc.
CREATE OR REPLACE FUNCTION public.check_match_state_invariants()
RETURNS TABLE(
  match_id uuid,
  current_state text,
  violation text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Committed/completed matches must have settled_at
  RETURN QUERY
  SELECT m.id, m.state, 'state=committed/completed but settled_at IS NULL'::text
  FROM matches m
  WHERE m.state IN ('committed', 'completed') AND m.settled_at IS NULL;

  -- Committed/completed matches must have poi_state = COMPLETED
  RETURN QUERY
  SELECT m.id, m.state, format('state=%s but poi_state=%s (expected COMPLETED)', m.state, m.poi_state)::text
  FROM matches m
  WHERE m.state IN ('committed', 'completed') AND m.poi_state != 'COMPLETED';

  -- Committed/completed matches must have at least one poi.generated event
  RETURN QUERY
  SELECT m.id, m.state, 'state=committed/completed but no poi.generated event found'::text
  FROM matches m
  WHERE m.state IN ('committed', 'completed')
    AND NOT EXISTS (
      SELECT 1 FROM match_events me
      WHERE me.match_id = m.id AND me.event_type = 'poi.generated'
    );

  -- Committed/completed matches must have a collapse_ledger entry
  RETURN QUERY
  SELECT m.id, m.state, 'state=committed/completed but no collapse_ledger entry'::text
  FROM matches m
  WHERE m.state IN ('committed', 'completed')
    AND NOT EXISTS (
      SELECT 1 FROM collapse_ledger cl WHERE cl.match_id = m.id
    );

  -- Settled matches must have both buyer and seller committed timestamps
  RETURN QUERY
  SELECT m.id, m.state, format('committed but buyer_committed_at=%s, seller_committed_at=%s', m.buyer_committed_at, m.seller_committed_at)::text
  FROM matches m
  WHERE m.state IN ('committed', 'completed')
    AND (m.buyer_committed_at IS NULL OR m.seller_committed_at IS NULL);

  -- Discovery matches must NOT have settled_at
  RETURN QUERY
  SELECT m.id, m.state, format('state=discovery but settled_at=%s (should be NULL)', m.settled_at)::text
  FROM matches m
  WHERE m.state = 'discovery' AND m.settled_at IS NOT NULL;
END;
$$;

-- 4. ENGAGEMENT-EMAIL DELIVERY CROSS-CHECK
-- Finds poi_engagements marked as notification_sent but with no successful email record
CREATE OR REPLACE FUNCTION public.check_engagement_email_delivery()
RETURNS TABLE(
  engagement_id uuid,
  match_id uuid,
  counterparty_email text,
  engagement_status text,
  email_status text,
  issue text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pe.id AS engagement_id,
    pe.match_id,
    pe.counterparty_email,
    pe.engagement_status,
    COALESCE(esl.status, 'NO_RECORD') AS email_status,
    CASE
      WHEN esl.id IS NULL THEN 'No email_send_log entry found for this engagement'
      WHEN esl.status = 'failed' THEN format('Email delivery failed: %s', esl.error_message)
      ELSE 'Email status: ' || esl.status
    END::text AS issue
  FROM poi_engagements pe
  LEFT JOIN email_send_log esl ON (
    esl.metadata->>'engagement_id' = pe.id::text
    OR esl.recipient_email = pe.counterparty_email
  )
  WHERE pe.engagement_status = 'notification_sent'
    AND (esl.id IS NULL OR esl.status != 'sent')
  ORDER BY pe.created_at DESC;
END;
$$;

-- 5. DOCUMENT VERSION INTEGRITY CHECK
-- Finds duplicate is_current_version=true for same (match_id, doc_type)
CREATE OR REPLACE FUNCTION public.check_document_version_integrity()
RETURNS TABLE(
  match_id uuid,
  doc_type text,
  current_version_count bigint,
  issue text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    md.match_id,
    md.doc_type,
    count(*) AS current_version_count,
    format('%s documents marked as current version (expected 1)', count(*))::text AS issue
  FROM match_documents md
  WHERE md.is_current_version = true
  GROUP BY md.match_id, md.doc_type
  HAVING count(*) > 1;
END;
$$;

-- 6. FULL RECONCILIATION RUNNER
-- Single function that calls all checks and returns a summary
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
BEGIN
  SELECT count(*) INTO v_token_issues FROM public.reconcile_token_balances() WHERE status = 'MISMATCH';
  SELECT count(*) INTO v_chain_issues FROM public.verify_event_chain_integrity();
  SELECT count(*) INTO v_state_issues FROM public.check_match_state_invariants();
  SELECT count(*) INTO v_email_issues FROM public.check_engagement_email_delivery();
  SELECT count(*) INTO v_doc_issues FROM public.check_document_version_integrity();

  RETURN jsonb_build_object(
    'checked_at', now(),
    'token_balance_mismatches', v_token_issues,
    'event_chain_issues', v_chain_issues,
    'match_state_violations', v_state_issues,
    'email_delivery_gaps', v_email_issues,
    'document_version_conflicts', v_doc_issues,
    'overall_status', CASE
      WHEN (v_token_issues + v_chain_issues + v_state_issues + v_email_issues + v_doc_issues) = 0 THEN 'CLEAN'
      ELSE 'ISSUES_FOUND'
    END,
    'total_issues', v_token_issues + v_chain_issues + v_state_issues + v_email_issues + v_doc_issues
  );
END;
$$;
