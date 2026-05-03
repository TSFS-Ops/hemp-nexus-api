CREATE OR REPLACE VIEW public.v_poi_burn_reconciliation AS
WITH first_mint AS (
  SELECT MIN(occurred_at) AS first_mint_at
  FROM public.ledger_events
  WHERE event_type = 'poi.minted'
),
live_burns AS (
  SELECT tl.id, tl.org_id, tl.action_type, tl.endpoint, tl.tokens_burned,
         tl.outcome, tl.request_id, tl.metadata, tl.created_at,
         NULLIF(tl.metadata->>'match_id','')::uuid AS match_id_meta,
         CASE WHEN public._is_uuid(tl.request_id) THEN tl.request_id::uuid ELSE NULL END AS match_id_req
  FROM public.token_ledger tl
  WHERE tl.action_type = ANY (ARRAY['declare_intent','poi_generation'])
    AND tl.action_type NOT LIKE 'legacy_%'
)
SELECT
  lb.id, lb.org_id, lb.action_type, lb.endpoint, lb.tokens_burned, lb.outcome,
  lb.request_id, lb.created_at,
  COALESCE(lb.match_id_meta, lb.match_id_req) AS match_id,
  le.id AS ledger_event_id,
  le.occurred_at AS minted_at,
  CASE
    WHEN lb.outcome <> 'allowed' THEN 'failed_or_blocked'
    WHEN COALESCE(lb.match_id_meta, lb.match_id_req) IS NULL THEN 'orphan_no_match_id'
    WHEN le.id IS NOT NULL THEN 'matched_to_artefact'
    WHEN lb.created_at < (SELECT first_mint_at FROM first_mint)
         AND m.poi_state IS NOT NULL
      THEN 'legacy_missing_mint_event_but_match_poi_state_exists'
    WHEN lb.created_at < (SELECT first_mint_at FROM first_mint)
         AND m.id IS NULL
      THEN 'legacy_pre_atomic_generate_poi_v2_match_deleted'
    WHEN lb.created_at < (SELECT first_mint_at FROM first_mint)
      THEN 'legacy_pre_event_model'
    ELSE 'orphan_no_artefact'
  END AS classification
FROM live_burns lb
LEFT JOIN public.matches m ON m.id = COALESCE(lb.match_id_meta, lb.match_id_req)
LEFT JOIN LATERAL (
  SELECT le1.id, le1.occurred_at
  FROM public.ledger_events le1
  WHERE le1.event_type = 'poi.minted'
    AND le1.org_id = lb.org_id
    AND le1.match_id = COALESCE(lb.match_id_meta, lb.match_id_req)
    AND le1.occurred_at BETWEEN lb.created_at - interval '10 minutes' AND lb.created_at + interval '10 minutes'
  ORDER BY le1.occurred_at
  LIMIT 1
) le ON true;