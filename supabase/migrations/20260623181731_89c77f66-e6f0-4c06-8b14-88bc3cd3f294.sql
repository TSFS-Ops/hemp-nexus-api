-- Make public.match_events database-enforced append-only.
-- Blocks UPDATE, DELETE and TRUNCATE via a SECURITY DEFINER trigger
-- function. No bypass GUC, no admin override, no service_role exception.
-- Mirrors the poi_events posture exactly. Does not alter RLS, grants,
-- ownership, or any match/POI/WaD/payment/refund/registry behaviour.

CREATE OR REPLACE FUNCTION public.assert_match_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    'MATCH_EVENTS_APPEND_ONLY: % blocked on public.match_events', TG_OP
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS match_events_no_mutate_trg ON public.match_events;
CREATE TRIGGER match_events_no_mutate_trg
BEFORE UPDATE OR DELETE ON public.match_events
FOR EACH ROW
EXECUTE FUNCTION public.assert_match_events_append_only();

DROP TRIGGER IF EXISTS match_events_no_truncate_trg ON public.match_events;
CREATE TRIGGER match_events_no_truncate_trg
BEFORE TRUNCATE ON public.match_events
FOR EACH STATEMENT
EXECUTE FUNCTION public.assert_match_events_append_only();