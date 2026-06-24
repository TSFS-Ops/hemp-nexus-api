ALTER TABLE public.p5_governance_readiness_cases
  ADD COLUMN IF NOT EXISTS hold_applied_at            timestamptz,
  ADD COLUMN IF NOT EXISTS more_info_requested_at     timestamptz,
  ADD COLUMN IF NOT EXISTS more_info_last_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_extension_active     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hard_blocker_open_since    timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_open               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_requested           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_requested         boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.p5_governance_readiness_cases.hold_applied_at IS
  'P-5 Stage 6: timestamp the active hold was applied. Used by the SLA monitor.';
COMMENT ON COLUMN public.p5_governance_readiness_cases.more_info_requested_at IS
  'P-5 Stage 6: timestamp the latest more-information-required loop opened.';
COMMENT ON COLUMN public.p5_governance_readiness_cases.more_info_last_response_at IS
  'P-5 Stage 6: timestamp of the customer''s latest response in the more-info loop.';
COMMENT ON COLUMN public.p5_governance_readiness_cases.admin_extension_active IS
  'P-5 Stage 6: true when an admin extension suspends the 14-day stale rule.';
COMMENT ON COLUMN public.p5_governance_readiness_cases.hard_blocker_open_since IS
  'P-5 Stage 6: timestamp the current hard blocker was first set.';
COMMENT ON COLUMN public.p5_governance_readiness_cases.dispute_open IS
  'P-5 Stage 6: true while a disputed-decision review is open.';
COMMENT ON COLUMN public.p5_governance_readiness_cases.waiver_requested IS
  'P-5 Stage 6: true while an unapproved waiver request is pending review.';
COMMENT ON COLUMN public.p5_governance_readiness_cases.override_requested IS
  'P-5 Stage 6: true while an unapproved override request is pending review.';

CREATE INDEX IF NOT EXISTS idx_p5_cases_sla_scan
  ON public.p5_governance_readiness_cases (readiness_status, status_changed_at)
  WHERE readiness_status IN (
    'submitted','under_review','more_information_required',
    'internally_ready','provider_dependent','conditional_ready',
    'on_hold','blocked','escalated'
  );

INSERT INTO public.cron_heartbeats (job_name, expected_interval_seconds)
VALUES ('p5-governance-sla-monitor', 900)
ON CONFLICT (job_name) DO NOTHING;