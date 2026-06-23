-- poi_events append-only enforcement (first phased backend immutability hardening).
-- Blocks UPDATE, DELETE and TRUNCATE on public.poi_events at the database level.
-- No bypass GUC, no admin override, no service_role exception.

CREATE OR REPLACE FUNCTION public.assert_poi_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'POI_EVENTS_APPEND_ONLY: % blocked on public.poi_events', TG_OP
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_poi_events_append_only() FROM PUBLIC;

DROP TRIGGER IF EXISTS poi_events_no_mutate_trg ON public.poi_events;
CREATE TRIGGER poi_events_no_mutate_trg
  BEFORE UPDATE OR DELETE ON public.poi_events
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_poi_events_append_only();

DROP TRIGGER IF EXISTS poi_events_no_truncate_trg ON public.poi_events;
CREATE TRIGGER poi_events_no_truncate_trg
  BEFORE TRUNCATE ON public.poi_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.assert_poi_events_append_only();

COMMENT ON FUNCTION public.assert_poi_events_append_only() IS
  'Append-only enforcement for public.poi_events. Raises POI_EVENTS_APPEND_ONLY on UPDATE/DELETE/TRUNCATE. No bypass.';