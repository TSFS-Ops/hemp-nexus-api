
-- Batch 9B: facilitation positive-response next-step tasks.
CREATE TABLE public.facilitation_case_next_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  assigned_to uuid NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  next_step_type text NOT NULL CHECK (next_step_type IN ('positive_response_followup')),
  title text NOT NULL,
  description text NOT NULL,
  required_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_trade_request_id uuid NULL,
  related_match_id uuid NULL,
  related_organization_id uuid NULL,
  trigger_event_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  completed_by uuid NULL,
  completion_note text NULL
);

GRANT SELECT ON public.facilitation_case_next_steps TO authenticated;
GRANT ALL ON public.facilitation_case_next_steps TO service_role;

ALTER TABLE public.facilitation_case_next_steps ENABLE ROW LEVEL SECURITY;

-- Read: admins / compliance / case owner / assignee only. Requesters are NOT included.
CREATE POLICY "next_steps_admin_read"
ON public.facilitation_case_next_steps
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_admin')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'compliance_analyst')
  OR assigned_to = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id = facilitation_case_next_steps.case_id
      AND fc.case_owner_id = auth.uid()
  )
);

-- All writes go through service_role (edge function). No direct INSERT/UPDATE/DELETE policies.

-- Idempotency: at most one open/in_progress task per (case_id, next_step_type).
CREATE UNIQUE INDEX facilitation_case_next_steps_open_uniq
  ON public.facilitation_case_next_steps (case_id, next_step_type)
  WHERE status IN ('open','in_progress');

CREATE INDEX facilitation_case_next_steps_case_idx
  ON public.facilitation_case_next_steps (case_id, created_at DESC);
CREATE INDEX facilitation_case_next_steps_assignee_idx
  ON public.facilitation_case_next_steps (assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE TRIGGER trg_facilitation_case_next_steps_updated
BEFORE UPDATE ON public.facilitation_case_next_steps
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
