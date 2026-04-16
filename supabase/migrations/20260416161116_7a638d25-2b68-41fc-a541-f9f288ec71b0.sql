-- Fix: Make atomic_token_credit self-auditing by writing to token_ledger
-- Credits show as negative tokens_burned (or we use a distinct convention)

CREATE OR REPLACE FUNCTION public.atomic_token_credit(
  p_org_id uuid,
  p_amount integer,
  p_reason text DEFAULT 'purchase'::text,
  p_reference_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_balance integer;
  v_old_balance integer;
BEGIN
  -- Get current balance for audit trail
  SELECT balance INTO v_old_balance FROM token_balances WHERE org_id = p_org_id;

  -- Try atomic increment first (most common path)
  UPDATE token_balances
  SET balance = balance + p_amount,
      updated_at = now()
  WHERE org_id = p_org_id
  RETURNING balance INTO v_new_balance;

  -- If org has no row yet, insert one
  IF NOT FOUND THEN
    v_old_balance := 0;
    INSERT INTO token_balances (org_id, balance, minimum_required, updated_at)
    VALUES (p_org_id, p_amount, 0, now())
    ON CONFLICT (org_id) DO UPDATE
      SET balance = token_balances.balance + p_amount,
          updated_at = now()
    RETURNING balance INTO v_new_balance;
  END IF;

  -- Self-audit: record credit in token_ledger (tokens_burned = 0, metadata records the credit)
  INSERT INTO token_ledger (
    org_id, endpoint, tokens_burned, outcome, remaining_balance,
    request_id, action_type, metadata
  ) VALUES (
    p_org_id,
    COALESCE(p_reason, 'credit'),
    0,
    'credit',
    v_new_balance,
    COALESCE(p_reference_id, gen_random_uuid()::text),
    'credit',
    jsonb_build_object(
      'source', 'atomic_token_credit',
      'credited', p_amount,
      'balance_before', COALESCE(v_old_balance, 0),
      'balance_after', v_new_balance,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'credited', p_amount,
    'reason', p_reason,
    'reference_id', p_reference_id
  );
END;
$function$;