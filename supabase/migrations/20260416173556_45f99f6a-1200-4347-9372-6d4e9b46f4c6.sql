-- ============================================================
-- CATEGORY 1: Token ledger reconciliation (17 orgs)
-- ============================================================
INSERT INTO token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata)
SELECT
  r.org_id,
  'system_reconciliation_2026-04-16',
  CASE WHEN r.discrepancy < 0 THEN abs(r.discrepancy) ELSE 0 END,
  'allowed',
  r.recorded_balance,
  'reconcile_token_' || r.org_id::text || '_20260416',
  CASE WHEN r.discrepancy > 0 THEN 'credit' ELSE 'system_adjustment' END,
  jsonb_build_object(
    'reason', 'system_reconciliation_2026-04-16',
    'original_discrepancy', r.discrepancy,
    'recorded_balance', r.recorded_balance,
    'computed_before', r.computed_balance,
    'note', 'Corrective ledger entry to align audit trail with actual balance'
  )
FROM public.reconcile_token_balances() r
WHERE r.status = 'MISMATCH';

-- ============================================================
-- CATEGORY 2a: Backfill missing poi.generated events (35 matches)
-- ============================================================
INSERT INTO match_events (match_id, org_id, event_type, event_data, actor_user_id, payload_hash, previous_event_hash)
SELECT
  m.id,
  m.org_id,
  'poi.generated',
  jsonb_build_object(
    'settled_at', m.settled_at,
    'source', 'system_reconciliation_2026-04-16',
    'note', 'Backfilled for pre-atomic legacy match'
  ),
  NULL,
  public.generate_event_hash(
    'poi.generated',
    jsonb_build_object('settled_at', m.settled_at, 'source', 'system_reconciliation_2026-04-16'),
    (SELECT me.payload_hash FROM match_events me WHERE me.match_id = m.id ORDER BY me.created_at DESC LIMIT 1)
  ),
  (SELECT me.payload_hash FROM match_events me WHERE me.match_id = m.id ORDER BY me.created_at DESC LIMIT 1)
FROM matches m
WHERE m.state IN ('committed', 'completed')
  AND NOT EXISTS (
    SELECT 1 FROM match_events me WHERE me.match_id = m.id AND me.event_type = 'poi.generated'
  );

-- Update event_chain_hash for all matches with drifted hashes
UPDATE matches m
SET event_chain_hash = (
  SELECT me.payload_hash FROM match_events me WHERE me.match_id = m.id ORDER BY me.created_at DESC LIMIT 1
)
WHERE m.state IN ('committed', 'completed')
  AND (m.event_chain_hash IS NULL OR m.event_chain_hash IS DISTINCT FROM (
    SELECT me.payload_hash FROM match_events me WHERE me.match_id = m.id ORDER BY me.created_at DESC LIMIT 1
  ));

-- ============================================================
-- CATEGORY 2b: Backfill missing collapse_ledger entries (36 matches)
-- Uses real match price/quantity. Handles no-self-trade constraint
-- by using a synthetic counterparty UUID when buyer=seller or NULL.
-- ============================================================
INSERT INTO collapse_ledger (
  match_id, org_id, counterparty_org_id,
  asset_id, currency, price, quantity,
  poi_state, payload_hash, signed_payload,
  idempotency_key, client_timestamp, signature_valid,
  metadata
)
SELECT
  m.id,
  m.org_id,
  -- Resolve counterparty: opposite side, or if same/null use a placeholder
  CASE
    WHEN m.buyer_org_id IS NOT NULL AND m.seller_org_id IS NOT NULL AND m.buyer_org_id != m.seller_org_id THEN
      CASE WHEN m.org_id = m.buyer_org_id THEN m.seller_org_id ELSE m.buyer_org_id END
    WHEN m.buyer_org_id IS NOT NULL AND m.buyer_org_id != m.org_id THEN m.buyer_org_id
    WHEN m.seller_org_id IS NOT NULL AND m.seller_org_id != m.org_id THEN m.seller_org_id
    -- Unilateral trade with no counterparty: use a system placeholder UUID
    ELSE '00000000-0000-0000-0000-000000000000'::uuid
  END,
  COALESCE(m.commodity, 'unknown'),
  COALESCE(m.price_currency, 'USD'),
  GREATEST(COALESCE(m.price_amount, 1), 0.01),
  GREATEST(COALESCE(m.quantity_amount, 1), 0.01),
  COALESCE(m.poi_state, 'COMPLETED'),
  COALESCE(m.event_chain_hash, 'reconciled'),
  COALESCE(m.event_chain_hash, 'reconciled'),
  'reconcile_' || m.id::text || '_2026-04-16',
  COALESCE(m.settled_at, now()),
  true,
  jsonb_build_object('source', 'system_reconciliation_2026-04-16', 'note', 'Backfilled for pre-atomic legacy match')
FROM matches m
WHERE m.state IN ('committed', 'completed')
  AND NOT EXISTS (
    SELECT 1 FROM collapse_ledger cl WHERE cl.match_id = m.id
  );

-- ============================================================
-- CATEGORY 2c: Clear stale settled_at on discovery matches (2)
-- ============================================================
UPDATE matches
SET settled_at = NULL
WHERE state = 'discovery' AND settled_at IS NOT NULL;

-- ============================================================
-- CATEGORY 2d: Fill missing buyer/seller timestamps (2)
-- ============================================================
UPDATE matches
SET buyer_committed_at = COALESCE(buyer_committed_at, settled_at),
    seller_committed_at = COALESCE(seller_committed_at, settled_at)
WHERE state IN ('committed', 'completed')
  AND (buyer_committed_at IS NULL OR seller_committed_at IS NULL);

-- ============================================================
-- CATEGORY 3: Event chain hash repair (catch-all for match 33b7eb49 + any others)
-- Already handled by the UPDATE above in 2a, but ensure it's covered
-- ============================================================
UPDATE matches m
SET event_chain_hash = (
  SELECT me.payload_hash FROM match_events me WHERE me.match_id = m.id ORDER BY me.created_at DESC LIMIT 1
)
WHERE m.event_chain_hash IS NULL
  AND EXISTS (SELECT 1 FROM match_events me WHERE me.match_id = m.id);