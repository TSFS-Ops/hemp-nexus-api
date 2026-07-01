-- Batch J1 — token_ledger append-only trigger with narrow promotion allowlist.
-- Tracker item #35. Client decision: allow only the existing internal
-- promotion from 'credit' -> 'credit_purchase' performed by
-- atomic_paid_credit_purchase / repair_skeletal_paid_credit. Block every
-- other UPDATE and every DELETE, including for service_role and the
-- table owner (no role gate). Does not touch RLS, grants, policies,
-- ownership, the Batch B1 TRUNCATE trigger, indexes, or constraints.

CREATE OR REPLACE FUNCTION public.assert_token_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_has_marker boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'token_ledger_append_only: DELETE on public.token_ledger is not permitted (row id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- UPDATE path — narrow allowlist: credit -> credit_purchase promotion only.

  -- 1. Identity / balance-affecting columns must NOT change.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.api_key_id IS DISTINCT FROM OLD.api_key_id
     OR NEW.tokens_burned IS DISTINCT FROM OLD.tokens_burned
     OR NEW.remaining_balance IS DISTINCT FROM OLD.remaining_balance
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.is_demo IS DISTINCT FROM OLD.is_demo
     OR NEW.demo_dataset_id IS DISTINCT FROM OLD.demo_dataset_id
  THEN
    RAISE EXCEPTION 'token_ledger_append_only: protected column changed on public.token_ledger (row id=%). Only the narrow credit -> credit_purchase promotion is allowed.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2. action_type transition must be exactly credit -> credit_purchase,
  --    OR unchanged (which, given the identity guard above, means the
  --    only remaining mutable columns are endpoint and metadata for the
  --    same 'credit_purchase' row after promotion — reject that as it
  --    has no legitimate live writer).
  IF NOT (OLD.action_type = 'credit' AND NEW.action_type = 'credit_purchase') THEN
    RAISE EXCEPTION 'token_ledger_append_only: UPDATE on public.token_ledger requires credit -> credit_purchase promotion (row id=%, old=%, new=%)',
      OLD.id, OLD.action_type, NEW.action_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- 3. Approved promotion metadata marker must be present in NEW.metadata.
  v_has_marker := (
    NEW.metadata IS NOT NULL
    AND (NEW.metadata ? 'promoted_by' OR NEW.metadata ? 'repaired_by')
  );

  IF NOT v_has_marker THEN
    RAISE EXCEPTION 'token_ledger_append_only: promotion requires approved metadata marker promoted_by or repaired_by (row id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS token_ledger_append_only_trg ON public.token_ledger;

CREATE TRIGGER token_ledger_append_only_trg
BEFORE UPDATE OR DELETE ON public.token_ledger
FOR EACH ROW
EXECUTE FUNCTION public.assert_token_ledger_append_only();

COMMENT ON FUNCTION public.assert_token_ledger_append_only() IS
  'Batch J1 (#35): enforces token_ledger append-only with narrow allowlist for the internal credit -> credit_purchase promotion (atomic_paid_credit_purchase, repair_skeletal_paid_credit). Blocks all other UPDATE and every DELETE, including service_role.';