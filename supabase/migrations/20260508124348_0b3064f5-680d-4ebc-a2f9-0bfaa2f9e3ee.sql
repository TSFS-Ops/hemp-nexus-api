-- ─── Columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS counterparty_response text,
  ADD COLUMN IF NOT EXISTS original_expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS late_acceptance_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconfirmation_window_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS late_acceptance_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS late_acceptance_resolution text,
  ADD COLUMN IF NOT EXISTS reconfirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconfirmed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renewed_from_engagement_id uuid REFERENCES public.poi_engagements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renewed_engagement_id uuid REFERENCES public.poi_engagements(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.poi_engagements.counterparty_response IS
  'Batch B: counterparty acceptance response. NULL until counterparty acts. Allowed: accepted, declined, late_accepted.';
COMMENT ON COLUMN public.poi_engagements.original_expired_at IS
  'Batch B: snapshot of expires_at at the moment a counterparty late-accepted (parent row only).';
COMMENT ON COLUMN public.poi_engagements.late_acceptance_recorded_at IS
  'Batch B: timestamp the late acceptance was recorded on the expired parent row.';
COMMENT ON COLUMN public.poi_engagements.reconfirmation_window_expires_at IS
  'Batch B: deadline by which the initiator must reconfirm or decline the late acceptance.';
COMMENT ON COLUMN public.poi_engagements.late_acceptance_resolved_at IS
  'Batch B: timestamp the late acceptance was resolved (renewed, declined, or window expired).';
COMMENT ON COLUMN public.poi_engagements.late_acceptance_resolution IS
  'Batch B: how the late acceptance was resolved. Allowed: renewed_engagement_created, initiator_declined_renewal, reconfirmation_window_expired.';
COMMENT ON COLUMN public.poi_engagements.reconfirmed_at IS
  'Batch B: timestamp the initiator reconfirmed the late acceptance and a renewed child was created.';
COMMENT ON COLUMN public.poi_engagements.reconfirmed_by_user_id IS
  'Batch B: user who reconfirmed the late acceptance.';
COMMENT ON COLUMN public.poi_engagements.renewed_from_engagement_id IS
  'Batch B: on a renewed child row, the id of the expired parent engagement it was created from.';
COMMENT ON COLUMN public.poi_engagements.renewed_engagement_id IS
  'Batch B: on the expired parent row, the id of the renewed child engagement created on reconfirmation.';

-- ─── Check constraints ─────────────────────────────────────────────────────
ALTER TABLE public.poi_engagements
  DROP CONSTRAINT IF EXISTS poi_engagements_counterparty_response_chk;
ALTER TABLE public.poi_engagements
  ADD CONSTRAINT poi_engagements_counterparty_response_chk
  CHECK (
    counterparty_response IS NULL
    OR counterparty_response IN ('accepted','declined','late_accepted')
  );

ALTER TABLE public.poi_engagements
  DROP CONSTRAINT IF EXISTS poi_engagements_late_acceptance_resolution_chk;
ALTER TABLE public.poi_engagements
  ADD CONSTRAINT poi_engagements_late_acceptance_resolution_chk
  CHECK (
    late_acceptance_resolution IS NULL
    OR late_acceptance_resolution IN (
      'renewed_engagement_created',
      'initiator_declined_renewal',
      'reconfirmation_window_expired'
    )
  );

-- When an engagement is in the late-acceptance reconfirmation state, the
-- supporting timestamps must be present. Any other status is unconstrained
-- here (workflow logic in Phase 3 may add further rules).
ALTER TABLE public.poi_engagements
  DROP CONSTRAINT IF EXISTS poi_engagements_late_acceptance_required_fields_chk;
ALTER TABLE public.poi_engagements
  ADD CONSTRAINT poi_engagements_late_acceptance_required_fields_chk
  CHECK (
    engagement_status <> 'late_acceptance_pending_initiator_reconfirmation'
    OR (
      original_expired_at IS NOT NULL
      AND late_acceptance_recorded_at IS NOT NULL
      AND reconfirmation_window_expires_at IS NOT NULL
    )
  );

-- ─── Replace UNIQUE(match_id) with current-engagement uniqueness ───────────
-- Old rule: at most one engagement row per match (any status).
-- New rule: at most one ACTIVE (non-historical) engagement per match.
-- Historical = engagement_status IN ('expired','declined'). All other
-- statuses (notification_sent, contacted, accepted,
-- late_acceptance_pending_initiator_reconfirmation, legacy 'pending')
-- count as active and are mutually exclusive per match.
ALTER TABLE public.poi_engagements
  DROP CONSTRAINT IF EXISTS unique_match_engagement;

CREATE UNIQUE INDEX IF NOT EXISTS uq_poi_engagements_one_current_per_match
  ON public.poi_engagements (match_id)
  WHERE engagement_status NOT IN ('expired','declined');

COMMENT ON INDEX public.uq_poi_engagements_one_current_per_match IS
  'Batch B Phase 2: replaces UNIQUE(match_id). Allows historical (expired/declined) rows to coexist with at most one active engagement per match. Rollback to UNIQUE(match_id) is only safe when no match has more than one row.';

-- ─── Duplicate-renewal prevention ──────────────────────────────────────────
-- A given expired parent can only be renewed once. Multiple NULLs allowed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_poi_engagements_renewed_from_once
  ON public.poi_engagements (renewed_from_engagement_id)
  WHERE renewed_from_engagement_id IS NOT NULL;

COMMENT ON INDEX public.uq_poi_engagements_renewed_from_once IS
  'Batch B Phase 2: prevents the same expired parent engagement from being renewed more than once.';

-- ─── Supporting indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_poi_engagements_reconfirmation_window
  ON public.poi_engagements (reconfirmation_window_expires_at)
  WHERE engagement_status = 'late_acceptance_pending_initiator_reconfirmation';