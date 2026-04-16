CREATE OR REPLACE FUNCTION public.atomic_validate_governance_doc(p_governance_doc_id uuid, p_org_id uuid, p_burn_amount integer, p_actor_user_id uuid DEFAULT NULL::uuid, p_doc_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc RECORD;
  v_burn_result jsonb;
BEGIN
  SELECT id, org_id, status, token_burned
  INTO v_doc
  FROM governance_documents
  WHERE id = p_governance_doc_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message', 'Governance document not found');
  END IF;

  IF v_doc.status = 'VALIDATED' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'message', 'Document already validated');
  END IF;

  IF p_burn_amount > 0 AND NOT v_doc.token_burned THEN
    v_burn_result := public.atomic_token_burn(
      v_doc.org_id,
      p_burn_amount,
      'action:governance_burn',
      p_governance_doc_id::text
    );

    IF NOT (v_burn_result ->> 'success')::boolean THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INSUFFICIENT_TOKENS',
        'message', format('Token burn requires %s tokens. Balance: %s', p_burn_amount, v_burn_result ->> 'current_balance')
      );
    END IF;

    INSERT INTO audit_logs (
      org_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      v_doc.org_id, p_actor_user_id, 'token.governance_burn', 'governance_document',
      p_governance_doc_id::text,
      jsonb_build_object(
        'burn_amount', p_burn_amount,
        'balance_before', v_burn_result ->> 'balance_before',
        'balance_after', v_burn_result ->> 'balance_after',
        'doc_type', p_doc_type,
        'idempotency_key', 'gov-burn-' || p_governance_doc_id::text
      )
    );
  END IF;

  UPDATE governance_documents
  SET status = 'VALIDATED',
      validated_at = now(),
      token_burned = (p_burn_amount > 0)
  WHERE id = p_governance_doc_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'token_burned', p_burn_amount > 0,
    'burn_amount', p_burn_amount,
    'balance_after', CASE WHEN v_burn_result IS NOT NULL THEN (v_burn_result ->> 'balance_after')::int ELSE NULL END
  );
END;
$function$;