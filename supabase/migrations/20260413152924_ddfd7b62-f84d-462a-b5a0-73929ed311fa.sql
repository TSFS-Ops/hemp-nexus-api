CREATE OR REPLACE FUNCTION public.atomic_token_burn(p_org_id uuid, p_amount integer, p_reason text DEFAULT 'governance_burn'::text, p_reference_id text DEFAULT NULL::text)
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