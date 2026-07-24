-- =====================================================================
-- Institutional Funder Evidence Workspace -- Batch 10
-- Decision Engine completion: non-binding Reviewer/Approver
-- recommendations, evidence-pack version reference, unresolved-RFI
-- snapshot, and mandatory supersession reason for the existing
-- Batch 5 formal decision RPC.
--
-- Strictly additive:
-- - funder_workspace_decisions gains three new nullable/defaulted
--   columns; no existing column is renamed, dropped, or retyped.
-- - fw_funder_record_decision_v1 keeps its original four parameters
--   and adds one new DEFAULT NULL parameter at the end so existing
--   callers continue to work unchanged.
-- - A new table funder_workspace_decision_recommendations is created
--   for non-binding recommendations; it does not replace or duplicate
--   funder_workspace_decisions, which remains the sole source of the
--   binding, versioned, immutable decision record.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Extend funder_usage_events event_type CHECK (additive).
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
  'decision_recorded','recommendation_submitted',
  'user_invited','user_deactivated'
  ])
  );

-- ---------------------------------------------------------------------
-- 1) funder_workspace_decisions: evidence-pack version reference,
-- unresolved-RFI snapshot, and mandatory supersession reason.
-- ---------------------------------------------------------------------
ALTER TABLE public.funder_workspace_decisions
ADD COLUMN IF NOT EXISTS pack_version_id uuid REFERENCES public.funder_pack_versions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS open_rfi_count_at_decision integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS supersession_reason text;

DO $$ BEGIN
IF NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'funder_workspace_decisions_supersession_needs_reason'
  ) THEN
ALTER TABLE public.funder_workspace_decisions
ADD CONSTRAINT funder_workspace_decisions_supersession_needs_reason CHECK (
  supersedes_decision_id IS NULL
  OR (supersession_reason IS NOT NULL AND length(btrim(supersession_reason)) > 0)
  );
END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fw_decision_pack_version
ON public.funder_workspace_decisions(pack_version_id);

-- ---------------------------------------------------------------------
-- 2) funder_workspace_decision_recommendations -- non-binding Reviewer
-- or Approver recommendations. Append-only (no UPDATE/DELETE policy);
-- the formal, binding record remains funder_workspace_decisions.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funder_workspace_decision_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES public.funder_deal_releases(id) ON DELETE CASCADE,
  funder_organisation_id uuid NOT NULL REFERENCES public.p5_batch3_funder_organisations(id) ON DELETE CASCADE,
  recommended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recommended_by_role text NOT NULL CHECK (recommended_by_role IN ('reviewer','approver')),
  recommended_status text NOT NULL CHECK (recommended_status IN ('conditional','approved','declined')),
  reason text NOT NULL,
  conditions text,
  pack_version_id uuid REFERENCES public.funder_pack_versions(id) ON DELETE SET NULL,
  open_rfi_count_at_recommendation integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funder_workspace_recommendations_reason_nonempty CHECK (length(btrim(reason)) > 0),
  CONSTRAINT funder_workspace_recommendations_cond_needs_conditions CHECK (
  recommended_status <> 'conditional' OR (conditions IS NOT NULL AND length(btrim(conditions)) > 0)
  )
  );
CREATE INDEX IF NOT EXISTS idx_fw_recommendation_release
ON public.funder_workspace_decision_recommendations(release_id);
CREATE INDEX IF NOT EXISTS idx_fw_recommendation_org
ON public.funder_workspace_decision_recommendations(funder_organisation_id);

GRANT SELECT ON public.funder_workspace_decision_recommendations TO authenticated;
GRANT ALL ON public.funder_workspace_decision_recommendations TO service_role;

ALTER TABLE public.funder_workspace_decision_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fw_recommendation_admin_select"
ON public.funder_workspace_decision_recommendations
FOR SELECT TO authenticated
USING (public.p5b3_is_platform_admin());

CREATE POLICY "fw_recommendation_funder_select"
ON public.funder_workspace_decision_recommendations
FOR SELECT TO authenticated
USING (funder_organisation_id = public.fw_current_funder_org_v1());

-- No UPDATE/DELETE policy for any role: recommendations are immutable
-- once submitted. Corrections are made by submitting a further
-- recommendation, preserving full history for audit.

