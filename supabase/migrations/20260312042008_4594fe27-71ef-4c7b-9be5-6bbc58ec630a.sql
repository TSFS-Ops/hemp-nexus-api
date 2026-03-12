
-- 1. Create atomic_token_credit function: UPDATE balance = balance + amount (no read-then-write)
-- Returns the new balance after credit. Handles upsert for orgs that somehow don't have a row.
CREATE OR REPLACE FUNCTION public.atomic_token_credit(
  p_org_id uuid,
  p_amount integer,
  p_reason text DEFAULT 'credit_purchase',
  p_reference_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  -- Try atomic increment first (most common path)
  UPDATE token_balances
  SET balance = balance + p_amount,
      updated_at = now()
  WHERE org_id = p_org_id
  RETURNING balance INTO v_new_balance;

  -- If org has no row yet, insert one
  IF NOT FOUND THEN
    INSERT INTO token_balances (org_id, balance, minimum_required, updated_at)
    VALUES (p_org_id, p_amount, 0, now())
    ON CONFLICT (org_id) DO UPDATE
      SET balance = token_balances.balance + p_amount,
          updated_at = now()
    RETURNING balance INTO v_new_balance;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'credited', p_amount,
    'reason', p_reason,
    'reference_id', p_reference_id
  );
END;
$$;

-- 2. Add a unique index on token_ledger.request_id (non-null only)
-- This is the hard idempotency gate: if webhook and verify race past the SELECT check,
-- the second INSERT will fail with a unique constraint violation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_token_ledger_request_id_unique
  ON public.token_ledger (request_id)
  WHERE request_id IS NOT NULL;
