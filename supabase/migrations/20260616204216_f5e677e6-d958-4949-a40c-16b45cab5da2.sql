ALTER TABLE public.facilitation_cases
  ADD COLUMN IF NOT EXISTS owner_assignment_due_at   timestamptz,
  ADD COLUMN IF NOT EXISTS initial_triage_due_at     timestamptz,
  ADD COLUMN IF NOT EXISTS more_info_response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_outreach_due_at     timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_outreach_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS compliance_review_due_at  timestamptz,
  ADD COLUMN IF NOT EXISTS next_action_due_at        timestamptz,
  ADD COLUMN IF NOT EXISTS is_overdue                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overdue_reasons           text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sla_last_evaluated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at          timestamptz;

CREATE INDEX IF NOT EXISTS facilitation_cases_overdue_idx
  ON public.facilitation_cases (is_overdue)
  WHERE is_overdue = true;

CREATE INDEX IF NOT EXISTS facilitation_cases_next_action_due_idx
  ON public.facilitation_cases (next_action_due_at);

CREATE TABLE IF NOT EXISTS public.facilitation_case_sla_reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  reason_code     text NOT NULL,
  sent_to_user_id uuid NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facilitation_case_sla_reminders_uniq
    UNIQUE (case_id, reason_code, sent_to_user_id)
);

GRANT ALL ON public.facilitation_case_sla_reminders TO service_role;

ALTER TABLE public.facilitation_case_sla_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY facilitation_sla_reminders_admin_read
  ON public.facilitation_case_sla_reminders
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));