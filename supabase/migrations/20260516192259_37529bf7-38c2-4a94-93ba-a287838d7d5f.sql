
-- Batch R: programme participant workflow hardening

-- 1. New columns
ALTER TABLE public.programme_participants
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_completeness_state TEXT NOT NULL DEFAULT 'pending_contact',
  ADD COLUMN IF NOT EXISTS manual_follow_up_reason TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- Backfill contact state from any data already present.
UPDATE public.programme_participants
   SET contact_completeness_state = CASE
     WHEN (email IS NOT NULL AND length(trim(email)) > 0)
       OR (phone IS NOT NULL AND length(trim(phone)) > 0) THEN 'complete'
     ELSE 'pending_contact'
   END;

-- Backfill any unknown statuses to a safe terminal value.
UPDATE public.programme_participants
   SET status = 'archived',
       archived_at = COALESCE(archived_at, now()),
       archive_reason = COALESCE(archive_reason, 'Backfilled by Batch R migration — original status not in canonical set.')
 WHERE status NOT IN ('pending','approved','rejected','suspended','withdrawn','archived');

-- 2. Drop the previous role validator (kept) and add status validator.
CREATE OR REPLACE FUNCTION public.validate_programme_participant_status()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
DECLARE
  valid_statuses TEXT[] := ARRAY['pending','approved','rejected','suspended','withdrawn','archived'];
  valid_contact  TEXT[] := ARRAY['pending_contact','complete'];
BEGIN
  IF NEW.status IS NULL OR NOT (NEW.status = ANY (valid_statuses)) THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT_STATUS: %. Must be one of pending/approved/rejected/suspended/withdrawn/archived.', NEW.status
      USING ERRCODE = '22023';
  END IF;
  IF NEW.contact_completeness_state IS NULL
     OR NOT (NEW.contact_completeness_state = ANY (valid_contact)) THEN
    RAISE EXCEPTION 'INVALID_CONTACT_STATE: %. Must be pending_contact or complete.', NEW.contact_completeness_state
      USING ERRCODE = '22023';
  END IF;

  -- Auto-derive contact_completeness_state from email/phone presence.
  IF (NEW.email IS NOT NULL AND length(trim(NEW.email)) > 0)
     OR (NEW.phone IS NOT NULL AND length(trim(NEW.phone)) > 0) THEN
    NEW.contact_completeness_state := 'complete';
  END IF;

  -- Block promotion to approved while contact incomplete, unless an
  -- explicit manual_follow_up_reason (>=10 chars) was recorded.
  IF NEW.status = 'approved'
     AND NEW.contact_completeness_state = 'pending_contact'
     AND (NEW.manual_follow_up_reason IS NULL OR length(trim(NEW.manual_follow_up_reason)) < 10) THEN
    RAISE EXCEPTION 'CONTACT_REQUIRED_FOR_APPROVAL: participant has no contact details and no manual follow-up reason >=10 chars'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_validate_programme_participant_status
  ON public.programme_participants;
CREATE TRIGGER trg_validate_programme_participant_status
  BEFORE INSERT OR UPDATE ON public.programme_participants
  FOR EACH ROW EXECUTE FUNCTION public.validate_programme_participant_status();

-- 3. Status transition matrix (UPDATE only).
CREATE OR REPLACE FUNCTION public.validate_programme_participant_transition()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
DECLARE
  is_admin_caller BOOLEAN := FALSE;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  BEGIN
    is_admin_caller := public.is_admin(auth.uid());
  EXCEPTION WHEN OTHERS THEN
    is_admin_caller := FALSE;
  END;

  -- Platform admins can repair any transition.
  IF is_admin_caller THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('rejected','withdrawn','archived') THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT_TRANSITION: % is terminal (platform admin required to repair)', OLD.status
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'pending' AND NEW.status NOT IN ('approved','rejected','withdrawn') THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT_TRANSITION: pending -> %', NEW.status USING ERRCODE = '22023';
  ELSIF OLD.status = 'approved' AND NEW.status NOT IN ('suspended','withdrawn','archived') THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT_TRANSITION: approved -> %', NEW.status USING ERRCODE = '22023';
  ELSIF OLD.status = 'suspended' AND NEW.status NOT IN ('approved','archived','withdrawn') THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT_TRANSITION: suspended -> %', NEW.status USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_validate_programme_participant_transition
  ON public.programme_participants;
