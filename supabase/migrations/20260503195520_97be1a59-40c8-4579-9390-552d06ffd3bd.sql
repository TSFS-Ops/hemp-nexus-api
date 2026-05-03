
CREATE OR REPLACE FUNCTION public._is_uuid(p_text text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

CREATE OR REPLACE FUNCTION public.atomic_token_burn(
  p_org_id uuid, p_amount integer, p_reason text DEFAULT 'governance_burn'::text, p_reference_id text DEFAULT NULL::text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_old_balance integer; v_new_balance integer;
  v_correlation_id text; v_match_id_meta jsonb := '{}'::jsonb;
BEGIN
  UPDATE token_balances SET balance = balance - p_amount
   WHERE org_id = p_org_id AND balance >= p_amount
   RETURNING balance INTO v_new_balance;
  IF NOT FOUND THEN
    SELECT balance INTO v_old_balance FROM token_balances WHERE org_id = p_org_id;
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_TOKENS',
      'current_balance', COALESCE(v_old_balance, 0), 'requested_amount', p_amount);
  END IF;
  v_correlation_id := COALESCE(p_reference_id, gen_random_uuid()::text);
  IF p_reference_id IS NOT NULL AND public._is_uuid(p_reference_id) THEN
    v_match_id_meta := jsonb_build_object('match_id', p_reference_id);
  END IF;
  INSERT INTO token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata)
  VALUES (p_org_id, COALESCE(p_reason, 'unknown'), p_amount, 'allowed', v_new_balance, v_correlation_id,
    CASE WHEN p_reason LIKE 'action:%' THEN substring(p_reason from 8)
         WHEN p_reason LIKE 'api:%' THEN 'api_call' ELSE p_reason END,
    jsonb_build_object('source', 'atomic_token_burn', 'correlation_id', v_correlation_id,
      'balance_before', v_new_balance + p_amount, 'balance_after', v_new_balance) || v_match_id_meta);
  RETURN jsonb_build_object('success', true, 'balance_before', v_new_balance + p_amount,
    'balance_after', v_new_balance, 'burned', p_amount, 'reason', p_reason,
    'reference_id', p_reference_id, 'correlation_id', v_correlation_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atomic_token_burn(uuid, integer, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_token_burn(uuid, integer, text, text) FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_token_ledger_action_type_created ON public.token_ledger (action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_ledger_metadata_match_id ON public.token_ledger ((metadata->>'match_id')) WHERE metadata ? 'match_id';
CREATE INDEX IF NOT EXISTS idx_ledger_events_poi_minted_match ON public.ledger_events (match_id, occurred_at DESC) WHERE event_type = 'poi.minted';

CREATE OR REPLACE VIEW public.v_poi_burn_reconciliation AS
WITH live_burns AS (
  SELECT tl.id, tl.org_id, tl.action_type, tl.endpoint, tl.tokens_burned, tl.outcome,
         tl.request_id, tl.metadata, tl.created_at,
         NULLIF(tl.metadata->>'match_id', '')::uuid AS match_id_meta,
         CASE WHEN public._is_uuid(tl.request_id) THEN tl.request_id::uuid ELSE NULL END AS match_id_req
    FROM public.token_ledger tl
   WHERE tl.action_type IN ('declare_intent', 'poi_generation')
     AND tl.action_type NOT LIKE 'legacy_%'
)
SELECT lb.id, lb.org_id, lb.action_type, lb.endpoint, lb.tokens_burned, lb.outcome,
       lb.request_id, lb.created_at, COALESCE(lb.match_id_meta, lb.match_id_req) AS match_id,
       le.id AS ledger_event_id, le.occurred_at AS minted_at,
       CASE WHEN lb.outcome <> 'allowed' THEN 'failed_or_blocked'
            WHEN COALESCE(lb.match_id_meta, lb.match_id_req) IS NULL THEN 'orphan_no_match_id'
            WHEN le.id IS NOT NULL THEN 'matched_to_artefact'
            ELSE 'orphan_no_artefact' END AS classification
FROM live_burns lb
LEFT JOIN LATERAL (
  SELECT le.id, le.occurred_at FROM public.ledger_events le
   WHERE le.event_type = 'poi.minted' AND le.org_id = lb.org_id
     AND le.match_id = COALESCE(lb.match_id_meta, lb.match_id_req)
     AND le.occurred_at BETWEEN lb.created_at - interval '10 minutes' AND lb.created_at + interval '10 minutes'
   ORDER BY le.occurred_at LIMIT 1
) le ON true;

REVOKE ALL ON public.v_poi_burn_reconciliation FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_poi_burns(p_since interval DEFAULT interval '24 hours')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'window_start', now() - p_since, 'window_end', now(),
    'total_live_burns', count(*),
    'matched_to_artefact', count(*) FILTER (WHERE classification = 'matched_to_artefact'),
    'orphan_no_match_id', count(*) FILTER (WHERE classification = 'orphan_no_match_id'),
    'orphan_no_artefact', count(*) FILTER (WHERE classification = 'orphan_no_artefact'),
    'failed_or_blocked', count(*) FILTER (WHERE classification = 'failed_or_blocked'),
    'sample_orphans', (
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'org_id', r.org_id, 'match_id', r.match_id,
        'created_at', r.created_at, 'classification', r.classification))
      FROM (SELECT id, org_id, match_id, created_at, classification
              FROM public.v_poi_burn_reconciliation
             WHERE created_at >= now() - p_since AND classification LIKE 'orphan_%'
             ORDER BY created_at DESC LIMIT 5) r))
  INTO v FROM public.v_poi_burn_reconciliation WHERE created_at >= now() - p_since;
  RETURN v;
END; $$;

REVOKE EXECUTE ON FUNCTION public.reconcile_poi_burns(interval) FROM PUBLIC, anon, authenticated;
