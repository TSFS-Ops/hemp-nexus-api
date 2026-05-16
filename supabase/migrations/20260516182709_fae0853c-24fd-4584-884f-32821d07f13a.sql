
-- ============================================================
-- Batch Q — Discovery, Duplicate-Counterparty and Match-Quality
-- ============================================================

-- 1. Counterparty soft canonicalisation ----------------------

ALTER TABLE public.counterparties
  ADD COLUMN IF NOT EXISTS canonical_key text
    GENERATED ALWAYS AS (
      CASE
        WHEN registration_number IS NOT NULL AND length(btrim(registration_number)) > 0
          THEN 'reg:' || lower(btrim(registration_number)) || '|' || coalesce(lower(btrim(jurisdiction)), '')
        ELSE 'name:' || lower(btrim(company_name)) || '|' || coalesce(lower(btrim(jurisdiction)), '')
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS linked_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.counterparties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_reason text;

CREATE INDEX IF NOT EXISTS idx_counterparties_canonical_key
  ON public.counterparties (canonical_key);

CREATE INDEX IF NOT EXISTS idx_counterparties_linked_org
  ON public.counterparties (linked_org_id)
  WHERE linked_org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_counterparties_merged_into
  ON public.counterparties (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

COMMENT ON COLUMN public.counterparties.canonical_key IS
  'Batch Q: soft duplicate-detection key (registration+jurisdiction preferred, name+jurisdiction fallback). Non-unique — same key across rows surfaces a "Possible duplicate" advisory, never an automatic merge.';
COMMENT ON COLUMN public.counterparties.linked_org_id IS
  'Batch Q: nullable link to a registered Lovable organisation. Only set via audited admin_link_counterparty_to_org RPC. Never trust blindly without checking admin_audit_logs.';
COMMENT ON COLUMN public.counterparties.merged_into_id IS
  'Batch Q: marks this row as a duplicate that was merged into another counterparty via admin_merge_counterparties. Historical matches are NOT silently rewritten.';

-- 2. Admin RPC — link counterparty to registered org ---------

CREATE OR REPLACE FUNCTION public.admin_link_counterparty_to_org(
  p_counterparty_id uuid,
  p_org_id uuid,
  p_reason text,
  p_admin_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before public.counterparties%ROWTYPE;
  v_after  public.counterparties%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF NOT public.is_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO v_before FROM public.counterparties WHERE id = p_counterparty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'counterparty_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'org_not_found';
  END IF;

  UPDATE public.counterparties
     SET linked_org_id = p_org_id,
         verified      = true,
         updated_at    = now()
   WHERE id = p_counterparty_id
   RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    p_admin_user_id,
    'admin.counterparty_linked_to_org',
    'counterparty',
    p_counterparty_id,
    jsonb_build_object(
      'reason',     p_reason,
      'before',     jsonb_build_object('linked_org_id', v_before.linked_org_id, 'verified', v_before.verified),
      'after',      jsonb_build_object('linked_org_id', v_after.linked_org_id,  'verified', v_after.verified),
      'target_org', p_org_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'counterparty_id', p_counterparty_id, 'linked_org_id', p_org_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_link_counterparty_to_org(uuid, uuid, text, uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_counterparty_to_org(uuid, uuid, text, uuid) TO service_role;

-- 3. Admin RPC — mark counterparty as merged duplicate -------

CREATE OR REPLACE FUNCTION public.admin_merge_counterparties(
  p_primary_id uuid,
  p_duplicate_id uuid,
  p_reason text,
  p_admin_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before public.counterparties%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF NOT public.is_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF p_primary_id = p_duplicate_id THEN
    RAISE EXCEPTION 'cannot_merge_self';
  END IF;

  SELECT * INTO v_before FROM public.counterparties WHERE id = p_duplicate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'duplicate_not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.counterparties WHERE id = p_primary_id) THEN
    RAISE EXCEPTION 'primary_not_found';
  END IF;
  IF v_before.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_merged';
  END IF;

  UPDATE public.counterparties
     SET merged_into_id = p_primary_id,
         merged_at      = now(),
         merged_by      = p_admin_user_id,
         merged_reason  = p_reason,
         updated_at     = now()
   WHERE id = p_duplicate_id;

  -- Deliberately NO mutation of historical matches/counterparties references.
  INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    p_admin_user_id,
    'admin.counterparty_merged',
    'counterparty',
    p_duplicate_id,
    jsonb_build_object(
      'reason',           p_reason,
      'primary_id',       p_primary_id,
      'duplicate_id',     p_duplicate_id,
      'before',           jsonb_build_object('merged_into_id', v_before.merged_into_id),
      'historical_match_relink', false
    )
  );

  RETURN jsonb_build_object('ok', true, 'primary_id', p_primary_id, 'duplicate_id', p_duplicate_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_merge_counterparties(uuid, uuid, text, uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_merge_counterparties(uuid, uuid, text, uuid) TO service_role;

-- 4. Admin RPC — correct match jurisdiction ------------------

CREATE OR REPLACE FUNCTION public.admin_correct_match_jurisdiction(
  p_match_id uuid,
  p_origin_country text,
  p_destination_country text,
  p_reason text,
  p_admin_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before public.matches%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF NOT public.is_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO v_before FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found'; END IF;

  UPDATE public.matches
     SET origin_country      = p_origin_country,
         destination_country = p_destination_country
   WHERE id = p_match_id;

  INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    p_admin_user_id,
    'admin.match_jurisdiction_corrected',
    'match',
    p_match_id,
    jsonb_build_object(
      'reason', p_reason,
      'before', jsonb_build_object('origin_country', v_before.origin_country, 'destination_country', v_before.destination_country),
      'after',  jsonb_build_object('origin_country', p_origin_country, 'destination_country', p_destination_country)
    )
  );

  RETURN jsonb_build_object('ok', true, 'match_id', p_match_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_correct_match_jurisdiction(uuid, text, text, text, uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_match_jurisdiction(uuid, text, text, text, uuid) TO service_role;

-- 5. Admin RPC — relink match counterparty side --------------

CREATE OR REPLACE FUNCTION public.admin_relink_match_counterparty(
  p_match_id uuid,
  p_side text, -- 'buyer' | 'seller'
  p_new_org_id uuid,
  p_reason text,
  p_admin_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before public.matches%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT public.is_admin(p_admin_user_id) THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_side NOT IN ('buyer','seller') THEN RAISE EXCEPTION 'invalid_side'; END IF;

  SELECT * INTO v_before FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found'; END IF;
  IF p_new_org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_new_org_id) THEN
    RAISE EXCEPTION 'org_not_found';
  END IF;

  IF p_side = 'buyer' THEN
    UPDATE public.matches SET buyer_org_id = p_new_org_id WHERE id = p_match_id;
  ELSE
    UPDATE public.matches SET seller_org_id = p_new_org_id WHERE id = p_match_id;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    p_admin_user_id,
    'admin.match_counterparty_relinked',
    'match',
    p_match_id,
    jsonb_build_object(
      'reason', p_reason,
      'side',   p_side,
      'before', jsonb_build_object('buyer_org_id', v_before.buyer_org_id, 'seller_org_id', v_before.seller_org_id),
      'after',  jsonb_build_object(
        'buyer_org_id',  CASE WHEN p_side='buyer'  THEN p_new_org_id ELSE v_before.buyer_org_id  END,
        'seller_org_id', CASE WHEN p_side='seller' THEN p_new_org_id ELSE v_before.seller_org_id END
      )
    )
  );

  RETURN jsonb_build_object('ok', true, 'match_id', p_match_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_relink_match_counterparty(uuid, text, uuid, text, uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_relink_match_counterparty(uuid, text, uuid, text, uuid) TO service_role;

-- 6. Admin RPC — archive duplicate match ---------------------

CREATE OR REPLACE FUNCTION public.admin_archive_duplicate_match(
  p_match_id uuid,
  p_duplicate_of_match_id uuid,
  p_reason text,
  p_admin_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before public.matches%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT public.is_admin(p_admin_user_id) THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_match_id = p_duplicate_of_match_id THEN RAISE EXCEPTION 'cannot_archive_self_as_duplicate'; END IF;

  SELECT * INTO v_before FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.matches WHERE id = p_duplicate_of_match_id) THEN
    RAISE EXCEPTION 'primary_match_not_found';
  END IF;

  UPDATE public.matches
     SET state    = 'archived',
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'archived_as_duplicate_of', p_duplicate_of_match_id,
           'archived_reason',          p_reason,
           'archived_by',              p_admin_user_id,
           'archived_at',              now()
         )
   WHERE id = p_match_id;

  INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
    p_admin_user_id,
    'admin.match_archived_as_duplicate',
    'match',
    p_match_id,
    jsonb_build_object(
      'reason',                    p_reason,
      'duplicate_of_match_id',     p_duplicate_of_match_id,
      'before',                    jsonb_build_object('state', v_before.state, 'metadata', v_before.metadata)
    )
  );

  RETURN jsonb_build_object('ok', true, 'match_id', p_match_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_archive_duplicate_match(uuid, uuid, text, uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_duplicate_match(uuid, uuid, text, uuid) TO service_role;

-- 7. Detection helper + AFTER INSERT trigger -----------------

CREATE OR REPLACE FUNCTION public.detect_match_quality_warnings(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m              public.matches%ROWTYPE;
  v_buyer_juris    text[];
  v_seller_juris   text[];
  v_jur_mismatch   boolean := false;
  v_duplicate_id   uuid;
  v_warnings       jsonb   := '[]'::jsonb;
BEGIN
  SELECT * INTO v_m FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'match_not_found'); END IF;

  -- Jurisdiction check: only when both side org_id and origin/destination known.
  IF v_m.buyer_org_id IS NOT NULL AND v_m.origin_country IS NOT NULL THEN
    SELECT jurisdictions INTO v_buyer_juris FROM public.organizations WHERE id = v_m.buyer_org_id;
  END IF;
  IF v_m.seller_org_id IS NOT NULL AND v_m.destination_country IS NOT NULL THEN
    SELECT jurisdictions INTO v_seller_juris FROM public.organizations WHERE id = v_m.seller_org_id;
  END IF;

  IF v_buyer_juris IS NOT NULL
     AND array_length(v_buyer_juris, 1) IS NOT NULL
     AND v_m.destination_country IS NOT NULL
     AND NOT (lower(v_m.destination_country) = ANY (SELECT lower(x) FROM unnest(v_buyer_juris) x)) THEN
    v_jur_mismatch := true;
  END IF;
  IF v_seller_juris IS NOT NULL
     AND array_length(v_seller_juris, 1) IS NOT NULL
     AND v_m.origin_country IS NOT NULL
     AND NOT (lower(v_m.origin_country) = ANY (SELECT lower(x) FROM unnest(v_seller_juris) x)) THEN
    v_jur_mismatch := true;
  END IF;

  IF v_jur_mismatch THEN
    v_warnings := v_warnings || jsonb_build_object(
      'kind', 'jurisdiction_mismatch',
      'severity', 'medium',
      'message', 'Jurisdiction mismatch — please review'
    );
  END IF;

  -- Cross-org duplicate detection (only when both sides + commodity present).
  IF v_m.buyer_org_id IS NOT NULL AND v_m.seller_org_id IS NOT NULL THEN
    SELECT id INTO v_duplicate_id
    FROM public.matches
    WHERE id <> p_match_id
      AND buyer_org_id   = v_m.buyer_org_id
      AND seller_org_id  = v_m.seller_org_id
      AND commodity      = v_m.commodity
      AND coalesce(origin_country, '')      = coalesce(v_m.origin_country, '')
      AND coalesce(destination_country, '') = coalesce(v_m.destination_country, '')
      AND state <> 'archived'
    ORDER BY created_at ASC
    LIMIT 1;
    IF v_duplicate_id IS NOT NULL THEN
      v_warnings := v_warnings || jsonb_build_object(
        'kind', 'cross_org_duplicate_match',
        'severity', 'medium',
        'existing_match_id', v_duplicate_id,
        'message', 'A matching trade already exists across these organisations'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'warnings', v_warnings);
END;
$$;

REVOKE ALL ON FUNCTION public.detect_match_quality_warnings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_match_quality_warnings(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.match_quality_warning_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_w      jsonb;
BEGIN
  v_result := public.detect_match_quality_warnings(NEW.id);
  IF (v_result->>'ok')::boolean IS TRUE THEN
    FOR v_w IN SELECT * FROM jsonb_array_elements(v_result->'warnings') LOOP
      -- audit_logs row (non-blocking, advisory)
      INSERT INTO public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (
        NEW.org_id,
        NEW.created_by,
        CASE v_w->>'kind'
          WHEN 'jurisdiction_mismatch'      THEN 'match.jurisdiction_mismatch_detected'
          WHEN 'cross_org_duplicate_match'  THEN 'match.cross_org_duplicate_detected'
          ELSE 'match.quality_warning'
        END,
        'match',
        NEW.id,
        v_w
      );
      -- dedup'd admin risk item for triage
      INSERT INTO public.admin_risk_items (title, description, severity, status, org_id, kind, dedup_key, metadata)
      VALUES (
        CASE v_w->>'kind'
          WHEN 'jurisdiction_mismatch'     THEN 'Match jurisdiction mismatch — review'
          WHEN 'cross_org_duplicate_match' THEN 'Cross-org duplicate match — review'
          ELSE 'Match quality warning'
        END,
        v_w->>'message',
        coalesce(v_w->>'severity','medium'),
        'open',
        NEW.org_id,
        v_w->>'kind',
        'match_quality:' || (v_w->>'kind') || ':' || NEW.id::text,
        v_w || jsonb_build_object('match_id', NEW.id)
      )
      ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block match creation on advisory detection.
  RAISE NOTICE 'match_quality_warning_trg failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_quality_warning_after_insert ON public.matches;
CREATE TRIGGER match_quality_warning_after_insert
  AFTER INSERT ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.match_quality_warning_trg();
