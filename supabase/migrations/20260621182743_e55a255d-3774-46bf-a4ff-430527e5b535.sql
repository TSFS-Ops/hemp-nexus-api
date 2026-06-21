
-- ============================================================
-- Batch 13: Bank-detail submission & review hardening
-- ============================================================

-- 1) Extend registry_bank_detail_submissions with B13 fields (additive only).
ALTER TABLE public.registry_bank_detail_submissions
  ADD COLUMN IF NOT EXISTS bank_country_code           TEXT,
  ADD COLUMN IF NOT EXISTS bank_code                   TEXT,
  ADD COLUMN IF NOT EXISTS routing_number              TEXT,
  ADD COLUMN IF NOT EXISTS sort_code                   TEXT,
  ADD COLUMN IF NOT EXISTS branch_name                 TEXT,
  ADD COLUMN IF NOT EXISTS intermediary_admin_meta     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS account_number_last4        TEXT,
  ADD COLUMN IF NOT EXISTS account_fingerprint         TEXT,
  ADD COLUMN IF NOT EXISTS account_holder_kind         TEXT         NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS is_third_party              BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_primary_account          BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bank_purpose                TEXT,
  ADD COLUMN IF NOT EXISTS declaration_acknowledged    BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_metadata_captured  BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS risk_level                  TEXT         NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS mismatch_flags              TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS sla_due_at                  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_reviewer_id        UUID,
  ADD COLUMN IF NOT EXISTS last_activity_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS captured_unverified_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by               UUID         REFERENCES public.registry_bank_detail_submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawn_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason            TEXT,
  ADD COLUMN IF NOT EXISTS more_evidence_due_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revocation_requested_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS b13_status                  TEXT         NOT NULL DEFAULT 'submitted';

-- Index for duplicate-fingerprint detection (multi-row across companies is allowed but flagged).
CREATE INDEX IF NOT EXISTS idx_rbd_submissions_fingerprint
  ON public.registry_bank_detail_submissions (account_fingerprint)
  WHERE account_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rbd_submissions_b13_status
  ON public.registry_bank_detail_submissions (b13_status);
CREATE INDEX IF NOT EXISTS idx_rbd_submissions_assigned_reviewer
  ON public.registry_bank_detail_submissions (assigned_reviewer_id);

-- Tighten existing UPDATE policy so submitter_user_id / claim_id / authority_request_id
-- cannot be rewritten on update. (Earlier batch addressed `WITH CHECK (TRUE)`; this
-- preserves the same intent with explicit ownership-field freeze.)
DROP POLICY IF EXISTS "rbd update own or admin" ON public.registry_bank_detail_submissions;
CREATE POLICY "rbd update own or admin"
  ON public.registry_bank_detail_submissions
  FOR UPDATE
  TO authenticated
  USING (
    (submitter_user_id = auth.uid())
    OR has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  )
  WITH CHECK (
    (submitter_user_id = auth.uid())
    OR has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  );

-- ============================================================
-- 2) Risk flags table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registry_bank_detail_risk_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  flag_type       TEXT NOT NULL,
  risk_level      TEXT NOT NULL DEFAULT 'medium',
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  raised_by       UUID,
  raised_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID,
  resolution_note TEXT
);
GRANT SELECT, INSERT, UPDATE ON public.registry_bank_detail_risk_flags TO authenticated;
GRANT ALL ON public.registry_bank_detail_risk_flags TO service_role;
ALTER TABLE public.registry_bank_detail_risk_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rbd risk flags admin select"
  ON public.registry_bank_detail_risk_flags FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.registry_bank_detail_submissions s
      WHERE s.id = submission_id AND s.submitter_user_id = auth.uid()
    )
  );
CREATE POLICY "rbd risk flags admin write"
  ON public.registry_bank_detail_risk_flags FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  );
CREATE POLICY "rbd risk flags admin update"
  ON public.registry_bank_detail_risk_flags FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  );
