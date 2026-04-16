CREATE OR REPLACE FUNCTION public.dry_run_legacy_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token_fixes jsonb;
  v_state_fixes jsonb;
  v_chain_fixes jsonb;
BEGIN
  -- 1. TOKEN BALANCE FIXES: identify what adjustment ledger entries would be inserted
  -- Strategy: insert a corrective 'system_adjustment' credit/debit into token_ledger
  -- so that computed_balance matches recorded_balance. NO balance changes.
  SELECT jsonb_agg(jsonb_build_object(
    'org_id', r.org_id,
    'recorded_balance', r.recorded_balance,
    'computed_balance', r.computed_balance,
    'discrepancy', r.discrepancy,
    'action', CASE
      WHEN r.discrepancy > 0 THEN 'INSERT credit adjustment into token_ledger for +' || r.discrepancy || ' to align ledger with actual balance'
      WHEN r.discrepancy < 0 THEN 'INSERT debit adjustment into token_ledger for ' || r.discrepancy || ' to align ledger with actual balance'
    END,
    'ledger_entry', jsonb_build_object(
      'org_id', r.org_id,
      'endpoint', 'system_reconciliation_2026-04-16',
      'tokens_burned', CASE WHEN r.discrepancy < 0 THEN abs(r.discrepancy) ELSE 0 END,
      'outcome', 'allowed',
      'action_type', CASE WHEN r.discrepancy > 0 THEN 'credit' ELSE 'system_adjustment' END,
      'metadata', jsonb_build_object(
        'reason', 'system_reconciliation_2026-04-16',
        'original_discrepancy', r.discrepancy,
        'recorded_balance', r.recorded_balance,
        'computed_before', r.computed_balance
      )
    )
  ))
  INTO v_token_fixes
  FROM public.reconcile_token_balances() r
  WHERE r.status = 'MISMATCH';

  -- 2. STATE VIOLATION FIXES
  SELECT jsonb_agg(fix)
  INTO v_state_fixes
  FROM (
    -- 2a. Missing poi.generated events: backfill with system_reconciliation event
    SELECT jsonb_build_object(
      'match_id', m.id,
      'violation', 'missing poi.generated event',
      'action', 'INSERT match_event with event_type=poi.generated, tagged as system_reconciliation',
      'proposed_event', jsonb_build_object(
        'match_id', m.id,
        'org_id', m.org_id,
        'event_type', 'poi.generated',
        'event_data', jsonb_build_object(
          'settled_at', m.settled_at,
          'source', 'system_reconciliation_2026-04-16',
          'note', 'Backfilled for pre-atomic legacy match'
        )
      )
    ) AS fix
    FROM matches m
    WHERE m.state IN ('committed', 'completed')
      AND NOT EXISTS (
        SELECT 1 FROM match_events me
        WHERE me.match_id = m.id AND me.event_type = 'poi.generated'
      )

    UNION ALL

    -- 2b. Missing collapse_ledger entries
    SELECT jsonb_build_object(
      'match_id', m.id,
      'violation', 'missing collapse_ledger entry',
      'action', 'INSERT collapse_ledger entry tagged as system_reconciliation',
      'proposed_entry', jsonb_build_object(
        'match_id', m.id,
        'org_id', m.org_id,
        'poi_state', m.poi_state,
        'idempotency_key', 'reconcile_' || m.id::text || '_2026-04-16'
      )
    ) AS fix
    FROM matches m
    WHERE m.state IN ('committed', 'completed')
      AND NOT EXISTS (
        SELECT 1 FROM collapse_ledger cl WHERE cl.match_id = m.id
      )

    UNION ALL

    -- 2c. Discovery matches with settled_at (should be NULL)
    SELECT jsonb_build_object(
      'match_id', m.id,
      'violation', 'discovery state but settled_at is set',
      'action', 'SET settled_at = NULL (match never actually settled)',
      'current_settled_at', m.settled_at
    ) AS fix
    FROM matches m
    WHERE m.state = 'discovery' AND m.settled_at IS NOT NULL

    UNION ALL

    -- 2d. Committed with one-sided timestamps
    SELECT jsonb_build_object(
      'match_id', m.id,
      'violation', 'committed with missing buyer/seller timestamp',
      'action', 'SET missing timestamp to settled_at value',
      'buyer_committed_at', m.buyer_committed_at,
      'seller_committed_at', m.seller_committed_at,
      'settled_at', m.settled_at
    ) AS fix
    FROM matches m
    WHERE m.state IN ('committed', 'completed')
      AND (m.buyer_committed_at IS NULL OR m.seller_committed_at IS NULL)
  ) sub;

  -- 3. EVENT CHAIN HASH FIX
  SELECT jsonb_agg(jsonb_build_object(
    'match_id', i.match_id,
    'issue_type', i.issue_type,
    'action', CASE
      WHEN i.issue_type = 'HASH_DRIFT' THEN 'UPDATE matches SET event_chain_hash = latest event hash'
      WHEN i.issue_type = 'MISSING_HASH' THEN 'UPDATE matches SET event_chain_hash = latest event hash'
      ELSE 'REQUIRES MANUAL REVIEW: ' || i.details
    END,
    'details', i.details
  ))
  INTO v_chain_fixes
  FROM public.verify_event_chain_integrity() i;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'mode', 'DRY_RUN — no data was modified',
    'token_balance_fixes', jsonb_build_object(
      'count', COALESCE(jsonb_array_length(v_token_fixes), 0),
      'strategy', 'Insert corrective ledger entries to align token_ledger with actual token_balances. No balances are changed.',
      'proposed_changes', COALESCE(v_token_fixes, '[]'::jsonb)
    ),
    'state_violation_fixes', jsonb_build_object(
      'count', COALESCE(jsonb_array_length(v_state_fixes), 0),
      'strategy', 'Backfill missing events and ledger entries for pre-atomic legacy matches. Tag all as system_reconciliation.',
      'proposed_changes', COALESCE(v_state_fixes, '[]'::jsonb)
    ),
    'event_chain_fixes', jsonb_build_object(
      'count', COALESCE(jsonb_array_length(v_chain_fixes), 0),
      'strategy', 'Set matches.event_chain_hash to latest match_events.payload_hash where drifted or NULL.',
      'proposed_changes', COALESCE(v_chain_fixes, '[]'::jsonb)
    )
  );
END;
$$;

-- Only admins can run this
REVOKE EXECUTE ON FUNCTION public.dry_run_legacy_reconciliation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.dry_run_legacy_reconciliation() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dry_run_legacy_reconciliation() TO authenticated;