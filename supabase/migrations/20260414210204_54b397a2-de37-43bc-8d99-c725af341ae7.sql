-- =============================================================
-- 1.1: Fix atomic_seal_deal — write status='settled' not 'completed'
-- =============================================================
CREATE OR REPLACE FUNCTION public.atomic_seal_deal(
p_match_id uuid,
p_org_id uuid,
p_expected_state text,
p_event_type text,
p_event_data jsonb,
p_actor_user_id uuid,
p_actor_api_key_id uuid DEFAULT NULL,
p_collapse_payload jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_match RECORD;
v_prev_hash text;
v_payload_hash text;
v_event_id uuid;
v_collapse_id uuid;
v_result jsonb;
BEGIN
SELECT * INTO v_match
FROM matches
WHERE id = p_match_id
FOR UPDATE;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Match not found', 'stage', 'match_lock');
END IF;

IF v_match.org_id != p_org_id
AND v_match.buyer_org_id IS DISTINCT FROM p_org_id
AND v_match.seller_org_id IS DISTINCT FROM p_org_id THEN
RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Not a party to this deal', 'stage', 'ownership');
END IF;

IF COALESCE(v_match.state, 'discovery') != p_expected_state THEN
RETURN jsonb_build_object(
'success', false, 'error', 'STATE_CONFLICT',
'message', format('Expected state %s but found %s', p_expected_state, COALESCE(v_match.state, 'discovery')),
'current_state', COALESCE(v_match.state, 'discovery'),
'stage', 'state_guard'
);
END IF;

UPDATE matches
SET state = 'completed',
status = 'settled',
settled_at = now()
WHERE id = p_match_id;

SELECT payload_hash INTO v_prev_hash
FROM match_events
WHERE match_id = p_match_id
ORDER BY created_at DESC
LIMIT 1;

v_payload_hash := public.generate_event_hash(p_event_type, p_event_data, v_prev_hash);

INSERT INTO match_events (
match_id, org_id, event_type, event_data,
actor_user_id, payload_hash, previous_event_hash
) VALUES (
p_match_id, p_org_id, p_event_type, p_event_data,
p_actor_user_id, v_payload_hash, v_prev_hash
)
RETURNING id INTO v_event_id;

UPDATE matches SET event_chain_hash = v_payload_hash WHERE id = p_match_id;

IF p_collapse_payload IS NOT NULL THEN
INSERT INTO collapse_ledger (
match_id, org_id, counterparty_org_id,
asset_id, currency, price, quantity,
poi_state, payload_hash, signed_payload,
idempotency_key, client_timestamp, signature_valid
) VALUES (
p_match_id,
p_org_id,
COALESCE(p_collapse_payload->>'counterparty_org_id', ''),
COALESCE(p_collapse_payload->>'asset_id', 'unknown'),
COALESCE(p_collapse_payload->>'currency', 'USD'),
COALESCE((p_collapse_payload->>'price')::numeric, 0),
COALESCE((p_collapse_payload->>'quantity')::numeric, 0),
'completed',
v_payload_hash,
COALESCE(p_collapse_payload->>'signed_payload', v_payload_hash),
COALESCE(p_collapse_payload->>'idempotency_key', 'seal_' || p_match_id::text || '_' || extract(epoch from now())::text),
now(),
true
)
RETURNING id INTO v_collapse_id;
END IF;

INSERT INTO audit_logs (
org_id, actor_user_id, actor_api_key_id,
action, entity_type, entity_id, metadata
) VALUES (
p_org_id, p_actor_user_id, p_actor_api_key_id,
'deal.sealed', 'match', p_match_id::text,
jsonb_build_object(
'event_id', v_event_id,
'collapse_id', v_collapse_id,
'payload_hash', v_payload_hash,
'previous_hash', v_prev_hash
)
);

SELECT row_to_json(m.*) INTO v_result FROM matches m WHERE m.id = p_match_id;

RETURN jsonb_build_object(
'success', true,
'match', v_result,
'event_id', v_event_id,
'collapse_id', v_collapse_id,
'payload_hash', v_payload_hash,
'previous_hash', v_prev_hash
);
END;
$function$;

-- =============================================================
-- 1.2: Clean invalid poi_state values, then add CHECK constraint
-- =============================================================
UPDATE matches SET poi_state = 'COMPLETED' WHERE poi_state = 'COLLAPSED';

ALTER TABLE matches ADD CONSTRAINT matches_poi_state_check
CHECK (poi_state IS NULL OR poi_state = ANY(ARRAY[
'DRAFT','PENDING_APPROVAL','ELIGIBLE','COMPLETION_REQUESTED',
'COMPLETED','EXPIRED','ANNULLED','REJECTED'
]));

-- =============================================================
-- 1.3: Delete legacy 'admin' rows (user already has 'platform_admin')
-- =============================================================
DELETE FROM user_roles WHERE role = 'admin';

CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT EXISTS (
SELECT 1 FROM public.user_roles ur
WHERE ur.user_id = $1 AND ur.role = 'platform_admin'
)
$function$;

-- =============================================================
-- 1.5: Remove broken/duplicate cron jobs
-- =============================================================
-- Guard: clean disposable-DB replay may not have this job registered.
DO $guard_sahpra$
BEGIN
IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sahpra-daily-refresh') THEN
PERFORM cron.unschedule('sahpra-daily-refresh');
END IF;
END
$guard_sahpra$;
DO $$
BEGIN
IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lifecycle-scheduler-daily') THEN
PERFORM cron.unschedule('lifecycle-scheduler-daily');
END IF;
END $$;
