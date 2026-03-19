
-- Write dispute lifecycle events into match_events so they appear in the Timeline tab.
-- Uses hash chaining consistent with the existing event store pattern.

CREATE OR REPLACE FUNCTION public.record_dispute_to_match_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
  v_event_data jsonb;
  v_previous_hash text;
  v_payload_hash text;
BEGIN
  -- Determine event type
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'dispute.raised';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_event_type := 'dispute.' || NEW.status;
  ELSE
    RETURN NEW;
  END IF;

  -- Build event data
  v_event_data := jsonb_build_object(
    'dispute_id', NEW.id,
    'status', NEW.status,
    'reason', NEW.reason,
    'resolution_outcome', NEW.resolution_outcome
  );

  -- Get previous hash for chain
  SELECT payload_hash INTO v_previous_hash
  FROM match_events
  WHERE match_id = NEW.match_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- Generate hash
  v_payload_hash := public.generate_event_hash(v_event_type, v_event_data, v_previous_hash);

  -- Insert event
  INSERT INTO match_events (
    match_id,
    org_id,
    event_type,
    event_data,
    actor_user_id,
    payload_hash,
    previous_event_hash
  ) VALUES (
    NEW.match_id,
    NEW.raised_by_org_id,
    v_event_type,
    v_event_data,
    COALESCE(NEW.resolved_by, NEW.raised_by_user_id),
    v_payload_hash,
    v_previous_hash
  );

  RETURN NEW;
END;
$$;

-- Trigger on INSERT (dispute raised)
CREATE TRIGGER trg_dispute_to_match_events_insert
  AFTER INSERT ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.record_dispute_to_match_events();

-- Trigger on UPDATE (status change: resolved, escalated, withdrawn)
CREATE TRIGGER trg_dispute_to_match_events_update
  AFTER UPDATE ON public.disputes
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.record_dispute_to_match_events();

-- Harden: no anon/public access
REVOKE EXECUTE ON FUNCTION public.record_dispute_to_match_events() FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_dispute_to_match_events() FROM public;
