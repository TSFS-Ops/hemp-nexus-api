
CREATE TABLE public.support_escalation_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ok','error')),
  escalated_count INTEGER NOT NULL DEFAULT 0,
  first_response_count INTEGER NOT NULL DEFAULT 0,
  resolution_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  escalations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX support_escalation_runs_started_at_idx
  ON public.support_escalation_runs (started_at DESC);

GRANT SELECT ON public.support_escalation_runs TO authenticated;
GRANT ALL ON public.support_escalation_runs TO service_role;

ALTER TABLE public.support_escalation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view escalation runs"
  ON public.support_escalation_runs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
