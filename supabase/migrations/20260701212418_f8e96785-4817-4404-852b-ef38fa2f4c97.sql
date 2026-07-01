-- Batch J1 — token_ledger append-only trigger with widened narrow
-- promotion allowlist. Tracker item #35.
--
-- Live UPDATE writers covered by this allowlist:
--   * public.atomic_paid_credit_purchase   (credit -> credit_purchase, marker promoted_by)
--   * public.repair_skeletal_paid_credit   (credit -> credit_purchase, marker repaired_by)
--   * supabase/functions/token-purchase/index.ts refund branch
--                                          (credit -> credit_refund,  marker refund_reference)
--
-- Blocks every DELETE and every UPDATE outside those two label
-- promotions. No role gate — service_role and the table owner are also
-- subject to the trigger. Does not touch RLS, grants, policies,
-- ownership, indexes, constraints, the Batch B1 TRUNCATE trigger, or
-- enforce_demo_inheritance_trg.

CREATE OR REPLACE FUNCTION public.assert_token_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_has_marker      boolean;
  v_is_purchase     boolean;
  v_is_refund       boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'token_ledger_append_only: DELETE on public.token_ledger is not permitted (row id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Protected columns: must never change on any UPDATE.
  IF NEW.id                IS DISTINCT FROM OLD.id
     OR NEW.org_id         IS DISTINCT FROM OLD.org_id
     OR NEW.api_key_id     IS DISTINCT FROM OLD.api_key_id
     OR NEW.tokens_burned  IS DISTINCT FROM OLD.tokens_burned
     OR NEW.remaining_balance IS DISTINCT FROM OLD.remaining_balance
     OR NEW.outcome        IS DISTINCT FROM OLD.outcome
     OR NEW.request_id     IS DISTINCT FROM OLD.request_id
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at
     OR NEW.entity_id      IS DISTINCT FROM OLD.entity_id
     OR NEW.is_demo        IS DISTINCT FROM OLD.is_demo
     OR NEW.demo_dataset_id IS DISTINCT FROM OLD.demo_dataset_id
  THEN
    RAISE EXCEPTION 'token_ledger_append_only: protected column changed on public.token_ledger (row id=%). Only credit -> credit_purchase or credit -> credit_refund label/metadata promotion is allowed.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Allowed transitions.
  v_is_purchase := (OLD.action_type = 'credit' AND NEW.action_type = 'credit_purchase');
  v_is_refund   := (OLD.action_type = 'credit' AND NEW.action_type = 'credit_refund');

  IF NOT (v_is_purchase OR v_is_refund) THEN
    RAISE EXCEPTION 'token_ledger_append_only: UPDATE requires an approved promotion (credit->credit_purchase or credit->credit_refund) (row id=%, old=%, new=%)',
      OLD.id, OLD.action_type, NEW.action_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.metadata IS NULL THEN
    RAISE EXCEPTION 'token_ledger_append_only: promotion requires approved metadata marker (row id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_is_purchase THEN
    v_has_marker := (NEW.metadata ? 'promoted_by' OR NEW.metadata ? 'repaired_by');
    IF NOT v_has_marker THEN
      RAISE EXCEPTION 'token_ledger_append_only: credit->credit_purchase promotion requires metadata marker promoted_by or repaired_by (row id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- v_is_refund
    v_has_marker := (
      NEW.metadata ? 'refund_reference'
      OR NEW.metadata ? 'refunded_by'
      OR NEW.metadata ? 'promoted_by'
    );
    IF NOT v_has_marker THEN
      RAISE EXCEPTION 'token_ledger_append_only: credit->credit_refund promotion requires metadata marker refund_reference, refunded_by, or promoted_by (row id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
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
  'Batch J1 (#35): enforces token_ledger append-only with narrow allowlist for two internal label promotions — credit -> credit_purchase (markers promoted_by/repaired_by) and credit -> credit_refund (markers refund_reference/refunded_by/promoted_by). Blocks every other UPDATE and every DELETE, including for service_role.';