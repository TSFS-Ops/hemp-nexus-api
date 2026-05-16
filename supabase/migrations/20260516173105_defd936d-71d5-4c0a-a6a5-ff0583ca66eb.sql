-- ============================================================
-- Batch O: Audit immutability + PII scrub + email log TTL
-- ============================================================

-- 1. Admin audit user_agent column for actor context consistency.
ALTER TABLE public.admin_audit_logs
  ADD COLUMN IF NOT EXISTS user_agent text;

-- 2. Immutability trigger function. Blocks UPDATE/DELETE on audit
--    tables even for service_role. A narrow escape hatch exists for
--    live-proof test fixtures: they must `SET LOCAL app.allow_audit_cleanup = 'on'`
--    inside their transaction. This GUC is local-scope only and never
--    set anywhere except by explicit test cleanup paths.
CREATE OR REPLACE FUNCTION public.assert_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bypass text;
BEGIN
  BEGIN
    v_bypass := current_setting('app.allow_audit_cleanup', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'on' THEN
    -- Audited escape hatch for test fixtures cleaning up their own seeded rows.
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'AUDIT_IMMUTABLE: % on % is not permitted',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_no_mutate_trg ON public.audit_logs;
CREATE TRIGGER audit_logs_no_mutate_trg
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.assert_audit_immutable();

DROP TRIGGER IF EXISTS admin_audit_logs_no_mutate_trg ON public.admin_audit_logs;
CREATE TRIGGER admin_audit_logs_no_mutate_trg
  BEFORE UPDATE OR DELETE ON public.admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.assert_audit_immutable();

-- 3. scrub_user_pii — anonymise outbound email log + notification payloads
--    for a given user. Preserves counts, timestamps, statuses; never deletes.
CREATE OR REPLACE FUNCTION public.scrub_user_pii(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email          text;
  v_emails_updated int := 0;
  v_notifs_updated int := 0;
  v_placeholder_email text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id_required';
  END IF;

  -- Pull all historical emails associated with this user from
  -- auth.users and profiles. Both may still hold an address at scrub time.
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  v_placeholder_email := 'scrubbed+' || p_user_id::text || '@deleted.izenzo.local';

  IF v_email IS NOT NULL THEN
    UPDATE public.email_send_log
      SET recipient_email = v_placeholder_email
      WHERE recipient_email = v_email;
    GET DIAGNOSTICS v_emails_updated = ROW_COUNT;
  END IF;

  -- Also scrub by any historical profile email (placeholder set by
  -- delete-account uses pattern deleted+<uuid>@deleted.izenzo.local
  -- which we leave untouched — already anonymised).
  UPDATE public.email_send_log esl
    SET recipient_email = v_placeholder_email
    WHERE EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = p_user_id
        AND p.email IS NOT NULL
        AND p.email = esl.recipient_email
        AND p.email NOT LIKE 'deleted+%@deleted.izenzo.local'
        AND p.email NOT LIKE 'scrubbed+%@deleted.izenzo.local'
    );

  -- Notifications: blank PII in title/body/link for this user. Preserve type,
  -- entity refs, timestamps and read/resolved state.
  UPDATE public.notifications
    SET title = '[scrubbed]',
        body  = NULL,
        link  = NULL
    WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_notifs_updated = ROW_COUNT;

  -- Audit the scrub action.
  INSERT INTO public.admin_audit_logs(
    admin_user_id, action, target_type, target_id, details
  ) VALUES (
    NULL,
    'account.pii_scrubbed',
    'profile',
    p_user_id,
    jsonb_build_object(
      'emails_anonymised', v_emails_updated,
      'notifications_scrubbed', v_notifs_updated,
      'source', 'scrub_user_pii'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'emails_anonymised', v_emails_updated,
    'notifications_scrubbed', v_notifs_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.scrub_user_pii(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scrub_user_pii(uuid) TO service_role;

-- 4. Email log TTL anonymisation. Replaces recipient_email with a static
--    placeholder for rows older than p_days. Preserves all aggregate fields.
CREATE OR REPLACE FUNCTION public.anonymise_old_email_send_log(
  p_days int DEFAULT 90,
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_candidates int;
  v_updated int := 0;
BEGIN
  IF p_days < 30 THEN
    RAISE EXCEPTION 'p_days_minimum_30_required';
  END IF;
  v_cutoff := now() - make_interval(days => p_days);

  SELECT count(*) INTO v_candidates
    FROM public.email_send_log
    WHERE created_at < v_cutoff
      AND recipient_email NOT LIKE 'scrubbed-aged@%';

  IF NOT p_dry_run THEN
    UPDATE public.email_send_log
      SET recipient_email = 'scrubbed-aged@deleted.izenzo.local'
      WHERE created_at < v_cutoff
        AND recipient_email NOT LIKE 'scrubbed-aged@%';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  INSERT INTO public.admin_audit_logs(
    admin_user_id, action, target_type, target_id, details
  ) VALUES (
    NULL,
    'email_log.ttl_anonymised',
    'email_send_log',
    NULL,
    jsonb_build_object(
      'cutoff', v_cutoff,
      'retention_days', p_days,
      'candidates', v_candidates,
      'updated', v_updated,
      'dry_run', p_dry_run,
      'source', 'anonymise_old_email_send_log'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'cutoff', v_cutoff,
    'candidates', v_candidates,
    'updated', v_updated,
    'dry_run', p_dry_run
  );
END;
$$;

REVOKE ALL ON FUNCTION public.anonymise_old_email_send_log(int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anonymise_old_email_send_log(int, boolean) TO service_role;

COMMENT ON FUNCTION public.assert_audit_immutable() IS
  'Batch O: blocks UPDATE/DELETE on audit_logs and admin_audit_logs. Even service_role hits this. Test fixtures may SET LOCAL app.allow_audit_cleanup=on within their own tx to clean their seeded rows.';

COMMENT ON FUNCTION public.scrub_user_pii(uuid) IS
  'Batch O DATA-004: anonymise email_send_log + notifications for a deleted user. Preserves counts, statuses, audit history.';

COMMENT ON FUNCTION public.anonymise_old_email_send_log(int, boolean) IS
  'Batch O TTL: anonymise email_send_log recipients older than N days (default 90). Dry-run supported. Writes admin audit run-summary.';