CREATE OR REPLACE FUNCTION public.assign_match_named_contact(
  p_match_id uuid,
  p_side text,
  p_contact_name text,
  p_contact_email text,
  p_assigned_by_user_id uuid,
  p_assigned_by_role text,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer_org uuid;
  v_seller_org uuid;
  v_side_org uuid;
  v_prior_id uuid;
  v_new_id uuid;
  v_lock_key bigint;
BEGIN
  -- 1. Argument validation (defence in depth — edge fn also validates).
  IF p_side NOT IN ('buyer','seller') THEN
    RAISE EXCEPTION 'invalid_side' USING ERRCODE = '22023';
  END IF;
  IF p_assigned_by_role NOT IN ('org_admin_self_service','platform_admin_override') THEN
    RAISE EXCEPTION 'invalid_assigned_by_role' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(trim(p_contact_name), '')) < 2
     OR length(p_contact_name) > 120 THEN
    RAISE EXCEPTION 'invalid_contact_name' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(trim(p_contact_email), '')) < 5
     OR length(p_contact_email) > 254
     OR p_contact_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_contact_email' USING ERRCODE = '22023';
  END IF;

  -- 2. Load match orgs.
  SELECT buyer_org_id, seller_org_id
    INTO v_buyer_org, v_seller_org
  FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_side_org := CASE WHEN p_side = 'buyer' THEN v_buyer_org ELSE v_seller_org END;
  IF v_side_org IS NULL THEN
    RAISE EXCEPTION 'side_has_no_org' USING ERRCODE = '22023';
  END IF;

  -- 3. Advisory lock per (match, side) to serialise assigns.
  v_lock_key := ('x' || substr(md5(p_match_id::text || ':' || p_side), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 4. Find current active (if any) and mark it replaced shortly.
  SELECT id INTO v_prior_id
  FROM public.match_named_contacts
  WHERE match_id = p_match_id
    AND side = p_side
    AND status = 'active'
  FOR UPDATE;

  -- 5. Insert the new active row.
  INSERT INTO public.match_named_contacts (
    match_id, side, org_id, contact_name, contact_email,
    assigned_by_user_id, assigned_by_role, status, metadata
  ) VALUES (
    p_match_id, p_side, v_side_org,
    trim(p_contact_name), lower(trim(p_contact_email)),
    p_assigned_by_user_id, p_assigned_by_role, 'active',
    CASE WHEN p_notes IS NULL OR length(trim(p_notes)) = 0
         THEN '{}'::jsonb
         ELSE jsonb_build_object('notes', trim(p_notes)) END
  ) RETURNING id INTO v_new_id;

  -- 6. If a prior active existed, mark it replaced and link.
  IF v_prior_id IS NOT NULL THEN
    UPDATE public.match_named_contacts
    SET status = 'replaced',
        replaced_by_id = v_new_id
    WHERE id = v_prior_id;
  END IF;

  -- 7. Audit rows.
  INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    p_assigned_by_user_id,
    'match_named_contact.created',
    'match',
    p_match_id,
    jsonb_build_object(
      'contact_id', v_new_id,
      'side', p_side,
      'assigned_by_role', p_assigned_by_role,
      'has_replaced_prior', v_prior_id IS NOT NULL,
      'org_id', v_side_org
    )
  );

  IF v_prior_id IS NOT NULL THEN
    INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
    VALUES (
      p_assigned_by_user_id,
      'match_named_contact.replaced',
      'match',
      p_match_id,
      jsonb_build_object(
        'prior_contact_id', v_prior_id,
        'new_contact_id', v_new_id,
        'side', p_side,
        'assigned_by_role', p_assigned_by_role
      )
    );
  END IF;

  IF p_assigned_by_role = 'platform_admin_override' THEN
    INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
    VALUES (
      p_assigned_by_user_id,
      'admin.named_contact_override',
      'match',
      p_match_id,
      jsonb_build_object(
        'contact_id', v_new_id,
        'side', p_side,
        'has_replaced_prior', v_prior_id IS NOT NULL
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'contact_id', v_new_id,
    'replaced_prior_id', v_prior_id,
    'side', p_side
  );
END;
$$;

-- SECDEF Stage D1 Lockdown: service_role only.
REVOKE ALL ON FUNCTION public.assign_match_named_contact(uuid,text,text,text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_match_named_contact(uuid,text,text,text,uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.assign_match_named_contact(uuid,text,text,text,uuid,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assign_match_named_contact(uuid,text,text,text,uuid,text,text) TO service_role;

COMMENT ON FUNCTION public.assign_match_named_contact IS
  'MT-009 Phase 2: assign or replace a controlled named contact on one side of a match. Called only by edge function match-named-contacts-assign after caller auth + org-admin/platform-admin AAL2 checks. Single transaction with advisory lock; writes admin audit rows; never sends email/invite/notification.';
