-- MT-009 Phase 2 Test 4 fix: reorder assign_match_named_contact so the prior
-- active row is marked `replaced` BEFORE the new active row is inserted.
-- The partial unique index idx_mnc_one_active_per_side (match_id, side)
-- WHERE status='active' was rejecting the new insert because the prior row
-- was still active at the moment of insert. Tests 1-3 didn't hit this
-- because they had no prior active row.
--
-- Scope: behaviour preserving. Same arguments, same return shape, same
-- audit action names (`match_named_contact.created`,
-- `match_named_contact.replaced`, `admin.named_contact_override`).
-- No POI/WaD/payment/credit/token/notification/email side effects.

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
  -- 1. Argument validation.
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

  -- 4. Find current active (if any) and lock it.
  SELECT id INTO v_prior_id
  FROM public.match_named_contacts
  WHERE match_id = p_match_id
    AND side = p_side
    AND status = 'active'
  FOR UPDATE;

  -- 5. If a prior active exists, mark it replaced FIRST so the partial
  --    unique index (match_id, side) WHERE status='active' permits the
  --    new insert. We'll back-fill replaced_by_id after we have v_new_id.
  IF v_prior_id IS NOT NULL THEN
    UPDATE public.match_named_contacts
    SET status = 'replaced'
    WHERE id = v_prior_id;
  END IF;

  -- 6. Insert the new active row.
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

  -- 7. Back-fill replaced_by_id on the prior row.
  IF v_prior_id IS NOT NULL THEN
    UPDATE public.match_named_contacts
    SET replaced_by_id = v_new_id
    WHERE id = v_prior_id;
  END IF;

  -- 8. Audit rows (names unchanged).
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

-- Preserve SECDEF Stage D1 Lockdown (service_role only).
REVOKE ALL ON FUNCTION public.assign_match_named_contact(uuid,text,text,text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_match_named_contact(uuid,text,text,text,uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.assign_match_named_contact(uuid,text,text,text,uuid,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assign_match_named_contact(uuid,text,text,text,uuid,text,text) TO service_role;