-- Backfill: Insert reconciliation records for POI burns that bypassed token_ledger
INSERT INTO token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata)
SELECT 
  me.org_id,
  'action:declare_intent',
  COALESCE((me.event_data->>'tokens_burned')::int, 1),
  'allowed',
  0,  -- We don't know the exact balance at that moment
  'backfill_poi_' || me.match_id::text,
  'declare_intent',
  jsonb_build_object(
    'source', 'reconciliation_backfill',
    'match_id', me.match_id,
    'original_event_id', me.id,
    'original_created_at', me.created_at,
    'note', 'Backfilled from match_events - POI burn occurred before atomic_token_burn was self-auditing'
  )
FROM match_events me
WHERE me.event_type = 'poi.generated'
  AND NOT EXISTS (
    SELECT 1 FROM token_ledger tl 
    WHERE tl.org_id = me.org_id 
      AND tl.request_id = me.match_id::text
      AND tl.action_type = 'declare_intent'
  )
  AND NOT EXISTS (
    SELECT 1 FROM token_ledger tl 
    WHERE tl.org_id = me.org_id 
      AND tl.request_id = 'backfill_poi_' || me.match_id::text
  )
ON CONFLICT DO NOTHING;