CREATE TRIGGER trg_validate_programme_participant_transition
  BEFORE UPDATE OF status ON public.programme_participants
  FOR EACH ROW EXECUTE FUNCTION public.validate_programme_participant_transition();

-- 4. Tighten entity FK: was ON DELETE CASCADE, now RESTRICT so entity
-- deletion cannot silently nuke participant + fund-flow history.
ALTER TABLE public.programme_participants
  DROP CONSTRAINT IF EXISTS programme_participants_entity_id_fkey;
ALTER TABLE public.programme_participants
  ADD CONSTRAINT programme_participants_entity_id_fkey
  FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE RESTRICT;

-- 5. Soft-archive helper (service-role / edge-function callable).
CREATE OR REPLACE FUNCTION public.archive_programme_participant(
  p_participant_id UUID,
  p_actor_user_id UUID,
  p_actor_org_id UUID,
  p_reason TEXT,
  p_override_linked BOOLEAN DEFAULT FALSE
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_before public.programme_participants%ROWTYPE;
  v_after  public.programme_participants%ROWTYPE;
  v_live_flows INT;
  v_open_milestones INT;
  v_has_trade_approval BOOLEAN;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'ARCHIVE_REASON_REQUIRED: reason must be >=10 chars' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.programme_participants
   WHERE id = p_participant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status = 'archived' THEN
    RAISE EXCEPTION 'ALREADY_ARCHIVED' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_live_flows FROM public.fund_flows
   WHERE participant_id = p_participant_id;
  SELECT count(*) INTO v_open_milestones FROM public.programme_milestones
   WHERE participant_id = p_participant_id
     AND status IN ('pending','in_progress','overdue','disputed');
  v_has_trade_approval := v_before.trade_approval_id IS NOT NULL;

  IF NOT p_override_linked AND (v_live_flows > 0 OR v_open_milestones > 0 OR v_has_trade_approval) THEN
    RAISE EXCEPTION 'PARTICIPANT_LINKED: cannot archive — % fund flows, % open milestones, trade_approval=%',
      v_live_flows, v_open_milestones, v_has_trade_approval
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.programme_participants
     SET status = 'archived',
         archived_at = now(),
         archived_by = p_actor_user_id,
         archive_reason = p_reason
   WHERE id = p_participant_id
  RETURNING * INTO v_after;

  INSERT INTO public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor_org_id,
    p_actor_user_id,
    'programme.participant_archived',
    'programme_participant',
    p_participant_id,
    jsonb_build_object(
      'programme_id', v_before.programme_id,
      'participant_id', p_participant_id,
      'reason', p_reason,
      'override_linked', p_override_linked,
      'linked_fund_flows', v_live_flows,
      'open_milestones', v_open_milestones,
      'had_trade_approval', v_has_trade_approval,
      'before', to_jsonb(v_before),
      'after', to_jsonb(v_after),
      'actor_user_id', p_actor_user_id,
      'actor_org_id', p_actor_org_id,
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object('ok', true, 'participant', to_jsonb(v_after));
END;
$fn$;

REVOKE ALL ON FUNCTION public.archive_programme_participant(UUID, UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_programme_participant(UUID, UUID, UUID, TEXT, BOOLEAN) FROM authenticated;
REVOKE ALL ON FUNCTION public.archive_programme_participant(UUID, UUID, UUID, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_programme_participant(UUID, UUID, UUID, TEXT, BOOLEAN) TO service_role;
