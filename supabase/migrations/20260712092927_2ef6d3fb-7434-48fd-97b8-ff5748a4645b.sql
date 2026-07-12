
-- =====================================================================
-- Institutional Funder Evidence Workspace — Batch 6
-- Notification wiring + counter RPCs + admin assignment picker helper.
-- Strictly additive. No enum renames. No signature changes to prior
-- Batch 3/4/5 RPCs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Recipients helper: authenticated funder-user IDs for an org,
--    optionally filtered by V1 role list. Returns auth_user_ids.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fw_notification_recipients_v1(
  p_funder_org uuid,
  p_roles text[] DEFAULT NULL
) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.auth_user_id
    FROM public.p5_batch3_funder_users u
   WHERE u.funder_organisation_id = p_funder_org
     AND u.status = 'active'
     AND u.auth_user_id IS NOT NULL
     AND (
       p_roles IS NULL
       OR public.funder_role_for_v1(u.role) = ANY (p_roles)
     );
$$;
REVOKE ALL ON FUNCTION public.fw_notification_recipients_v1(uuid, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_notification_recipients_v1(uuid, text[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) fw_notify_event_v1: fan out in-app notifications to funder-org
--    users (optionally role-scoped) plus platform admins. Records
--    one row per recipient into public.notifications. Idempotent by
--    (entity_type, entity_id, user_id, type).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fw_notify_event_v1(
  p_event_type       text,
  p_funder_org       uuid,
  p_release_id       uuid,
  p_entity_type      text,
  p_entity_id        uuid,
  p_title            text,
  p_body             text,
  p_link             text,
  p_roles            text[] DEFAULT NULL,
  p_notify_admins    boolean DEFAULT false,
  p_security_critical boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
  v_count int := 0;
BEGIN
  IF p_funder_org IS NULL OR p_event_type IS NULL THEN
    RETURN 0;
  END IF;

  -- Funder-org recipients (release/deal-scoped). Security-critical
  -- events ignore role filters (always include all active users).
  FOR v_uid IN
    SELECT public.fw_notification_recipients_v1(
      p_funder_org,
      CASE WHEN p_security_critical THEN NULL ELSE p_roles END
    )
  LOOP
    BEGIN
      INSERT INTO public.notifications(
        user_id, org_id, type, title, body, entity_type, entity_id, link, read
      ) VALUES (
        v_uid, p_funder_org, p_event_type,
        left(p_title, 200), p_body, p_entity_type, p_entity_id, p_link, false
      );
      v_count := v_count + 1;
    EXCEPTION WHEN unique_violation THEN
      -- idempotent no-op
      NULL;
    END;
  END LOOP;

  -- Optionally notify platform admins (Izenzo side).
  IF p_notify_admins THEN
    FOR v_uid IN
      SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'platform_admin'
    LOOP
      BEGIN
        INSERT INTO public.notifications(
          user_id, org_id, type, title, body, entity_type, entity_id, link, read
        ) VALUES (
          v_uid, p_funder_org, p_event_type,
          left(p_title, 200), p_body, p_entity_type, p_entity_id, p_link, false
        );
        v_count := v_count + 1;
      EXCEPTION WHEN unique_violation THEN NULL; END;
    END LOOP;
  END IF;

  RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.fw_notify_event_v1(text,uuid,uuid,text,uuid,text,text,text,text[],boolean,boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_notify_event_v1(text,uuid,uuid,text,uuid,text,text,text,text[],boolean,boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) Triggers: emit notifications from server-side data changes.
--    All triggers are AFTER and never raise (wrapped exception handling).
-- ---------------------------------------------------------------------

-- 3a) Funder organisation approval/rejection.
CREATE OR REPLACE FUNCTION public.fw_trg_org_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND NEW.approval_status IS DISTINCT FROM OLD.approval_status) THEN
    IF NEW.approval_status = 'approved' THEN
      PERFORM public.fw_notify_event_v1(
        'funder_workspace.org_approved', NEW.id, NULL,
        'funder_organisation', NEW.id,
        'Funder organisation approved',
        'Your organisation has been approved to access the Institutional Funder Evidence Workspace.',
        '/funder/workspace',
        NULL, true, true
      );
    ELSIF NEW.approval_status = 'rejected' THEN
      PERFORM public.fw_notify_event_v1(
        'funder_workspace.org_rejected', NEW.id, NULL,
        'funder_organisation', NEW.id,
        'Funder organisation onboarding rejected',
        'Your organisation onboarding request was not approved. Please contact Izenzo for details.',
        '/funder/workspace',
        NULL, true, true
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fw_trg_org_notify ON public.p5_batch3_funder_organisations;
CREATE TRIGGER fw_trg_org_notify AFTER UPDATE ON public.p5_batch3_funder_organisations
  FOR EACH ROW EXECUTE FUNCTION public.fw_trg_org_notify();

-- 3b) Deal release: notify on insert (active) and on transition to revoked.
CREATE OR REPLACE FUNCTION public.fw_trg_release_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.release_status = 'active') THEN
    PERFORM public.fw_notify_event_v1(
      'funder_workspace.deal_released', NEW.funder_organisation_id, NEW.id,
      'funder_deal_release', NEW.id,
      'Deal released to your organisation',
      'Evidence release ' || COALESCE(NEW.deal_reference, '') || ' is now available.',
      '/funder/workspace/deals/' || NEW.id::text,
      ARRAY['admin','approver','reviewer'], false, true
    );
  ELSIF (TG_OP = 'UPDATE' AND OLD.release_status IS DISTINCT FROM NEW.release_status
         AND NEW.release_status = 'revoked') THEN
    PERFORM public.fw_notify_event_v1(
      'funder_workspace.release_revoked', NEW.funder_organisation_id, NEW.id,
      'funder_deal_release', NEW.id,
      'Deal access revoked',
      'Access to release ' || COALESCE(NEW.deal_reference, '') || ' has been revoked.',
      '/funder/workspace/deals/' || NEW.id::text,
      NULL, true, true
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fw_trg_release_notify ON public.funder_deal_releases;
CREATE TRIGGER fw_trg_release_notify AFTER INSERT OR UPDATE ON public.funder_deal_releases
  FOR EACH ROW EXECUTE FUNCTION public.fw_trg_release_notify();

-- 3c) Sealed pack generated.
CREATE OR REPLACE FUNCTION public.fw_trg_pack_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_ref text;
BEGIN
  SELECT funder_organisation_id, deal_reference INTO v_org, v_ref
    FROM public.funder_deal_releases WHERE id = NEW.release_id;
  IF v_org IS NULL THEN RETURN NEW; END IF;
  PERFORM public.fw_notify_event_v1(
    'funder_workspace.pack_generated', v_org, NEW.release_id,
    'funder_pack_version', NEW.id,
    'Sealed evidence pack generated',
    'A sealed pack (v' || COALESCE(NEW.pack_version::text, '?') || ') is available for release ' || COALESCE(v_ref, '') || '.',
    '/funder/workspace/deals/' || NEW.release_id::text,
    ARRAY['admin','approver','reviewer'], true, false
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fw_trg_pack_notify ON public.funder_pack_versions;
CREATE TRIGGER fw_trg_pack_notify AFTER INSERT ON public.funder_pack_versions
  FOR EACH ROW EXECUTE FUNCTION public.fw_trg_pack_notify();

-- 3d) RFI lifecycle (create/assign/close/withdraw).
CREATE OR REPLACE FUNCTION public.fw_trg_rfi_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fw_notify_event_v1(
      'funder_workspace.rfi_created', NEW.funder_organisation_id, NEW.release_id,
      'funder_workspace_rfi', NEW.id,
      'RFI raised: ' || left(COALESCE(NEW.title,''), 120),
      NEW.description,
      '/funder/workspace/deals/' || NEW.release_id::text,
      ARRAY['admin','approver','reviewer'], true, false
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to AND NEW.assigned_to IS NOT NULL THEN
      BEGIN
        INSERT INTO public.notifications(user_id, org_id, type, title, body, entity_type, entity_id, link, read)
        VALUES (NEW.assigned_to, NEW.funder_organisation_id, 'funder_workspace.rfi_assigned',
                'RFI assigned to you: ' || left(COALESCE(NEW.title,''), 120),
                NEW.description, 'funder_workspace_rfi', NEW.id,
                '/admin/funder-workspace/releases/' || NEW.release_id::text, false);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('closed','withdrawn') THEN
      PERFORM public.fw_notify_event_v1(
        'funder_workspace.rfi_' || NEW.status, NEW.funder_organisation_id, NEW.release_id,
        'funder_workspace_rfi', NEW.id,
        'RFI ' || NEW.status || ': ' || left(COALESCE(NEW.title,''), 120),
        NEW.description,
        '/funder/workspace/deals/' || NEW.release_id::text,
        ARRAY['admin','approver','reviewer'], true, false
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fw_trg_rfi_notify ON public.funder_workspace_rfis;
CREATE TRIGGER fw_trg_rfi_notify AFTER INSERT OR UPDATE ON public.funder_workspace_rfis
  FOR EACH ROW EXECUTE FUNCTION public.fw_trg_rfi_notify();

-- 3e) RFI answered (message on an RFI). Notify creator + funder org.
CREATE OR REPLACE FUNCTION public.fw_trg_rfi_message_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rfi record;
BEGIN
  SELECT id, funder_organisation_id, release_id, title, created_by
    INTO v_rfi FROM public.funder_workspace_rfis WHERE id = NEW.rfi_id;
  IF v_rfi.id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.fw_notify_event_v1(
    'funder_workspace.rfi_answered', v_rfi.funder_organisation_id, v_rfi.release_id,
    'funder_workspace_rfi', v_rfi.id,
    'New message on RFI: ' || left(COALESCE(v_rfi.title,''), 120),
    left(NEW.message_body, 400),
    '/funder/workspace/deals/' || v_rfi.release_id::text,
    ARRAY['admin','approver','reviewer'], true, false
  );
  -- Ensure creator is always notified even if they lost their role filter.
  IF v_rfi.created_by IS NOT NULL AND v_rfi.created_by <> COALESCE(NEW.author_user_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    BEGIN
      INSERT INTO public.notifications(user_id, org_id, type, title, body, entity_type, entity_id, link, read)
      VALUES (v_rfi.created_by, v_rfi.funder_organisation_id, 'funder_workspace.rfi_answered',
              'New message on your RFI', left(NEW.message_body, 400),
              'funder_workspace_rfi', v_rfi.id,
              '/funder/workspace/deals/' || v_rfi.release_id::text, false);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fw_trg_rfi_message_notify ON public.funder_workspace_rfi_messages;
CREATE TRIGGER fw_trg_rfi_message_notify AFTER INSERT ON public.funder_workspace_rfi_messages
  FOR EACH ROW EXECUTE FUNCTION public.fw_trg_rfi_message_notify();

-- 3f) Shared comment created (visibility izenzo_shared only).
CREATE OR REPLACE FUNCTION public.fw_trg_note_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.visibility = 'izenzo_shared' AND NEW.deleted_at IS NULL THEN
    PERFORM public.fw_notify_event_v1(
      'funder_workspace.shared_comment_created', NEW.funder_organisation_id, NEW.release_id,
      'funder_workspace_note', NEW.id,
      'New shared comment',
      left(NEW.body, 400),
      '/funder/workspace/deals/' || NEW.release_id::text,
      ARRAY['admin','approver','reviewer'], true, false
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fw_trg_note_notify ON public.funder_workspace_notes;
CREATE TRIGGER fw_trg_note_notify AFTER INSERT ON public.funder_workspace_notes
  FOR EACH ROW EXECUTE FUNCTION public.fw_trg_note_notify();

-- 3g) Decision recorded.
CREATE OR REPLACE FUNCTION public.fw_trg_decision_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fw_notify_event_v1(
    'funder_workspace.decision_recorded', NEW.funder_organisation_id, NEW.release_id,
    'funder_workspace_decision', NEW.id,
    'Funder decision recorded: ' || NEW.decision_status,
    COALESCE(NEW.reason, ''),
    '/funder/workspace/deals/' || NEW.release_id::text,
    ARRAY['admin','approver','reviewer'], true, false
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fw_trg_decision_notify ON public.funder_workspace_decisions;
CREATE TRIGGER fw_trg_decision_notify AFTER INSERT ON public.funder_workspace_decisions
  FOR EACH ROW EXECUTE FUNCTION public.fw_trg_decision_notify();

-- ---------------------------------------------------------------------
-- 4) Counter RPCs.
-- ---------------------------------------------------------------------

-- Admin summary counters (platform_admin only).
CREATE OR REPLACE FUNCTION public.fw_counters_admin_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'platform_admin_required';
  END IF;
  SELECT jsonb_build_object(
    'pending_onboarding', (SELECT count(*) FROM public.funder_org_onboarding_requests WHERE status IN ('submitted','under_review')),
    'approved_orgs',      (SELECT count(*) FROM public.p5_batch3_funder_organisations WHERE status = 'active'),
    'active_releases',    (SELECT count(*) FROM public.funder_deal_releases WHERE release_status = 'active'),
    'expiring_soon',      (SELECT count(*) FROM public.funder_deal_releases WHERE release_status='active' AND expires_at IS NOT NULL AND expires_at > now() AND expires_at < now() + interval '14 days'),
    'revoked_releases',   (SELECT count(*) FROM public.funder_deal_releases WHERE release_status = 'revoked'),
    'packs_generated',    (SELECT count(*) FROM public.funder_pack_versions),
    'pack_downloads',     (SELECT count(*) FROM public.funder_usage_events WHERE event_type = 'pack_downloaded'),
    'open_rfis',          (SELECT count(*) FROM public.funder_workspace_rfis WHERE status IN ('open','assigned','in_progress')),
    'decisions_recorded', (SELECT count(*) FROM public.funder_workspace_decisions WHERE is_current)
  ) INTO v_out;
  RETURN v_out;
END; $$;
REVOKE ALL ON FUNCTION public.fw_counters_admin_v1() FROM public;
GRANT EXECUTE ON FUNCTION public.fw_counters_admin_v1() TO authenticated, service_role;

-- Funder org counters (scoped to caller's org via RLS-style filter).
CREATE OR REPLACE FUNCTION public.fw_counters_funder_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_out jsonb;
BEGIN
  SELECT public.p5b3_current_funder_org() INTO v_org;
  IF v_org IS NULL THEN RAISE EXCEPTION 'not_a_funder_user'; END IF;
  SELECT jsonb_build_object(
    'active_deals',       (SELECT count(*) FROM public.funder_deal_releases WHERE funder_organisation_id=v_org AND release_status='active'),
    'expiring_soon',      (SELECT count(*) FROM public.funder_deal_releases WHERE funder_organisation_id=v_org AND release_status='active' AND expires_at IS NOT NULL AND expires_at > now() AND expires_at < now() + interval '14 days'),
    'packs_available',    (SELECT count(*) FROM public.funder_pack_versions p JOIN public.funder_deal_releases r ON r.id=p.release_id WHERE r.funder_organisation_id=v_org),
    'open_rfis',          (SELECT count(*) FROM public.funder_workspace_rfis WHERE funder_organisation_id=v_org AND status IN ('open','assigned','in_progress')),
    'answered_rfis',      (SELECT count(*) FROM public.funder_workspace_rfis WHERE funder_organisation_id=v_org AND status='answered'),
    'decisions_recorded', (SELECT count(*) FROM public.funder_workspace_decisions WHERE funder_organisation_id=v_org AND is_current)
  ) INTO v_out;
  RETURN v_out;
END; $$;
REVOKE ALL ON FUNCTION public.fw_counters_funder_v1() FROM public;
GRANT EXECUTE ON FUNCTION public.fw_counters_funder_v1() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5) Admin assignment picker: safe list of platform admins for RFI
--    assignment. Returns only id + display_name + email; platform_admin
--    only. No broader user enumeration.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fw_admin_assignable_users_v1()
RETURNS TABLE(user_id uuid, display_name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'platform_admin_required';
  END IF;
  RETURN QUERY
    SELECT ur.user_id,
           COALESCE(p.full_name, p.display_name, u.email) AS display_name,
           u.email::text
      FROM public.user_roles ur
      JOIN auth.users u ON u.id = ur.user_id
      LEFT JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'platform_admin'
     ORDER BY display_name NULLS LAST;
END; $$;
REVOKE ALL ON FUNCTION public.fw_admin_assignable_users_v1() FROM public;
GRANT EXECUTE ON FUNCTION public.fw_admin_assignable_users_v1() TO authenticated, service_role;
