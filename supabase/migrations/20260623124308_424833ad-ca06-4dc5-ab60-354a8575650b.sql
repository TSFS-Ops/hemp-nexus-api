-- ============================================================
-- Payment hardening pre-PayFast: atomic paid credit + repair RPC
-- Additive only. Does NOT modify atomic_token_credit.
-- ============================================================

-- 1) Atomic paid credit purchase: balance update + finalised
--    ledger row in ONE transaction. Idempotent on p_reference_id.
CREATE OR REPLACE FUNCTION public.atomic_paid_credit_purchase(
  p_org_id       uuid,
  p_amount       integer,
  p_reference_id text,
  p_endpoint     text,
  p_metadata     jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_existing_id          uuid;
  v_existing_action_type text;
  v_new_balance          integer;
  v_old_balance          integer;
  v_ledger_id            uuid;
BEGIN
  IF p_org_id IS NULL OR p_amount IS NULL OR p_amount <= 0 OR p_reference_id IS NULL OR length(btrim(p_reference_id)) = 0 THEN
    RAISE EXCEPTION 'atomic_paid_credit_purchase: invalid arguments';
  END IF;

  -- Lock any existing row keyed on this provider reference. The partial
  -- UNIQUE index on token_ledger(request_id) WHERE request_id IS NOT NULL
  -- guarantees at most one row matches.
  SELECT id, action_type
    INTO v_existing_id, v_existing_action_type
  FROM token_ledger
  WHERE request_id = p_reference_id
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_action_type = 'credit_purchase' THEN
      -- Already finalised: return current balance unchanged.
      SELECT balance INTO v_new_balance FROM token_balances WHERE org_id = p_org_id;
      RETURN jsonb_build_object(
        'success',          true,
        'already_credited', true,
        'new_balance',      COALESCE(v_new_balance, 0),
        'ledger_id',        v_existing_id,
        'credited',         0
      );
    ELSIF v_existing_action_type = 'credit' THEN
      -- Legacy skeletal row from a prior partial run: promote in place.
      -- Balance was already incremented when the skeletal row was written.
      UPDATE token_ledger
      SET action_type = 'credit_purchase',
          endpoint    = COALESCE(p_endpoint, endpoint),
          metadata    = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb)
                        || jsonb_build_object('promoted_by','atomic_paid_credit_purchase','promoted_at', now())
      WHERE id = v_existing_id;

      SELECT balance INTO v_new_balance FROM token_balances WHERE org_id = p_org_id;
      RETURN jsonb_build_object(
        'success',          true,
        'already_credited', true,
        'promoted',         true,
        'new_balance',      COALESCE(v_new_balance, 0),
        'ledger_id',        v_existing_id,
        'credited',         0
      );
    ELSE
      -- A row with this reference exists under an unexpected action_type.
      -- Refuse rather than silently overwrite.
      RAISE EXCEPTION 'atomic_paid_credit_purchase: reference % is bound to unexpected action_type=%', p_reference_id, v_existing_action_type;
    END IF;
  END IF;

  -- No existing row: credit balance + insert canonical credit_purchase row
  -- in the same transaction.
  SELECT balance INTO v_old_balance FROM token_balances WHERE org_id = p_org_id;

  UPDATE token_balances
  SET balance    = balance + p_amount,
      updated_at = now()
  WHERE org_id = p_org_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    v_old_balance := 0;
    INSERT INTO token_balances (org_id, balance, minimum_required, updated_at)
    VALUES (p_org_id, p_amount, 0, now())
    ON CONFLICT (org_id) DO UPDATE
      SET balance    = token_balances.balance + p_amount,
          updated_at = now()
    RETURNING balance INTO v_new_balance;
  END IF;

  INSERT INTO token_ledger (
    org_id, endpoint, tokens_burned, outcome, remaining_balance,
    request_id, action_type, metadata
  ) VALUES (
    p_org_id,
    COALESCE(p_endpoint, 'payment:provider'),
    0,
    'allowed',
    v_new_balance,
    p_reference_id,
    'credit_purchase',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source',         'atomic_paid_credit_purchase',
      'credited',       p_amount,
      'balance_before', COALESCE(v_old_balance, 0),
      'balance_after',  v_new_balance
    )
  )
  RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'success',          true,
    'already_credited', false,
    'new_balance',      v_new_balance,
    'ledger_id',        v_ledger_id,
    'credited',         p_amount,
    'reference_id',     p_reference_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_paid_credit_purchase(uuid, integer, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_paid_credit_purchase(uuid, integer, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.atomic_paid_credit_purchase(uuid, integer, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_paid_credit_purchase(uuid, integer, text, text, jsonb) TO service_role;


-- 2) Bounded repair RPC: promote skeletal paid credit rows in place.
--    Balance untouched. Only rows whose request_id matches a real
--    token_purchases.paystack_reference are eligible.
CREATE OR REPLACE FUNCTION public.repair_skeletal_paid_credit(
  p_min_age_minutes integer DEFAULT 15,
  p_limit           integer DEFAULT 100
)
RETURNS TABLE (ledger_id uuid, reference text, action_taken text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_age_interval interval := make_interval(mins => GREATEST(COALESCE(p_min_age_minutes, 15), 0));
  v_limit        integer  := GREATEST(LEAST(COALESCE(p_limit, 100), 1000), 1);
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT l.id, l.request_id
    FROM token_ledger l
    WHERE l.action_type = 'credit'
      AND l.request_id IS NOT NULL
      AND l.created_at < now() - v_age_interval
      AND EXISTS (
        SELECT 1 FROM token_purchases tp
        WHERE tp.paystack_reference = l.request_id
      )
    ORDER BY l.created_at ASC
    LIMIT v_limit
    FOR UPDATE OF l SKIP LOCKED
  ),
  promoted AS (
    UPDATE token_ledger l
    SET action_type = 'credit_purchase',
        endpoint    = COALESCE(NULLIF(l.endpoint, ''), 'payment:paystack'),
        metadata    = COALESCE(l.metadata, '{}'::jsonb)
                      || jsonb_build_object(
                           'repaired_by',  'repair_skeletal_paid_credit',
                           'repaired_at',  now()
                         )
    FROM candidates c
    WHERE l.id = c.id
    RETURNING l.id AS ledger_id, l.request_id AS reference
  )
  SELECT promoted.ledger_id, promoted.reference, 'promoted'::text AS action_taken
  FROM promoted;
END;
$function$;

REVOKE ALL ON FUNCTION public.repair_skeletal_paid_credit(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repair_skeletal_paid_credit(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.repair_skeletal_paid_credit(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.repair_skeletal_paid_credit(integer, integer) TO service_role;
