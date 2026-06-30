
-- Batch B1 — TRUNCATE guards on append-only / sealed tables.
-- Closes the residual immutability gap where existing BEFORE UPDATE/DELETE
-- triggers do not fire for TRUNCATE (TRUNCATE needs a statement-level
-- BEFORE TRUNCATE trigger). Trigger-based protection is preferred over
-- FORCE ROW LEVEL SECURITY because FORCE RLS would break SECURITY DEFINER
-- and service-role maintenance paths that this project relies on.

CREATE OR REPLACE FUNCTION public.prevent_protected_table_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RAISE EXCEPTION
    'protected_table_truncate_blocked: TRUNCATE on %.% is not permitted (append-only / sealed-immutability protected table)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'check_violation',
          HINT    = 'Append-only and sealed tables cannot be truncated. Use row-level delete with the documented escape hatch where applicable.';
END;
$function$;

-- event_store
DROP TRIGGER IF EXISTS event_store_no_truncate_trg ON public.event_store;
CREATE TRIGGER event_store_no_truncate_trg
  BEFORE TRUNCATE ON public.event_store
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prevent_protected_table_truncate();

-- match_events
DROP TRIGGER IF EXISTS match_events_no_truncate_trg ON public.match_events;
CREATE TRIGGER match_events_no_truncate_trg
  BEFORE TRUNCATE ON public.match_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prevent_protected_table_truncate();

-- poi_events
DROP TRIGGER IF EXISTS poi_events_no_truncate_trg ON public.poi_events;
CREATE TRIGGER poi_events_no_truncate_trg
  BEFORE TRUNCATE ON public.poi_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prevent_protected_table_truncate();

-- audit_logs
DROP TRIGGER IF EXISTS audit_logs_no_truncate_trg ON public.audit_logs;
CREATE TRIGGER audit_logs_no_truncate_trg
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prevent_protected_table_truncate();

-- admin_audit_logs
DROP TRIGGER IF EXISTS admin_audit_logs_no_truncate_trg ON public.admin_audit_logs;
CREATE TRIGGER admin_audit_logs_no_truncate_trg
  BEFORE TRUNCATE ON public.admin_audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prevent_protected_table_truncate();

-- wads
DROP TRIGGER IF EXISTS wads_no_truncate_trg ON public.wads;
CREATE TRIGGER wads_no_truncate_trg
  BEFORE TRUNCATE ON public.wads
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prevent_protected_table_truncate();

-- token_ledger
DROP TRIGGER IF EXISTS token_ledger_no_truncate_trg ON public.token_ledger;
CREATE TRIGGER token_ledger_no_truncate_trg
  BEFORE TRUNCATE ON public.token_ledger
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prevent_protected_table_truncate();

-- wad_attestations
DROP TRIGGER IF EXISTS wad_attestations_no_truncate_trg ON public.wad_attestations;
CREATE TRIGGER wad_attestations_no_truncate_trg
  BEFORE TRUNCATE ON public.wad_attestations
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prevent_protected_table_truncate();
