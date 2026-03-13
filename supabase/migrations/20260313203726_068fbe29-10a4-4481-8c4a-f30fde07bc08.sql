
-- =============================================================
-- SINGLE SOURCE OF TRUTH: _provision_user
-- =============================================================
-- This is the ONE canonical function for creating a user's
-- required records (org, profile, roles). Both the auth trigger
-- and the public-facing RPC delegate to this function.
--
-- Idempotency guarantees:
--   - profiles: unique on PK (id) → ON CONFLICT DO NOTHING
--   - user_roles: unique on (user_id, role) → ON CONFLICT DO NOTHING
--   - organizations: always created fresh if profile doesn't exist,
--     but profile existence check gates the entire flow
--
-- Atomicity: PostgreSQL executes each function call within the
-- calling transaction. Trigger calls run inside the INSERT
-- transaction on auth.users. RPC calls run in their own transaction.
-- If any statement fails, the entire transaction rolls back.
-- =============================================================

CREATE OR REPLACE FUNCTION public._provision_user(
  p_user_id uuid,
  p_email text,
  p_full_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_profile_exists boolean;
  v_display_name text;
BEGIN
  -- Fast path: if profile already exists, return immediately.
  -- This makes the function safe for repeated calls.
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id
  ) INTO v_profile_exists;

  IF v_profile_exists THEN
    -- Ensure roles exist even if profile does (repairs partial state)
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, 'org_admin')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, 'org_member')
    ON CONFLICT (user_id, role) DO NOTHING;

    IF p_email LIKE '%@izenzo.co.za' THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (p_user_id, 'platform_admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
      'status', 'exists',
      'profile_id', p_user_id
    );
  END IF;

  -- Resolve display name
  v_display_name := COALESCE(NULLIF(p_full_name, ''), p_email, 'User');

  -- Step 1: Create organization
  INSERT INTO public.organizations (name, status)
  VALUES (COALESCE(p_email, 'Organization'), 'active')
  RETURNING id INTO v_org_id;

  -- Step 2: Create profile (PK conflict = impossible here due to existence check,
  -- but ON CONFLICT protects against race between two concurrent calls)
  INSERT INTO public.profiles (id, org_id, email, full_name)
  VALUES (p_user_id, v_org_id, p_email, v_display_name)
  ON CONFLICT (id) DO NOTHING;

  -- Step 3: Assign required roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, 'org_admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, 'org_member')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Step 4: Platform admin for @izenzo.co.za
  IF p_email LIKE '%@izenzo.co.za' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, 'platform_admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'status', 'created',
    'profile_id', p_user_id,
    'org_id', v_org_id
  );
END;
$function$;

-- =============================================================
-- TRIGGER: handle_new_user → delegates to _provision_user
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public._provision_user(
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );

  -- Log if provisioning created new records
  IF v_result->>'status' = 'created' THEN
    RAISE LOG '[handle_new_user] Provisioned user % with org %',
      NEW.id, v_result->>'org_id';
  END IF;

  RETURN NEW;
END;
$function$;

-- =============================================================
-- RPC: ensure_user_profile → delegates to _provision_user
-- =============================================================
CREATE OR REPLACE FUNCTION public.ensure_user_profile(p_user_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public._provision_user(p_user_id, p_email, NULL);

  -- Log repair events for observability
  IF v_result->>'status' = 'created' THEN
    RAISE WARNING '[ensure_user_profile] Repaired missing profile for user %. This indicates the auth trigger may have failed during registration.',
      p_user_id;
  END IF;

  RETURN v_result;
END;
$function$;

-- =============================================================
-- ACCESS CONTROL: _provision_user is internal only
-- =============================================================
REVOKE EXECUTE ON FUNCTION public._provision_user(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._provision_user(uuid, text, text) FROM authenticated;

-- ensure_user_profile remains callable by authenticated (via RPC)
-- handle_new_user remains callable only as a trigger
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
