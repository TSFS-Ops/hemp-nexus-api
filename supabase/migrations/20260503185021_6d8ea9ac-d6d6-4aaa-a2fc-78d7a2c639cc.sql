-- D-03 Role inversion auto-fill: server-side audit RPC for explicit user
-- confirmation of the trade side. SECURITY DEFINER + locked to caller.
CREATE OR REPLACE FUNCTION public.record_role_confirmation(
  p_original_selected_side text,
  p_inferred_side text,
  p_confirmed_side text,
  p_match_id uuid DEFAULT NULL,
  p_draft_id text DEFAULT NULL,
  p_source_component text DEFAULT 'CounterpartySearch'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_audit_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_confirmed_side NOT IN ('buyer','seller') THEN
    RAISE EXCEPTION 'INVALID_CONFIRMED_SIDE';
  END IF;

  IF p_inferred_side IS NOT NULL AND p_inferred_side NOT IN ('buyer','seller') THEN
    RAISE EXCEPTION 'INVALID_INFERRED_SIDE';
  END IF;

  IF p_original_selected_side IS NOT NULL AND p_original_selected_side NOT IN ('buyer','seller') THEN
    RAISE EXCEPTION 'INVALID_ORIGINAL_SIDE';
  END IF;

  SELECT org_id INTO v_org_id FROM public.profiles WHERE id = v_user_id;

  INSERT INTO public.audit_logs (action, actor_user_id, org_id, entity_type, entity_id, metadata)
  VALUES (
    'match.counterparty_side.user_confirmed',
    v_user_id,
    v_org_id,
    CASE WHEN p_match_id IS NOT NULL THEN 'match' ELSE 'draft' END,
    p_match_id,
    jsonb_build_object(
      'original_selected_side', p_original_selected_side,
      'inferred_side', p_inferred_side,
      'confirmed_side', p_confirmed_side,
      'match_id', p_match_id,
      'draft_id', p_draft_id,
      'user_id', v_user_id,
      'org_id', v_org_id,
      'source_component', p_source_component,
      'timestamp', now()
    )
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_role_confirmation(text,text,text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_role_confirmation(text,text,text,uuid,text,text) TO authenticated;