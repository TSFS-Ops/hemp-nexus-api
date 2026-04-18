-- Atomic, audited setter for an organisation's data residency region.
-- Honours the "regional data residency lock" policy: once set to a non-null value,
-- it cannot be changed by app users (support must intervene via service role).
CREATE OR REPLACE FUNCTION public.set_org_data_residency(
  _region text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _org_id uuid;
  _current text;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF _region IS NULL OR length(trim(_region)) = 0 THEN
    RAISE EXCEPTION 'region_required' USING ERRCODE = '22023';
  END IF;

  -- Resolve the caller's org via profiles
  SELECT org_id INTO _org_id
  FROM public.profiles
  WHERE id = _user_id;

  IF _org_id IS NULL THEN
    RAISE EXCEPTION 'no_org_for_user' USING ERRCODE = '42501';
  END IF;

  -- Lock the row for update + read current value
  SELECT data_residency_region INTO _current
  FROM public.organizations
  WHERE id = _org_id
  FOR UPDATE;

  -- Allow setting only if currently null OR equal to the platform default.
  -- This preserves the "locked once chosen" guarantee but lets onboarding
  -- transition the row from default → user-selected once.
  IF _current IS NOT NULL AND _current <> 'za-jnb' AND _current <> _region THEN
    RAISE EXCEPTION 'residency_already_locked' USING ERRCODE = '42501';
  END IF;

  UPDATE public.organizations
  SET data_residency_region = _region,
      updated_at = now()
  WHERE id = _org_id;

  -- Audit
  INSERT INTO public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    _org_id,
    _user_id,
    'organisation.residency_set',
    'organisation',
    _org_id,
    jsonb_build_object('previous', _current, 'next', _region)
  );

  RETURN jsonb_build_object('ok', true, 'org_id', _org_id, 'region', _region);
END;
$$;

REVOKE ALL ON FUNCTION public.set_org_data_residency(text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_org_data_residency(text) TO authenticated;