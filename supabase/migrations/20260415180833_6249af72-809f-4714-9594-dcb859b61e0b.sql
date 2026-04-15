
-- 1. Fix generate_event_hash to use schema-qualified digest()
CREATE OR REPLACE FUNCTION public.generate_event_hash(event_type text, event_data jsonb, previous_hash text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  payload TEXT;
BEGIN
  payload := event_type || event_data::text || COALESCE(previous_hash, '');
  RETURN encode(extensions.digest(payload::bytea, 'sha256'), 'hex');
END;
$function$;

-- 2. Insert legacy.seed events for the 4 completed matches with zero events
DO $$
DECLARE
  v_match RECORD;
  v_hash text;
  v_event_data jsonb;
BEGIN
  FOR v_match IN
    SELECT id, org_id, settled_at FROM matches
    WHERE id IN (
      'ee16fd0e-d900-463c-931f-2b9705fc65e5',
      '5189e2f6-8764-4663-8a74-8e58d8932595',
      '1841611d-8af8-49f0-84db-7e5a6994c34a',
      'e9712fbb-d376-46ab-af1e-44bcd735619c'
    )
    AND event_chain_hash IS NULL
  LOOP
    v_event_data := jsonb_build_object(
      'reason', 'Pre-event-system record. Seed event inserted for hash chain integrity.',
      'settled_at', v_match.settled_at
    );
    v_hash := public.generate_event_hash('legacy.seed', v_event_data, NULL);

    INSERT INTO match_events (match_id, org_id, event_type, event_data, actor_user_id, payload_hash, previous_event_hash)
    VALUES (v_match.id, v_match.org_id, 'legacy.seed', v_event_data, NULL, v_hash, NULL);

    UPDATE matches SET event_chain_hash = v_hash WHERE id = v_match.id;
  END LOOP;
END;
$$;