-- ---------------------------------------------------------------------
-- 3) fw_funder_submit_recommendation_v1 -- Reviewer or Approver only.
-- Non-binding; never gates or blocks the formal Approver decision.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fw_funder_submit_recommendation_v1(
  p_release_id uuid,
  p_recommended_status text,
  p_reason text,
  p_conditions text
  ) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
v_uid uuid := auth.uid();
v_role text;
v_org uuid;
v_status text;
v_expires timestamptz;
v_pack_version_id uuid;
v_open_rfi_count int;
v_id uuid;
BEGIN
IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
IF p_recommended_status NOT IN ('conditional','approved','declined') THEN
RAISE EXCEPTION 'invalid_recommended_status';
END IF;
IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
RAISE EXCEPTION 'reason_required';
END IF;
IF p_recommended_status = 'conditional'
AND (p_conditions IS NULL OR length(btrim(p_conditions)) = 0) THEN
RAISE EXCEPTION 'conditions_required_for_conditional_recommendation';
END IF;

SELECT funder_organisation_id, release_status, expires_at
INTO v_org, v_status, v_expires
FROM public.funder_deal_releases WHERE id = p_release_id;
IF v_org IS NULL THEN RAISE EXCEPTION 'release_not_found'; END IF;
IF v_status <> 'active' THEN RAISE EXCEPTION 'release_not_active'; END IF;
IF v_expires IS NOT NULL AND v_expires <= now() THEN RAISE EXCEPTION 'release_expired'; END IF;

v_role := public.fw_v1_role_for_release(p_release_id);
IF v_role IS NULL THEN RAISE EXCEPTION 'not_a_funder_user_for_release'; END IF;
IF v_role NOT IN ('reviewer','approver') THEN RAISE EXCEPTION 'insufficient_role'; END IF;

SELECT pv.id INTO v_pack_version_id
FROM public.funder_pack_versions pv
WHERE pv.release_id = p_release_id AND pv.status = 'sealed'
ORDER BY pv.version DESC LIMIT 1;

SELECT count(*) INTO v_open_rfi_count
FROM public.funder_workspace_rfis
WHERE release_id = p_release_id AND status NOT IN ('closed','withdrawn');

INSERT INTO public.funder_workspace_decision_recommendations(
  release_id, funder_organisation_id, recommended_by, recommended_by_role,
  recommended_status, reason, conditions, pack_version_id, open_rfi_count_at_recommendation
  ) VALUES (
  p_release_id, v_org, v_uid, v_role,
  p_recommended_status, btrim(p_reason), NULLIF(btrim(COALESCE(p_conditions,'')), ''),
  v_pack_version_id, v_open_rfi_count
  ) RETURNING id INTO v_id;

PERFORM public.fw_audit('fw_recommendation_submitted', v_org, 'funder_workspace_decision_recommendation', v_id,
  NULL, jsonb_build_object('release_id', p_release_id, 'recommended_status', p_recommended_status,
  'recommended_by_role', v_role, 'open_rfi_count', v_open_rfi_count), NULL);
PERFORM public.fw_record_usage(v_org, NULL, p_release_id, v_pack_version_id, 'recommendation_submitted',
  jsonb_build_object('recommendation_id', v_id, 'recommended_status', p_recommended_status,
  'recommended_by_role', v_role));

RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.fw_funder_submit_recommendation_v1(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_submit_recommendation_v1(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 4) fw_funder_record_decision_v1 -- add evidence-pack version capture,
-- unresolved-RFI snapshot, and a mandatory supersession reason whenever
-- a decision replaces a prior current decision for the same release.
-- Original four parameters are unchanged; the new parameter is added
-- at the end with a DEFAULT so existing callers are unaffected.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fw_funder_record_decision_v1(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.fw_funder_record_decision_v1(
  p_release_id uuid,
  p_decision_status text,
  p_reason text,
  p_conditions text,
  p_supersession_reason text DEFAULT NULL
  ) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
v_uid uuid := auth.uid(); v_role text; v_org uuid; v_status text; v_expires timestamptz;
v_prev_id uuid; v_prev_version int; v_new_id uuid;
v_pack_version_id uuid; v_open_rfi_count int;
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

IF v_prev_id IS NOT NULL
AND (p_supersession_reason IS NULL OR length(btrim(p_supersession_reason)) = 0) THEN
RAISE EXCEPTION 'supersession_reason_required';
END IF;

IF v_prev_id IS NOT NULL THEN
UPDATE public.funder_workspace_decisions
SET is_current = false
WHERE id = v_prev_id;
END IF;

SELECT pv.id INTO v_pack_version_id
FROM public.funder_pack_versions pv
WHERE pv.release_id = p_release_id AND pv.status = 'sealed'
ORDER BY pv.version DESC LIMIT 1;

SELECT count(*) INTO v_open_rfi_count
FROM public.funder_workspace_rfis
WHERE release_id = p_release_id AND status NOT IN ('closed','withdrawn');

INSERT INTO public.funder_workspace_decisions(
  release_id, funder_organisation_id, decided_by,
  decision_status, reason, conditions,
  decision_version, is_current, supersedes_decision_id,
  pack_version_id, open_rfi_count_at_decision, supersession_reason
  ) VALUES (
  p_release_id, v_org, v_uid,
  p_decision_status,
  NULLIF(btrim(COALESCE(p_reason,'')), ''),
  NULLIF(btrim(COALESCE(p_conditions,'')), ''),
  COALESCE(v_prev_version, 0) + 1, true, v_prev_id,
  v_pack_version_id, v_open_rfi_count,
  CASE WHEN v_prev_id IS NOT NULL THEN NULLIF(btrim(p_supersession_reason), '') END
  ) RETURNING id INTO v_new_id;

PERFORM public.fw_audit('fw_decision_recorded', v_org, 'funder_workspace_decision', v_new_id,
  CASE WHEN v_prev_id IS NULL THEN NULL
  ELSE jsonb_build_object('supersedes', v_prev_id, 'prior_version', v_prev_version,
  'supersession_reason', p_supersession_reason) END,
  jsonb_build_object('release_id', p_release_id, 'status', p_decision_status,
  'open_rfi_count_at_decision', v_open_rfi_count, 'pack_version_id', v_pack_version_id), p_reason);
PERFORM public.fw_record_usage(v_org, NULL, p_release_id, v_pack_version_id, 'decision_recorded',
  jsonb_build_object('decision_id', v_new_id, 'status', p_decision_status,
  'version', COALESCE(v_prev_version, 0) + 1, 'open_rfi_count_at_decision', v_open_rfi_count));

RETURN v_new_id;
END; $$;
REVOKE ALL ON FUNCTION public.fw_funder_record_decision_v1(uuid, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fw_funder_record_decision_v1(uuid, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 5) Notification: distinguish "decision recorded" (first decision)
-- from "decision superseded" (a later version replacing a prior one),
-- and add a recommendation-submitted notification. Reuses the existing
-- fw_notify_event_v1 fan-out helper; no new notification system.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fw_trg_decision_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
IF NEW.supersedes_decision_id IS NOT NULL THEN
PERFORM public.fw_notify_event_v1(
  'funder_workspace.decision_superseded', NEW.funder_organisation_id, NEW.release_id,
  'funder_workspace_decision', NEW.id,
  'Funder decision superseded: ' || NEW.decision_status,
  COALESCE(NEW.supersession_reason, ''),
  '/funder/workspace/deals/' || NEW.release_id::text,
  ARRAY['admin','approver','reviewer'], true, false
  );
ELSE
PERFORM public.fw_notify_event_v1(
  'funder_workspace.decision_recorded', NEW.funder_organisation_id, NEW.release_id,
  'funder_workspace_decision', NEW.id,
  'Funder decision recorded: ' || NEW.decision_status,
  COALESCE(NEW.reason, ''),
  '/funder/workspace/deals/' || NEW.release_id::text,
  ARRAY['admin','approver','reviewer'], true, false
  );
END IF;
RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;
-- Trigger already exists from Batch 6; only the function body changes.

CREATE OR REPLACE FUNCTION public.fw_trg_recommendation_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
PERFORM public.fw_notify_event_v1(
  'funder_workspace.recommendation_submitted', NEW.funder_organisation_id, NEW.release_id,
  'funder_workspace_decision_recommendation', NEW.id,
  initcap(NEW.recommended_by_role) || ' recommendation: ' || NEW.recommended_status,
  COALESCE(NEW.reason, ''),
  '/funder/workspace/deals/' || NEW.release_id::text,
  ARRAY['admin','approver'], true, false
  );
RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fw_trg_recommendation_notify ON public.funder_workspace_decision_recommendations;
CREATE TRIGGER fw_trg_recommendation_notify AFTER INSERT ON public.funder_workspace_decision_recommendations
FOR EACH ROW EXECUTE FUNCTION public.fw_trg_recommendation_notify();
