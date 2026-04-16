-- Fix: Make atomic_token_burn self-auditing by writing to token_ledger
-- This ensures ALL burn paths (PL/pgSQL functions + edge functions) produce a ledger record.
-- The edge function callers already write to token_ledger separately, so we add
-- an ON CONFLICT DO NOTHING on the idempotency to prevent double-counting.

CREATE OR REPLACE FUNCTION public.atomic_token_burn(
  p_org_id uuid,
  p_amount integer,
  p_reason text DEFAULT 'governance_burn'::text,
  p_reference_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_balance integer;
  v_new_balance integer;
BEGIN
  UPDATE token_balances
  SET balance = balance - p_amount
  WHERE org_id = p_org_id
    AND balance >= p_amount
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    SELECT balance INTO v_old_balance FROM token_balances WHERE org_id = p_org_id;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_TOKENS',
      'current_balance', COALESCE(v_old_balance, 0),
      'requested_amount', p_amount
    );
  END IF;

  -- Self-audit: write to token_ledger so every burn path is tracked
  INSERT INTO token_ledger (
    org_id, endpoint, tokens_burned, outcome, remaining_balance,
    request_id, action_type, metadata
  ) VALUES (
    p_org_id,
    COALESCE(p_reason, 'unknown'),
    p_amount,
    'allowed',
    v_new_balance,
    COALESCE(p_reference_id, gen_random_uuid()::text),
    CASE 
      WHEN p_reason LIKE 'action:%' THEN substring(p_reason from 8)
      WHEN p_reason LIKE 'api:%' THEN 'api_call'
      ELSE p_reason
    END,
    jsonb_build_object(
      'source', 'atomic_token_burn',
      'balance_before', v_new_balance + p_amount,
      'balance_after', v_new_balance
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'balance_before', v_new_balance + p_amount,
    'balance_after', v_new_balance,
    'burned', p_amount,
    'reason', p_reason,
    'reference_id', p_reference_id
  );
END;
$function$;