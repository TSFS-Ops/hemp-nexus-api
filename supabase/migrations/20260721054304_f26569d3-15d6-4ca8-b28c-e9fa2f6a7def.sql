
-- ============================================================================
-- Funder Workspace Backend Completion — Phases 2, 3, 4
-- Additive, backward-compatible. Nothing in production.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- PART A — Phase 2: Audited sealed-pack supersession
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Add supersession columns (all nullable / defaulted — safe on live rows)
ALTER TABLE public.funder_pack_versions
  ADD COLUMN IF NOT EXISTS is_current           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS superseded_by        uuid,
  ADD COLUMN IF NOT EXISTS superseded_at        timestamptz,
  ADD COLUMN IF NOT EXISTS supersession_reason  text;

-- FK for superseded_by → funder_pack_versions(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funder_pack_versions_superseded_by_fkey'
  ) THEN
    ALTER TABLE public.funder_pack_versions
      ADD CONSTRAINT funder_pack_versions_superseded_by_fkey
      FOREIGN KEY (superseded_by) REFERENCES public.funder_pack_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Backfill: mark the max-version sealed pack per release as current.
UPDATE public.funder_pack_versions p
   SET is_current = true
  FROM (
    SELECT DISTINCT ON (release_id) id
      FROM public.funder_pack_versions
     WHERE status = 'sealed'
     ORDER BY release_id, version DESC
  ) latest
 WHERE p.id = latest.id;

-- 3. Partial unique index: at most one current pack per release
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fw_pack_current
  ON public.funder_pack_versions (release_id)
  WHERE is_current;

-- 4. Immutability guard: allow only supersession-related field changes on sealed rows
CREATE OR REPLACE FUNCTION public.fw_pack_versions_seal_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF OLD.status = 'sealed' AND NEW.status NOT IN ('superseded','revoked') THEN
    IF NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
       OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
       OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
       OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
       OR NEW.pack_id IS DISTINCT FROM OLD.pack_id
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at THEN
      RAISE EXCEPTION 'fw.pack_sealed_immutable: cannot mutate sealed pack version %', OLD.id;
    END IF;
  END IF;
  -- Once superseded, the row is fully frozen except for revocation.
  IF OLD.status = 'superseded' AND NEW.status <> 'revoked' THEN
    IF NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
       OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
       OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
       OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
       OR NEW.pack_id IS DISTINCT FROM OLD.pack_id
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
       OR NEW.superseded_by IS DISTINCT FROM OLD.superseded_by
       OR NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
       OR NEW.supersession_reason IS DISTINCT FROM OLD.supersession_reason
       OR NEW.is_current IS DISTINCT FROM OLD.is_current THEN
      RAISE EXCEPTION 'fw.pack_superseded_immutable: cannot mutate superseded pack version %', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- 5. Rewrite seal RPC to support explicit supersession.
