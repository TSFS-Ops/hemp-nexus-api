-- Advisory lock for lifecycle-scheduler to prevent concurrent runs
CREATE OR REPLACE FUNCTION public.try_lifecycle_lock()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Lock ID 8675309 is arbitrary but stable for this scheduler
  RETURN pg_try_advisory_lock(8675309);
END;
$$;

-- Release the advisory lock
CREATE OR REPLACE FUNCTION public.release_lifecycle_lock()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM pg_advisory_unlock(8675309);
END;
$$;

-- Atomic token refund with audit trail for failed transitions
CREATE OR REPLACE FUNCTION public.refund_tokens_on_conflict(
  p_org_id uuid,
  p_amount integer,
  p_match_id uuid,
  p_reason text,
  p_request_id text,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_credit_result jsonb;
BEGIN
  -- Credit the tokens back
  v_credit_result := public.atomic_token_credit(
    p_org_id,
    p_amount,
    'refund_' || p_reason,
    p_request_id
  );

  -- Write audit trail for reconciliation
  INSERT INTO public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    p_org_id,
    p_actor_user_id,
    'token.refund',
    'match',
    p_match_id::text,
    jsonb_build_object(
      'request_id', p_request_id,
      'reason', p_reason,
      'amount', p_amount,
      'credit_result', v_credit_result
    )
  );

  RETURN v_credit_result;
END;
$$;

-- Restrict execution to authenticated users only
REVOKE EXECUTE ON FUNCTION public.try_lifecycle_lock() FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_lifecycle_lock() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refund_tokens_on_conflict(uuid, integer, uuid, text, text, uuid) FROM anon;