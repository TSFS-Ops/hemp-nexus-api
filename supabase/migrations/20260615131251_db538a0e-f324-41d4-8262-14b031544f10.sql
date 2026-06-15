
ALTER TABLE public.ai_outreach_drafts_v2
  ADD COLUMN IF NOT EXISTS is_first_outreach boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS outcome_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_set_by uuid,
  ADD COLUMN IF NOT EXISTS send_confirmation_text text,
  ADD COLUMN IF NOT EXISTS send_confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS send_confirmed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'ai_outreach_drafts_v2'
      AND constraint_name = 'ai_outreach_drafts_v2_outcome_check'
  ) THEN
    ALTER TABLE public.ai_outreach_drafts_v2
      ADD CONSTRAINT ai_outreach_drafts_v2_outcome_check
      CHECK (outcome IS NULL OR outcome IN (
        'no_response',
        'bounced',
        'interested',
        'not_interested',
        'wrong_contact',
        'call_booked',
        'onboarded',
        'converted_to_match',
        'converted_to_POI',
        'closed'
      ));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS ai_od2_outcome_idx ON public.ai_outreach_drafts_v2(outcome);
CREATE INDEX IF NOT EXISTS ai_od2_first_idx ON public.ai_outreach_drafts_v2(is_first_outreach);