--    Backward-compatible: p_supersede + p_supersede_reason have defaults, so
--    the existing edge-function call site (5-arg positional) still works and
--    behaves identically for the first-generation case.
DROP FUNCTION IF EXISTS public.fw_admin_seal_pack_v1(uuid, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.fw_admin_seal_pack_v1(
  p_release_id        uuid,
  p_storage_bucket    text,
  p_storage_path      text,
  p_file_sha256       text,
  p_manifest_sha256   text,
  p_watermark_template text,
  p_supersede         boolean DEFAULT false,
  p_supersede_reason  text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_r         public.funder_deal_releases;
  v_current   public.funder_pack_versions;
  v_next      integer;
  v_id        uuid;
  v_now       timestamptz := now();
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'fw.forbidden: platform_admin required';
  END IF;

  IF coalesce(trim(p_storage_bucket),'') = '' OR coalesce(trim(p_storage_path),'') = '' THEN
    RAISE EXCEPTION 'fw.validation: storage bucket/path required';
  END IF;
  IF p_file_sha256 IS NULL OR length(p_file_sha256) <> 64 THEN
    RAISE EXCEPTION 'fw.validation: file_sha256 must be a 64-char hex string';
  END IF;

  -- Lock the release row for the whole seal transaction (concurrency guard)
  SELECT * INTO v_r FROM public.funder_deal_releases WHERE id = p_release_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fw.not_found: release not found'; END IF;
  IF v_r.release_status <> 'active' THEN
    RAISE EXCEPTION 'fw.state: release is % — only active releases may be sealed', v_r.release_status;
  END IF;
  IF v_r.expires_at IS NOT NULL AND v_r.expires_at <= v_now THEN
    RAISE EXCEPTION 'fw.state: release has expired';
  END IF;

  -- Consent gate (unchanged)
  IF NOT (
    v_r.buyer_consent_status  IN ('granted','not_required')
    AND v_r.seller_consent_status IN ('granted','not_required')
  ) THEN
    IF coalesce(trim(v_r.admin_override_reason),'') = '' THEN
      RAISE EXCEPTION 'fw.consent: consent missing and no admin override recorded';
    END IF;
  END IF;

  -- Look up the current sealed pack under lock
  SELECT * INTO v_current
    FROM public.funder_pack_versions
   WHERE release_id = p_release_id AND is_current
   FOR UPDATE;

  IF FOUND THEN
    -- A current pack exists → must be explicit supersession
    IF NOT p_supersede THEN
      RAISE EXCEPTION 'fw.state: sealed pack already exists (version %); call with p_supersede=true and a reason to supersede', v_current.version
        USING ERRCODE = '55000'; -- object_not_in_prerequisite_state
    END IF;
    IF coalesce(trim(p_supersede_reason),'') = '' THEN
      RAISE EXCEPTION 'fw.validation: p_supersede_reason is required when superseding';
    END IF;
  ELSE
    -- No current pack → this is a first-generation; ignore any p_supersede flag
    p_supersede := false;
  END IF;

  -- Allocate next version atomically under the release lock
  SELECT coalesce(max(version), 0) + 1
    INTO v_next
    FROM public.funder_pack_versions
   WHERE release_id = p_release_id;

  -- Insert the new sealed, current pack
  INSERT INTO public.funder_pack_versions(
    release_id, version, status,
    storage_bucket, storage_path,
    file_sha256, manifest_sha256, watermark_template,
    generated_by, generated_at, sealed_at,
    is_current
  ) VALUES (
    p_release_id, v_next, 'sealed',
    p_storage_bucket, p_storage_path,
    p_file_sha256, p_manifest_sha256, p_watermark_template,
    auth.uid(), v_now, v_now,
    true
  ) RETURNING id INTO v_id;

  -- If superseding, mark prior current as superseded, pointing at the new row
  IF p_supersede AND v_current.id IS NOT NULL THEN
    -- First unset current on the prior row so the partial unique index holds
    UPDATE public.funder_pack_versions
       SET is_current          = false,
           status              = 'superseded',
           superseded_by       = v_id,
           superseded_at       = v_now,
           supersession_reason = p_supersede_reason,
           updated_at          = v_now
     WHERE id = v_current.id;

    -- Dedicated audit event for supersession
    PERFORM public.fw_audit(
      'pack.superseded', v_r.funder_organisation_id,
      'funder_pack_version', v_current.id,
      jsonb_build_object('version', v_current.version, 'status', 'sealed', 'is_current', true),
      jsonb_build_object('version', v_current.version, 'status', 'superseded', 'is_current', false,
                         'superseded_by', v_id, 'new_version', v_next),
      p_supersede_reason
    );
  END IF;

  -- Standard seal audit for the new row
  PERFORM public.fw_audit(
    CASE WHEN p_supersede THEN 'pack.sealed_supersede' ELSE 'pack.sealed' END,
    v_r.funder_organisation_id,
    'funder_pack_version', v_id,
    NULL,
    jsonb_build_object('version', v_next, 'release_id', p_release_id, 'file_sha256', p_file_sha256),
    p_supersede_reason
  );

  PERFORM public.fw_record_usage(
    v_r.funder_organisation_id, v_r.deal_reference, p_release_id, v_id,
    'pack_sealed',
    jsonb_build_object('version', v_next, 'superseded', p_supersede)
  );

  RETURN v_id;
END; $function$;

REVOKE ALL ON FUNCTION public.fw_admin_seal_pack_v1(uuid, text, text, text, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fw_admin_seal_pack_v1(uuid, text, text, text, text, text, boolean, text) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- PART B — Phase 3: Corrected dashboard counters
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fw_counters_funder_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org uuid;
  v_active_releases          bigint;
  v_expiring_soon            bigint;
  v_releases_with_sealed_pack bigint;
  v_open_rfis                bigint;
  v_answered_rfis            bigint;
  v_decisions_current        bigint;
BEGIN
  SELECT public.p5b3_current_funder_org() INTO v_org;
  IF v_org IS NULL THEN RAISE EXCEPTION 'not_a_funder_user'; END IF;

  -- Active releases: status='active' AND unexpired
  SELECT count(*) INTO v_active_releases
    FROM public.funder_deal_releases r
   WHERE r.funder_organisation_id = v_org
     AND r.release_status = 'active'
     AND (r.expires_at IS NULL OR r.expires_at > now());

  -- Expiring within 14 days: active, unexpired, expires in window
  SELECT count(*) INTO v_expiring_soon
    FROM public.funder_deal_releases r
   WHERE r.funder_organisation_id = v_org
     AND r.release_status = 'active'
     AND r.expires_at IS NOT NULL
     AND r.expires_at >  now()
     AND r.expires_at <= now() + interval '14 days';

  -- Distinct releases whose CURRENT pack is sealed and downloadable
  SELECT count(DISTINCT r.id) INTO v_releases_with_sealed_pack
    FROM public.funder_deal_releases r
    JOIN public.funder_pack_versions p
      ON p.release_id = r.id AND p.is_current AND p.status = 'sealed'
   WHERE r.funder_organisation_id = v_org
     AND r.release_status = 'active'
     AND (r.expires_at IS NULL OR r.expires_at > now())
     AND r.can_download_compiled_pack;

  -- Open/assigned/in-progress RFIs on active, unexpired releases
  SELECT count(*) INTO v_open_rfis
    FROM public.funder_workspace_rfis f
    JOIN public.funder_deal_releases r ON r.id = f.release_id
   WHERE f.funder_organisation_id = v_org
     AND f.status IN ('open','assigned','in_progress')
     AND r.release_status = 'active'
     AND (r.expires_at IS NULL OR r.expires_at > now());

  SELECT count(*) INTO v_answered_rfis
    FROM public.funder_workspace_rfis f
    JOIN public.funder_deal_releases r ON r.id = f.release_id
   WHERE f.funder_organisation_id = v_org
     AND f.status = 'answered'
     AND r.release_status = 'active'
     AND (r.expires_at IS NULL OR r.expires_at > now());

  -- Distinct active, unexpired releases with a current decision
  SELECT count(DISTINCT d.release_id) INTO v_decisions_current
    FROM public.funder_workspace_decisions d
    JOIN public.funder_deal_releases r ON r.id = d.release_id
   WHERE d.funder_organisation_id = v_org
     AND d.is_current
     AND r.release_status = 'active'
     AND (r.expires_at IS NULL OR r.expires_at > now());

  RETURN jsonb_build_object(
    -- New canonical keys
    'active_releases',            v_active_releases,
    'expiring_within_14_days',    v_expiring_soon,
    'releases_with_sealed_pack',  v_releases_with_sealed_pack,
    'open_rfis',                  v_open_rfis,
    'answered_rfis',              v_answered_rfis,
    'releases_with_current_decision', v_decisions_current,
    -- Legacy keys (kept for backward-compat with existing UI)
    'active_deals',               v_active_releases,
    'expiring_soon',              v_expiring_soon,
    'packs_available',            v_releases_with_sealed_pack,
    'decisions_recorded',         v_decisions_current
  );
END; $function$;


-- ─────────────────────────────────────────────────────────────────────────
-- PART C — Phase 4: Funder invitation resend (narrow additive RPC)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.p5b3_admin_resend_funder_invite_v1(
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user public.p5_batch3_funder_users;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN
    RAISE EXCEPTION 'p5b3.forbidden: platform_admin required';
  END IF;

  SELECT * INTO v_user FROM public.p5_batch3_funder_users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'p5b3.not_found: funder user not found'; END IF;

  IF v_user.status <> 'invited' THEN
    RAISE EXCEPTION 'p5b3.state: user status is % — only invited users may have invites resent', v_user.status;
  END IF;

  UPDATE public.p5_batch3_funder_users
     SET invited_at = now(),
         invited_by = auth.uid(),
         updated_at = now()
   WHERE id = p_user_id;

  PERFORM public.p5b3_audit(
    'funder_user.invite_resent',
    v_user.funder_organisation_id, v_user.id, v_user.role, NULL,
    'funder_user', v_user.id,
    jsonb_build_object('invited_at', v_user.invited_at),
    jsonb_build_object('invited_at', now(), 'email', v_user.email),
    NULL, NULL
  );

  RETURN jsonb_build_object(
    'user_id', v_user.id,
    'email',   v_user.email,
    'funder_organisation_id', v_user.funder_organisation_id,
    'resent_at', now()
  );
END; $function$;

REVOKE ALL ON FUNCTION public.p5b3_admin_resend_funder_invite_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b3_admin_resend_funder_invite_v1(uuid) TO authenticated;
