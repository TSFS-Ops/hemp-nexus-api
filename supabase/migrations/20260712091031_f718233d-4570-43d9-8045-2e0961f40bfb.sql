
-- =====================================================================
-- Institutional Funder Evidence Workspace — Batch 5
-- RFI, notes/comments, and formal decision workflow (release-scoped V1).
-- Additive-only; does not alter Batch 1–4 tables, RPCs, or enums.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Extend the funder_usage_events event_type CHECK to include the
--    new Batch 5 event types. Additive to existing values.
-- ---------------------------------------------------------------------
ALTER TABLE public.funder_usage_events
  DROP CONSTRAINT IF EXISTS funder_usage_events_event_type_check;

ALTER TABLE public.funder_usage_events
  ADD CONSTRAINT funder_usage_events_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'organisation_requested','organisation_approved','organisation_rejected',
      'deal_released','deal_access_revoked',
      'pack_generated','pack_downloaded',
      'raw_document_viewed','raw_document_downloaded',
      'rfi_created','rfi_assigned','rfi_answered','rfi_closed','rfi_withdrawn','rfi_message',
      'note_created','note_edited','note_deleted',
      'decision_recorded',
      'user_invited','user_deactivated'
    ])
  );

-- ---------------------------------------------------------------------
-- 1) Helper: current caller's V1 role for a given release, or NULL when
--    the caller is not a funder user of that release's funder org.
--    Returns one of 'admin','approver','reviewer','viewer','external_adviser'
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fw_v1_role_for_release(p_release_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL OR p_release_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT r.funder_organisation_id INTO v_org
    FROM public.funder_deal_releases r
    WHERE r.id = p_release_id;
  IF v_org IS NULL THEN RETURN NULL; END IF;

  SELECT public.funder_role_for_v1(u.role) INTO v_role
    FROM public.p5_batch3_funder_users u
    WHERE u.auth_user_id = v_uid
      AND u.funder_organisation_id = v_org
      AND u.status = 'active'
    LIMIT 1;

  RETURN v_role;
END;
$$;
REVOKE ALL ON FUNCTION public.fw_v1_role_for_release(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_v1_role_for_release(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) funder_workspace_rfis
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funder_workspace_rfis (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id              uuid NOT NULL REFERENCES public.funder_deal_releases(id) ON DELETE CASCADE,
  funder_organisation_id  uuid NOT NULL REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE CASCADE,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title                   text NOT NULL,
  request_type            text NOT NULL DEFAULT 'general',
  description             text NOT NULL,
  related_evidence_item   text,
  priority                text NOT NULL DEFAULT 'normal'
                           CHECK (priority IN ('low','normal','high','urgent')),
  due_date                timestamptz,
  status                  text NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','assigned','in_progress','answered','closed','withdrawn')),
  closed_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at               timestamptz,
  withdrawn_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  withdrawn_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funder_workspace_rfis_title_nonempty       CHECK (length(btrim(title)) > 0),
  CONSTRAINT funder_workspace_rfis_description_nonempty CHECK (length(btrim(description)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_fw_rfi_release  ON public.funder_workspace_rfis(release_id);
CREATE INDEX IF NOT EXISTS idx_fw_rfi_org      ON public.funder_workspace_rfis(funder_organisation_id);
CREATE INDEX IF NOT EXISTS idx_fw_rfi_status   ON public.funder_workspace_rfis(status);
CREATE INDEX IF NOT EXISTS idx_fw_rfi_created  ON public.funder_workspace_rfis(created_at DESC);

-- Read-only from clients; mutations only via SECURITY DEFINER RPCs.
GRANT SELECT ON public.funder_workspace_rfis TO authenticated;
GRANT ALL    ON public.funder_workspace_rfis TO service_role;

ALTER TABLE public.funder_workspace_rfis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fw_rfi_admin_select"
  ON public.funder_workspace_rfis
  FOR SELECT TO authenticated
  USING (public.p5b3_is_platform_admin());

CREATE POLICY "fw_rfi_funder_select"
  ON public.funder_workspace_rfis
  FOR SELECT TO authenticated
  USING (funder_organisation_id = public.fw_current_funder_org_v1());

-- ---------------------------------------------------------------------
-- 3) funder_workspace_rfi_messages
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funder_workspace_rfi_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfi_id               uuid NOT NULL REFERENCES public.funder_workspace_rfis(id) ON DELETE CASCADE,
  author_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_side          text NOT NULL CHECK (author_side IN ('funder','izenzo_admin','system')),
  message_body         text NOT NULL,
  attachments_metadata jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funder_workspace_rfi_messages_body_nonempty CHECK (length(btrim(message_body)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_fw_rfi_msg_rfi ON public.funder_workspace_rfi_messages(rfi_id, created_at);

GRANT SELECT ON public.funder_workspace_rfi_messages TO authenticated;
GRANT ALL    ON public.funder_workspace_rfi_messages TO service_role;

ALTER TABLE public.funder_workspace_rfi_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fw_rfi_msg_admin_select"
  ON public.funder_workspace_rfi_messages
  FOR SELECT TO authenticated
  USING (public.p5b3_is_platform_admin());

CREATE POLICY "fw_rfi_msg_funder_select"
  ON public.funder_workspace_rfi_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.funder_workspace_rfis r
    WHERE r.id = funder_workspace_rfi_messages.rfi_id
      AND r.funder_organisation_id = public.fw_current_funder_org_v1()
  ));

-- ---------------------------------------------------------------------
-- 4) funder_workspace_notes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funder_workspace_notes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id             uuid NOT NULL REFERENCES public.funder_deal_releases(id) ON DELETE CASCADE,
  funder_organisation_id uuid NOT NULL REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE CASCADE,
  author_user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note_type              text NOT NULL CHECK (note_type IN ('internal_note','shared_comment')),
  body                   text NOT NULL,
  visibility             text NOT NULL CHECK (visibility IN ('funder_internal','izenzo_shared')),
  editable_until         timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  superseded_by          uuid REFERENCES public.funder_workspace_notes(id) ON DELETE SET NULL,
  supersedes_note_id     uuid REFERENCES public.funder_workspace_notes(id) ON DELETE SET NULL,
  deleted_at             timestamptz,
  deleted_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funder_workspace_notes_body_nonempty CHECK (length(btrim(body)) > 0),
  CONSTRAINT funder_workspace_notes_type_visibility CHECK (
    (note_type = 'internal_note'  AND visibility = 'funder_internal') OR
    (note_type = 'shared_comment' AND visibility = 'izenzo_shared')
  )
);
CREATE INDEX IF NOT EXISTS idx_fw_note_release ON public.funder_workspace_notes(release_id);
CREATE INDEX IF NOT EXISTS idx_fw_note_org     ON public.funder_workspace_notes(funder_organisation_id);
CREATE INDEX IF NOT EXISTS idx_fw_note_created ON public.funder_workspace_notes(created_at DESC);

GRANT SELECT ON public.funder_workspace_notes TO authenticated;
GRANT ALL    ON public.funder_workspace_notes TO service_role;

ALTER TABLE public.funder_workspace_notes ENABLE ROW LEVEL SECURITY;

-- Admin can see shared comments (izenzo_shared); admin also sees all rows
-- for audit review. Funder org sees all of its own notes (both types).
CREATE POLICY "fw_note_admin_select"
  ON public.funder_workspace_notes
  FOR SELECT TO authenticated
  USING (public.p5b3_is_platform_admin());

CREATE POLICY "fw_note_funder_select"
  ON public.funder_workspace_notes
  FOR SELECT TO authenticated
  USING (funder_organisation_id = public.fw_current_funder_org_v1());

-- ---------------------------------------------------------------------
-- 5) funder_workspace_decisions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funder_workspace_decisions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id             uuid NOT NULL REFERENCES public.funder_deal_releases(id) ON DELETE CASCADE,
  funder_organisation_id uuid NOT NULL REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE CASCADE,
  decided_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_status        text NOT NULL CHECK (decision_status IN (
                           'not_started','under_review','info_requested',
                           'conditional','approved','declined','withdrawn'
                         )),
  reason                 text,
  conditions             text,
  decision_version       integer NOT NULL DEFAULT 1 CHECK (decision_version >= 1),
  is_current             boolean NOT NULL DEFAULT true,
  supersedes_decision_id uuid REFERENCES public.funder_workspace_decisions(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funder_workspace_decisions_final_needs_reason CHECK (
    decision_status NOT IN ('conditional','approved','declined','withdrawn')
    OR (reason IS NOT NULL AND length(btrim(reason)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_fw_decision_release ON public.funder_workspace_decisions(release_id);
CREATE INDEX IF NOT EXISTS idx_fw_decision_org     ON public.funder_workspace_decisions(funder_organisation_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fw_decision_current
  ON public.funder_workspace_decisions(release_id) WHERE is_current;

GRANT SELECT ON public.funder_workspace_decisions TO authenticated;
GRANT ALL    ON public.funder_workspace_decisions TO service_role;

ALTER TABLE public.funder_workspace_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fw_decision_admin_select"
  ON public.funder_workspace_decisions
  FOR SELECT TO authenticated
  USING (public.p5b3_is_platform_admin());

CREATE POLICY "fw_decision_funder_select"
  ON public.funder_workspace_decisions
  FOR SELECT TO authenticated
  USING (funder_organisation_id = public.fw_current_funder_org_v1());

-- ---------------------------------------------------------------------
-- 6) Shared timestamp trigger
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fw_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS fw_rfi_touch      ON public.funder_workspace_rfis;
DROP TRIGGER IF EXISTS fw_rfi_msg_touch  ON public.funder_workspace_rfi_messages;
DROP TRIGGER IF EXISTS fw_note_touch     ON public.funder_workspace_notes;
DROP TRIGGER IF EXISTS fw_decision_touch ON public.funder_workspace_decisions;

CREATE TRIGGER fw_rfi_touch      BEFORE UPDATE ON public.funder_workspace_rfis      FOR EACH ROW EXECUTE FUNCTION public.fw_touch_updated_at();
CREATE TRIGGER fw_rfi_msg_touch  BEFORE UPDATE ON public.funder_workspace_rfi_messages FOR EACH ROW EXECUTE FUNCTION public.fw_touch_updated_at();
CREATE TRIGGER fw_note_touch     BEFORE UPDATE ON public.funder_workspace_notes     FOR EACH ROW EXECUTE FUNCTION public.fw_touch_updated_at();
CREATE TRIGGER fw_decision_touch BEFORE UPDATE ON public.funder_workspace_decisions FOR EACH ROW EXECUTE FUNCTION public.fw_touch_updated_at();

-- ---------------------------------------------------------------------
-- 7) RPCs — RFIs
-- ---------------------------------------------------------------------

-- fw_funder_create_rfi_v1
CREATE OR REPLACE FUNCTION public.fw_funder_create_rfi_v1(
  p_release_id            uuid,
  p_title                 text,
  p_description           text,
  p_request_type          text,
  p_related_evidence_item text,
  p_priority              text,
  p_due_date              timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_org  uuid;
  v_status text;
  v_expires timestamptz;
  v_rfi_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_release_id IS NULL THEN RAISE EXCEPTION 'release_required'; END IF;
  IF p_title IS NULL OR length(btrim(p_title)) = 0 THEN RAISE EXCEPTION 'title_required'; END IF;
  IF p_description IS NULL OR length(btrim(p_description)) = 0 THEN RAISE EXCEPTION 'description_required'; END IF;

  SELECT r.funder_organisation_id, r.release_status, r.expires_at
    INTO v_org, v_status, v_expires
    FROM public.funder_deal_releases r
    WHERE r.id = p_release_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'release_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'release_not_active'; END IF;
  IF v_expires IS NOT NULL AND v_expires <= now() THEN RAISE EXCEPTION 'release_expired'; END IF;

  v_role := public.fw_v1_role_for_release(p_release_id);
  IF v_role IS NULL THEN RAISE EXCEPTION 'not_a_funder_user_for_release'; END IF;
  IF v_role NOT IN ('admin','approver','reviewer') THEN RAISE EXCEPTION 'insufficient_role'; END IF;

  INSERT INTO public.funder_workspace_rfis(
    release_id, funder_organisation_id, created_by,
    title, description, request_type, related_evidence_item, priority, due_date
  ) VALUES (
    p_release_id, v_org, v_uid,
    btrim(p_title), btrim(p_description),
    COALESCE(NULLIF(btrim(p_request_type), ''), 'general'),
    NULLIF(btrim(p_related_evidence_item), ''),
    COALESCE(NULLIF(p_priority, ''), 'normal'),
    p_due_date
  ) RETURNING id INTO v_rfi_id;

  PERFORM public.fw_audit('fw_rfi_created', v_org, 'funder_workspace_rfi', v_rfi_id,
    NULL, jsonb_build_object('release_id', p_release_id, 'title', btrim(p_title)), NULL);
  PERFORM public.fw_record_usage(v_org, NULL, p_release_id, NULL, 'rfi_created',
    jsonb_build_object('rfi_id', v_rfi_id, 'priority', COALESCE(p_priority,'normal')));

  RETURN v_rfi_id;
END; $$;

REVOKE ALL ON FUNCTION public.fw_funder_create_rfi_v1(uuid, text, text, text, text, text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_create_rfi_v1(uuid, text, text, text, text, text, timestamptz) TO authenticated;

-- fw_admin_assign_rfi_v1
CREATE OR REPLACE FUNCTION public.fw_admin_assign_rfi_v1(p_rfi_id uuid, p_assignee uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid; v_release uuid; v_prev jsonb; v_status text;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_rfi_id IS NULL THEN RAISE EXCEPTION 'rfi_required'; END IF;

  SELECT funder_organisation_id, release_id, status,
         jsonb_build_object('assigned_to', assigned_to, 'status', status)
    INTO v_org, v_release, v_status, v_prev
    FROM public.funder_workspace_rfis WHERE id = p_rfi_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'rfi_not_found'; END IF;
  IF v_status IN ('closed','withdrawn') THEN RAISE EXCEPTION 'rfi_terminal'; END IF;

  UPDATE public.funder_workspace_rfis
     SET assigned_to = p_assignee,
         status = CASE WHEN status = 'open' THEN 'assigned' ELSE status END
   WHERE id = p_rfi_id;

  PERFORM public.fw_audit('fw_rfi_assigned', v_org, 'funder_workspace_rfi', p_rfi_id,
    v_prev, jsonb_build_object('assigned_to', p_assignee), NULL);
  PERFORM public.fw_record_usage(v_org, NULL, v_release, NULL, 'rfi_assigned',
    jsonb_build_object('rfi_id', p_rfi_id, 'assignee', p_assignee));
END; $$;

REVOKE ALL ON FUNCTION public.fw_admin_assign_rfi_v1(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_admin_assign_rfi_v1(uuid, uuid) TO authenticated;

-- fw_admin_answer_rfi_v1
CREATE OR REPLACE FUNCTION public.fw_admin_answer_rfi_v1(p_rfi_id uuid, p_message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_org uuid; v_release uuid; v_status text; v_msg uuid;
BEGIN
  IF NOT public.p5b3_is_platform_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_message IS NULL OR length(btrim(p_message)) = 0 THEN RAISE EXCEPTION 'message_required'; END IF;

  SELECT funder_organisation_id, release_id, status INTO v_org, v_release, v_status
    FROM public.funder_workspace_rfis WHERE id = p_rfi_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'rfi_not_found'; END IF;
  IF v_status IN ('closed','withdrawn') THEN RAISE EXCEPTION 'rfi_terminal'; END IF;

  INSERT INTO public.funder_workspace_rfi_messages(rfi_id, author_user_id, author_side, message_body)
    VALUES (p_rfi_id, v_uid, 'izenzo_admin', btrim(p_message))
    RETURNING id INTO v_msg;

  UPDATE public.funder_workspace_rfis SET status = 'answered' WHERE id = p_rfi_id;

  PERFORM public.fw_audit('fw_rfi_answered', v_org, 'funder_workspace_rfi', p_rfi_id,
    NULL, jsonb_build_object('message_id', v_msg), NULL);
  PERFORM public.fw_record_usage(v_org, NULL, v_release, NULL, 'rfi_answered',
    jsonb_build_object('rfi_id', p_rfi_id, 'message_id', v_msg));

  RETURN v_msg;
END; $$;

REVOKE ALL ON FUNCTION public.fw_admin_answer_rfi_v1(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_admin_answer_rfi_v1(uuid, text) TO authenticated;

-- fw_funder_add_rfi_message_v1 (funder-side reply/comment on the thread)
CREATE OR REPLACE FUNCTION public.fw_funder_add_rfi_message_v1(p_rfi_id uuid, p_message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_org uuid; v_release uuid; v_status text; v_role text; v_msg uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_message IS NULL OR length(btrim(p_message)) = 0 THEN RAISE EXCEPTION 'message_required'; END IF;

  SELECT funder_organisation_id, release_id, status INTO v_org, v_release, v_status
    FROM public.funder_workspace_rfis WHERE id = p_rfi_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'rfi_not_found'; END IF;

  v_role := public.fw_v1_role_for_release(v_release);
  IF v_role IS NULL THEN RAISE EXCEPTION 'not_a_funder_user_for_release'; END IF;
  IF v_role NOT IN ('admin','approver','reviewer') THEN RAISE EXCEPTION 'insufficient_role'; END IF;
  IF v_status IN ('closed','withdrawn') THEN RAISE EXCEPTION 'rfi_terminal'; END IF;

  INSERT INTO public.funder_workspace_rfi_messages(rfi_id, author_user_id, author_side, message_body)
    VALUES (p_rfi_id, v_uid, 'funder', btrim(p_message))
    RETURNING id INTO v_msg;

  UPDATE public.funder_workspace_rfis
     SET status = CASE WHEN status = 'answered' THEN 'in_progress' ELSE status END
   WHERE id = p_rfi_id;

  PERFORM public.fw_audit('fw_rfi_message', v_org, 'funder_workspace_rfi', p_rfi_id,
    NULL, jsonb_build_object('message_id', v_msg, 'author_side', 'funder'), NULL);
  PERFORM public.fw_record_usage(v_org, NULL, v_release, NULL, 'rfi_message',
    jsonb_build_object('rfi_id', p_rfi_id, 'message_id', v_msg));

  RETURN v_msg;
END; $$;
REVOKE ALL ON FUNCTION public.fw_funder_add_rfi_message_v1(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_add_rfi_message_v1(uuid, text) TO authenticated;

-- fw_funder_close_rfi_v1
CREATE OR REPLACE FUNCTION public.fw_funder_close_rfi_v1(p_rfi_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_org uuid; v_release uuid; v_status text; v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT funder_organisation_id, release_id, status INTO v_org, v_release, v_status
    FROM public.funder_workspace_rfis WHERE id = p_rfi_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'rfi_not_found'; END IF;

  v_role := public.fw_v1_role_for_release(v_release);
  IF v_role IS NULL THEN RAISE EXCEPTION 'not_a_funder_user_for_release'; END IF;
  IF v_role NOT IN ('admin','approver','reviewer') THEN RAISE EXCEPTION 'insufficient_role'; END IF;
  IF v_status IN ('closed','withdrawn') THEN RAISE EXCEPTION 'rfi_terminal'; END IF;

  UPDATE public.funder_workspace_rfis
     SET status = 'closed', closed_by = v_uid, closed_at = now()
   WHERE id = p_rfi_id;

  PERFORM public.fw_audit('fw_rfi_closed', v_org, 'funder_workspace_rfi', p_rfi_id,
    jsonb_build_object('status', v_status), jsonb_build_object('status', 'closed'), p_reason);
  PERFORM public.fw_record_usage(v_org, NULL, v_release, NULL, 'rfi_closed',
    jsonb_build_object('rfi_id', p_rfi_id));
END; $$;
REVOKE ALL ON FUNCTION public.fw_funder_close_rfi_v1(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_close_rfi_v1(uuid, text) TO authenticated;

-- fw_funder_withdraw_rfi_v1
CREATE OR REPLACE FUNCTION public.fw_funder_withdraw_rfi_v1(p_rfi_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_org uuid; v_release uuid; v_status text; v_role text; v_creator uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT funder_organisation_id, release_id, status, created_by
    INTO v_org, v_release, v_status, v_creator
    FROM public.funder_workspace_rfis WHERE id = p_rfi_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'rfi_not_found'; END IF;

  v_role := public.fw_v1_role_for_release(v_release);
  IF v_role IS NULL THEN RAISE EXCEPTION 'not_a_funder_user_for_release'; END IF;
  IF v_role NOT IN ('admin','approver','reviewer') THEN RAISE EXCEPTION 'insufficient_role'; END IF;
  IF v_status IN ('closed','withdrawn') THEN RAISE EXCEPTION 'rfi_terminal'; END IF;
  IF v_role <> 'admin' AND v_creator IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'only_creator_or_funder_admin_can_withdraw';
  END IF;

  UPDATE public.funder_workspace_rfis
     SET status = 'withdrawn', withdrawn_by = v_uid, withdrawn_at = now()
   WHERE id = p_rfi_id;

  PERFORM public.fw_audit('fw_rfi_withdrawn', v_org, 'funder_workspace_rfi', p_rfi_id,
    jsonb_build_object('status', v_status), jsonb_build_object('status', 'withdrawn'), p_reason);
  PERFORM public.fw_record_usage(v_org, NULL, v_release, NULL, 'rfi_withdrawn',
    jsonb_build_object('rfi_id', p_rfi_id));
END; $$;
REVOKE ALL ON FUNCTION public.fw_funder_withdraw_rfi_v1(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_withdraw_rfi_v1(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 8) RPCs — Notes
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fw_funder_create_note_v1(
  p_release_id uuid,
  p_note_type  text,
  p_body       text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_org uuid; v_status text; v_expires timestamptz;
  v_visibility text; v_note_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_body IS NULL OR length(btrim(p_body)) = 0 THEN RAISE EXCEPTION 'body_required'; END IF;
  IF p_note_type NOT IN ('internal_note','shared_comment') THEN RAISE EXCEPTION 'invalid_note_type'; END IF;

  SELECT funder_organisation_id, release_status, expires_at
    INTO v_org, v_status, v_expires
    FROM public.funder_deal_releases WHERE id = p_release_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'release_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'release_not_active'; END IF;
  IF v_expires IS NOT NULL AND v_expires <= now() THEN RAISE EXCEPTION 'release_expired'; END IF;

  v_role := public.fw_v1_role_for_release(p_release_id);
  IF v_role IS NULL THEN RAISE EXCEPTION 'not_a_funder_user_for_release'; END IF;
  IF v_role NOT IN ('admin','approver','reviewer') THEN RAISE EXCEPTION 'insufficient_role'; END IF;

  v_visibility := CASE p_note_type WHEN 'internal_note' THEN 'funder_internal' ELSE 'izenzo_shared' END;

  INSERT INTO public.funder_workspace_notes(
    release_id, funder_organisation_id, author_user_id,
    note_type, body, visibility
  ) VALUES (
    p_release_id, v_org, v_uid, p_note_type, btrim(p_body), v_visibility
  ) RETURNING id INTO v_note_id;

  PERFORM public.fw_audit('fw_note_created', v_org, 'funder_workspace_note', v_note_id,
    NULL, jsonb_build_object('release_id', p_release_id, 'note_type', p_note_type), NULL);
  PERFORM public.fw_record_usage(v_org, NULL, p_release_id, NULL, 'note_created',
    jsonb_build_object('note_id', v_note_id, 'note_type', p_note_type));

  RETURN v_note_id;
END; $$;
REVOKE ALL ON FUNCTION public.fw_funder_create_note_v1(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_create_note_v1(uuid, text, text) TO authenticated;

-- fw_funder_edit_note_v1 — inside edit window mutates; outside creates
-- a superseding note version and returns the new note id.
CREATE OR REPLACE FUNCTION public.fw_funder_edit_note_v1(p_note_id uuid, p_new_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid; v_release uuid; v_author uuid; v_editable_until timestamptz;
  v_note_type text; v_visibility text; v_deleted timestamptz; v_superseded uuid;
  v_new_id uuid; v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_new_body IS NULL OR length(btrim(p_new_body)) = 0 THEN RAISE EXCEPTION 'body_required'; END IF;

  SELECT funder_organisation_id, release_id, author_user_id, editable_until,
         note_type, visibility, deleted_at, superseded_by
    INTO v_org, v_release, v_author, v_editable_until,
         v_note_type, v_visibility, v_deleted, v_superseded
    FROM public.funder_workspace_notes WHERE id = p_note_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'note_not_found'; END IF;
  IF v_deleted IS NOT NULL THEN RAISE EXCEPTION 'note_deleted'; END IF;
  IF v_superseded IS NOT NULL THEN RAISE EXCEPTION 'note_superseded'; END IF;
  IF v_author IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'only_author_can_edit'; END IF;

  v_role := public.fw_v1_role_for_release(v_release);
  IF v_role IS NULL OR v_role NOT IN ('admin','approver','reviewer') THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  IF v_editable_until >= now() THEN
    UPDATE public.funder_workspace_notes
       SET body = btrim(p_new_body)
     WHERE id = p_note_id;
    PERFORM public.fw_audit('fw_note_edited', v_org, 'funder_workspace_note', p_note_id,
      NULL, jsonb_build_object('mode','in_place'), NULL);
    PERFORM public.fw_record_usage(v_org, NULL, v_release, NULL, 'note_edited',
      jsonb_build_object('note_id', p_note_id, 'mode', 'in_place'));
    RETURN p_note_id;
  END IF;

  -- Outside edit window: create a superseding version, mark the old
  -- note as superseded_by the new note. Both remain visible.
  INSERT INTO public.funder_workspace_notes(
    release_id, funder_organisation_id, author_user_id,
    note_type, body, visibility, supersedes_note_id
  ) VALUES (
    v_release, v_org, v_uid, v_note_type, btrim(p_new_body), v_visibility, p_note_id
  ) RETURNING id INTO v_new_id;

  UPDATE public.funder_workspace_notes
     SET superseded_by = v_new_id
   WHERE id = p_note_id;

  PERFORM public.fw_audit('fw_note_edited', v_org, 'funder_workspace_note', p_note_id,
    NULL, jsonb_build_object('mode','superseding','new_note_id', v_new_id), NULL);
  PERFORM public.fw_record_usage(v_org, NULL, v_release, NULL, 'note_edited',
    jsonb_build_object('note_id', p_note_id, 'new_note_id', v_new_id, 'mode', 'superseding'));

  RETURN v_new_id;
END; $$;
REVOKE ALL ON FUNCTION public.fw_funder_edit_note_v1(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_edit_note_v1(uuid, text) TO authenticated;

-- fw_funder_delete_note_v1 — soft delete
CREATE OR REPLACE FUNCTION public.fw_funder_delete_note_v1(p_note_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_org uuid; v_release uuid; v_author uuid; v_deleted timestamptz; v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT funder_organisation_id, release_id, author_user_id, deleted_at
    INTO v_org, v_release, v_author, v_deleted
    FROM public.funder_workspace_notes WHERE id = p_note_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'note_not_found'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN; END IF;

  v_role := public.fw_v1_role_for_release(v_release);
  IF v_role IS NULL THEN RAISE EXCEPTION 'not_a_funder_user_for_release'; END IF;
  IF v_role NOT IN ('admin','approver','reviewer') THEN RAISE EXCEPTION 'insufficient_role'; END IF;
  -- Author OR funder org admin may delete
  IF v_author IS DISTINCT FROM v_uid AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'only_author_or_funder_admin_can_delete';
  END IF;

  UPDATE public.funder_workspace_notes
     SET deleted_at = now(), deleted_by = v_uid
   WHERE id = p_note_id;

  PERFORM public.fw_audit('fw_note_deleted', v_org, 'funder_workspace_note', p_note_id,
    NULL, jsonb_build_object('soft_delete', true), p_reason);
  PERFORM public.fw_record_usage(v_org, NULL, v_release, NULL, 'note_deleted',
    jsonb_build_object('note_id', p_note_id));
END; $$;
REVOKE ALL ON FUNCTION public.fw_funder_delete_note_v1(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_delete_note_v1(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 9) RPC — Decisions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fw_funder_record_decision_v1(
  p_release_id      uuid,
  p_decision_status text,
  p_reason          text,
  p_conditions      text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_role text; v_org uuid; v_status text; v_expires timestamptz;
  v_prev_id uuid; v_prev_version int; v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_decision_status NOT IN ('not_started','under_review','info_requested','conditional','approved','declined','withdrawn') THEN
    RAISE EXCEPTION 'invalid_decision_status';
  END IF;
  IF p_decision_status IN ('conditional','approved','declined','withdrawn')
     AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'reason_required_for_final_decision';
  END IF;

  SELECT funder_organisation_id, release_status, expires_at
    INTO v_org, v_status, v_expires
    FROM public.funder_deal_releases WHERE id = p_release_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'release_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'release_not_active'; END IF;
  IF v_expires IS NOT NULL AND v_expires <= now() THEN RAISE EXCEPTION 'release_expired'; END IF;

  v_role := public.fw_v1_role_for_release(p_release_id);
  IF v_role IS NULL THEN RAISE EXCEPTION 'not_a_funder_user_for_release'; END IF;
  IF v_role <> 'approver' THEN RAISE EXCEPTION 'only_approver_can_record_decision'; END IF;

  -- Snapshot prior current decision.
  SELECT id, decision_version INTO v_prev_id, v_prev_version
    FROM public.funder_workspace_decisions
   WHERE release_id = p_release_id AND is_current
   FOR UPDATE;

  IF v_prev_id IS NOT NULL THEN
    UPDATE public.funder_workspace_decisions
       SET is_current = false
     WHERE id = v_prev_id;
  END IF;

  INSERT INTO public.funder_workspace_decisions(
    release_id, funder_organisation_id, decided_by,
    decision_status, reason, conditions,
    decision_version, is_current, supersedes_decision_id
  ) VALUES (
    p_release_id, v_org, v_uid,
    p_decision_status,
    NULLIF(btrim(COALESCE(p_reason,'')), ''),
    NULLIF(btrim(COALESCE(p_conditions,'')), ''),
    COALESCE(v_prev_version, 0) + 1, true, v_prev_id
  ) RETURNING id INTO v_new_id;

  PERFORM public.fw_audit('fw_decision_recorded', v_org, 'funder_workspace_decision', v_new_id,
    CASE WHEN v_prev_id IS NULL THEN NULL
         ELSE jsonb_build_object('supersedes', v_prev_id, 'prior_version', v_prev_version) END,
    jsonb_build_object('release_id', p_release_id, 'status', p_decision_status), p_reason);
  PERFORM public.fw_record_usage(v_org, NULL, p_release_id, NULL, 'decision_recorded',
    jsonb_build_object('decision_id', v_new_id, 'status', p_decision_status,
                       'version', COALESCE(v_prev_version, 0) + 1));

  RETURN v_new_id;
END; $$;
REVOKE ALL ON FUNCTION public.fw_funder_record_decision_v1(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_record_decision_v1(uuid, text, text, text) TO authenticated;