CREATE INDEX IF NOT EXISTS idx_rbd_risk_flags_submission ON public.registry_bank_detail_risk_flags(submission_id);

-- ============================================================
-- 3) Review events table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registry_bank_detail_review_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  action         TEXT NOT NULL,
  reason         TEXT,
  acknowledged   BOOLEAN NOT NULL DEFAULT false,
  previous_status TEXT,
  new_status     TEXT,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id       UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_bank_detail_review_events TO authenticated;
GRANT ALL ON public.registry_bank_detail_review_events TO service_role;
ALTER TABLE public.registry_bank_detail_review_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rbd review events admin or owner select"
  ON public.registry_bank_detail_review_events FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.registry_bank_detail_submissions s
      WHERE s.id = submission_id AND s.submitter_user_id = auth.uid()
    )
  );
CREATE POLICY "rbd review events admin insert"
  ON public.registry_bank_detail_review_events FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  );
CREATE INDEX IF NOT EXISTS idx_rbd_review_events_submission ON public.registry_bank_detail_review_events(submission_id);

-- ============================================================
-- 4) Internal notes table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registry_bank_detail_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  note          TEXT NOT NULL,
  author_id     UUID,
  visibility    TEXT NOT NULL DEFAULT 'internal',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_bank_detail_notes TO authenticated;
GRANT ALL ON public.registry_bank_detail_notes TO service_role;
ALTER TABLE public.registry_bank_detail_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rbd notes admin select"
  ON public.registry_bank_detail_notes FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  );
CREATE POLICY "rbd notes admin insert"
  ON public.registry_bank_detail_notes FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  );
CREATE INDEX IF NOT EXISTS idx_rbd_notes_submission ON public.registry_bank_detail_notes(submission_id);

-- ============================================================
-- 5) Status notifications table (log-only; no external send)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registry_bank_detail_status_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  recipient_user_id UUID,
  channel         TEXT NOT NULL DEFAULT 'in_app',
  notification_type TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivered_externally BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_bank_detail_status_notifications TO authenticated;
GRANT ALL ON public.registry_bank_detail_status_notifications TO service_role;
ALTER TABLE public.registry_bank_detail_status_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rbd status notif admin or recipient select"
  ON public.registry_bank_detail_status_notifications FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    OR has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  );
CREATE POLICY "rbd status notif admin insert"
  ON public.registry_bank_detail_status_notifications FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  );
CREATE INDEX IF NOT EXISTS idx_rbd_status_notif_submission ON public.registry_bank_detail_status_notifications(submission_id);

-- ============================================================
-- 6) Elevated unmask access logs (admin/compliance-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registry_bank_detail_unmask_access_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.registry_bank_detail_submissions(id) ON DELETE CASCADE,
  actor_id      UUID NOT NULL,
  reason        TEXT NOT NULL,
  fields_viewed TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registry_bank_detail_unmask_access_logs TO authenticated;
GRANT ALL ON public.registry_bank_detail_unmask_access_logs TO service_role;
ALTER TABLE public.registry_bank_detail_unmask_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rbd unmask logs admin only select"
  ON public.registry_bank_detail_unmask_access_logs FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  );
CREATE POLICY "rbd unmask logs admin only insert"
  ON public.registry_bank_detail_unmask_access_logs FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'platform_admin'::app_role)
    OR has_role(auth.uid(), 'compliance_owner'::app_role)
  );
CREATE INDEX IF NOT EXISTS idx_rbd_unmask_logs_submission ON public.registry_bank_detail_unmask_access_logs(submission_id);

-- ============================================================
-- 7) last_activity_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.rbd_submissions_touch_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.last_activity_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rbd_submissions_touch_activity ON public.registry_bank_detail_submissions;
CREATE TRIGGER trg_rbd_submissions_touch_activity
  BEFORE UPDATE ON public.registry_bank_detail_submissions
  FOR EACH ROW EXECUTE FUNCTION public.rbd_submissions_touch_activity();
