
-- =====================================================================
-- DATA-009 Phase 2 — residency review workflow + onboarding hold
-- =====================================================================

-- 1. organizations: onboarding-hold pointers (residency_review only Phase 2A)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_hold_reason text,
  ADD COLUMN IF NOT EXISTS onboarding_hold_review_id uuid;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_onboarding_hold_reason_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_onboarding_hold_reason_check
  CHECK (onboarding_hold_reason IS NULL OR onboarding_hold_reason IN ('residency_review'));

-- 2. data_residency_reviews
CREATE TABLE IF NOT EXISTS public.data_residency_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requirement_source text NOT NULL,
  requested_region text,
  requested_country text,
  legal_basis text,
  status text NOT NULL DEFAULT 'review_required',
  decision_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_residency_reviews_status_check
    CHECK (status IN ('review_required','approved','declined','expired','withdrawn'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_residency_review_per_org
  ON public.data_residency_reviews(org_id)
  WHERE status = 'review_required';

CREATE INDEX IF NOT EXISTS idx_data_residency_reviews_org
  ON public.data_residency_reviews(org_id);
CREATE INDEX IF NOT EXISTS idx_data_residency_reviews_status
  ON public.data_residency_reviews(status);

-- FK after table exists
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_onboarding_hold_review_fk;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_onboarding_hold_review_fk
  FOREIGN KEY (onboarding_hold_review_id)
  REFERENCES public.data_residency_reviews(id) ON DELETE SET NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_touch_data_residency_reviews()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_touch_data_residency_reviews ON public.data_residency_reviews;
CREATE TRIGGER trg_touch_data_residency_reviews
  BEFORE UPDATE ON public.data_residency_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_data_residency_reviews();

-- 3. RLS
ALTER TABLE public.data_residency_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "residency reviews: org members select" ON public.data_residency_reviews;
CREATE POLICY "residency reviews: org members select"
  ON public.data_residency_reviews FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    OR public.is_admin(auth.uid())
  );

-- explicit no client mutations
DROP POLICY IF EXISTS "residency reviews: no client insert" ON public.data_residency_reviews;
DROP POLICY IF EXISTS "residency reviews: no client update" ON public.data_residency_reviews;
DROP POLICY IF EXISTS "residency reviews: no client delete" ON public.data_residency_reviews;

-- 4. SECDEF RPCs — service_role only

-- 4a. request_residency_review
CREATE OR REPLACE FUNCTION public.request_residency_review(
  p_org_id uuid,
  p_requirement_source text,
  p_requested_region text DEFAULT NULL,
  p_requested_country text DEFAULT NULL,
  p_legal_basis text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _review_id uuid;
  _existing uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE='22023';
  END IF;
  IF p_requirement_source IS NULL OR length(trim(p_requirement_source)) = 0 THEN
    RAISE EXCEPTION 'requirement_source_required' USING ERRCODE='22023';
  END IF;

  -- Reuse open review if present
  SELECT id INTO _existing
  FROM public.data_residency_reviews
  WHERE org_id = p_org_id AND status = 'review_required'
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    _review_id := _existing;
  ELSE
    INSERT INTO public.data_residency_reviews(
      org_id, requirement_source, requested_region, requested_country,
      legal_basis, status, metadata
    ) VALUES (
      p_org_id, p_requirement_source, p_requested_region, p_requested_country,
      p_legal_basis, 'review_required', COALESCE(p_metadata,'{}'::jsonb)
    ) RETURNING id INTO _review_id;
  END IF;

  -- Place org on onboarding hold (residency_review)
  UPDATE public.organizations
  SET onboarding_hold_reason = 'residency_review',
      onboarding_hold_review_id = _review_id,
      updated_at = now()
  WHERE id = p_org_id;

  -- Canonical audit (Phase 1 constant): data.residency_requirement_detected
  INSERT INTO public.audit_logs(org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_org_id, NULL, 'data.residency_requirement_detected',
    'data_residency_review', _review_id,
    jsonb_build_object(
      'requirement_source', p_requirement_source,
      'requested_region', p_requested_region,
      'requested_country', p_requested_country,
      'legal_basis', p_legal_basis,
      'onboarding_hold', 'residency_review',
      'policy_note', 'review only; no automatic technical hosting/storage/migration/backup/export/deletion control'
    )
  );

  RETURN jsonb_build_object('ok', true, 'review_id', _review_id, 'status', 'review_required');
END;$$;

-- 4b. approve_residency_review
CREATE OR REPLACE FUNCTION public.approve_residency_review(
  p_review_id uuid,
  p_admin_user_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _review record;
BEGIN
  IF p_admin_user_id IS NULL OR NOT public.is_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'not_platform_admin' USING ERRCODE='42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'reason_required_min_20' USING ERRCODE='22023';
  END IF;

  SELECT * INTO _review
  FROM public.data_residency_reviews
  WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_not_found' USING ERRCODE='02000';
  END IF;
  IF _review.status <> 'review_required' THEN
    RAISE EXCEPTION 'review_already_decided' USING ERRCODE='42501';
  END IF;

  UPDATE public.data_residency_reviews
  SET status = 'approved',
      decision_reason = p_reason,
      reviewed_by = p_admin_user_id,
      reviewed_at = now()
  WHERE id = p_review_id;

  -- Release onboarding hold (policy exception only; NO technical changes)
  UPDATE public.organizations
  SET onboarding_hold_reason = NULL,
      onboarding_hold_review_id = NULL,
      updated_at = now()
  WHERE id = _review.org_id
    AND onboarding_hold_review_id = p_review_id;

  INSERT INTO public.audit_logs(org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    _review.org_id, p_admin_user_id, 'data.residency_exception_approved',
    'data_residency_review', p_review_id,
    jsonb_build_object(
      'reason', p_reason,
      'requested_region', _review.requested_region,
      'requested_country', _review.requested_country,
      'policy_note', 'Approval records the policy exception only. No technical hosting, region migration, backup restriction, export restriction, or deletion behaviour is created.'
    )
  );

  RETURN jsonb_build_object('ok', true, 'review_id', p_review_id, 'status', 'approved');
END;$$;

-- 4c. decline_residency_review
CREATE OR REPLACE FUNCTION public.decline_residency_review(
  p_review_id uuid,
  p_admin_user_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _review record;
BEGIN
  IF p_admin_user_id IS NULL OR NOT public.is_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'not_platform_admin' USING ERRCODE='42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'reason_required_min_20' USING ERRCODE='22023';
  END IF;

  SELECT * INTO _review
  FROM public.data_residency_reviews
  WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_not_found' USING ERRCODE='02000';
  END IF;
  IF _review.status <> 'review_required' THEN
    RAISE EXCEPTION 'review_already_decided' USING ERRCODE='42501';
  END IF;

  UPDATE public.data_residency_reviews
  SET status = 'declined',
      decision_reason = p_reason,
      reviewed_by = p_admin_user_id,
      reviewed_at = now()
  WHERE id = p_review_id;

  -- HOLD REMAINS ACTIVE on decline.

  INSERT INTO public.audit_logs(org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    _review.org_id, p_admin_user_id, 'data.residency_exception_declined',
    'data_residency_review', p_review_id,
    jsonb_build_object(
      'reason', p_reason,
      'onboarding_hold_retained', true
    )
  );

  RETURN jsonb_build_object('ok', true, 'review_id', p_review_id, 'status', 'declined');
END;$$;

-- Lock down to service_role only (mirrors SECDEF Stage D1 pattern)
REVOKE ALL ON FUNCTION public.request_residency_review(uuid,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_residency_review(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decline_residency_review(uuid,uuid,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_residency_review(uuid,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_residency_review(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decline_residency_review(uuid,uuid,text) TO service_role;

-- 5. Rewire set_org_data_residency: non-default region no longer self-applies.
--    Default region remains directly settable for backwards-compatible onboarding.
CREATE OR REPLACE FUNCTION public.set_org_data_residency(_region text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _org_id uuid;
  _current text;
  _default text := 'za-jnb';
  _review_id uuid;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;
  IF _region IS NULL OR length(trim(_region)) = 0 THEN
    RAISE EXCEPTION 'region_required' USING ERRCODE='22023';
  END IF;

  SELECT org_id INTO _org_id FROM public.profiles WHERE id = _user_id;
  IF _org_id IS NULL THEN
    RAISE EXCEPTION 'no_org_for_user' USING ERRCODE='42501';
  END IF;

  SELECT data_residency_region INTO _current
  FROM public.organizations WHERE id = _org_id FOR UPDATE;

  -- Default approved region: keep backwards-compatible direct set.
  IF _region = _default THEN
    UPDATE public.organizations
    SET data_residency_region = _region, updated_at = now()
    WHERE id = _org_id;
    INSERT INTO public.audit_logs(org_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (_org_id, _user_id, 'organisation.residency_set', 'organisation', _org_id,
            jsonb_build_object('previous', _current, 'next', _region, 'path', 'default_approved'));
    RETURN jsonb_build_object('ok', true, 'org_id', _org_id, 'region', _region, 'path', 'default_approved');
  END IF;

  -- Non-default region: DO NOT self-apply. Open / reuse residency review.
  SELECT id INTO _review_id
  FROM public.data_residency_reviews
  WHERE org_id = _org_id AND status = 'review_required'
  LIMIT 1;

  IF _review_id IS NULL THEN
    INSERT INTO public.data_residency_reviews(
      org_id, requirement_source, requested_region, status, metadata
    ) VALUES (
      _org_id, 'set_org_data_residency_self_service', _region, 'review_required',
      jsonb_build_object('requested_by', _user_id)
    ) RETURNING id INTO _review_id;

    INSERT INTO public.audit_logs(org_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (_org_id, _user_id, 'data.residency_requirement_detected',
            'data_residency_review', _review_id,
            jsonb_build_object('requested_region', _region, 'requirement_source','set_org_data_residency_self_service'));
  END IF;

  UPDATE public.organizations
  SET onboarding_hold_reason = 'residency_review',
      onboarding_hold_review_id = _review_id,
      updated_at = now()
  WHERE id = _org_id;

  INSERT INTO public.audit_logs(org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (_org_id, _user_id, 'data.unapproved_residency_claim_blocked',
          'data_residency_review', _review_id,
          jsonb_build_object(
            'requested_region', _region,
            'current_region', _current,
            'policy_note', 'Non-default residency requires separate Izenzo approval. No region change, migration, backup, export restriction, or deletion has occurred.'
          ));

  RETURN jsonb_build_object(
    'ok', false,
    'code', 'RESIDENCY_REVIEW_REQUIRED',
    'review_id', _review_id,
    'org_id', _org_id,
    'requested_region', _region
  );
END;$$;
