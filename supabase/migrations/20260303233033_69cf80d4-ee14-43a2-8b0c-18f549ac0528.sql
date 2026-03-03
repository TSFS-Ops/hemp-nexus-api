
-- Demo runs table for checkpoint demo harness
CREATE TABLE public.demo_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL UNIQUE,
  actor_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox',
  status text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  summary jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Demo run steps table
CREATE TABLE public.demo_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_run_id uuid NOT NULL REFERENCES public.demo_runs(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  step_name text NOT NULL,
  step_type text NOT NULL DEFAULT 'positive',
  status text NOT NULL DEFAULT 'pending',
  result jsonb DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.demo_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_run_steps ENABLE ROW LEVEL SECURITY;

-- Only directors and platform_admins can access demo runs
CREATE POLICY "Directors and admins can manage demo runs"
  ON public.demo_runs FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'platform_admin'::app_role) 
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'director'::app_role)
    OR has_role(auth.uid(), 'api_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'platform_admin'::app_role) 
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'director'::app_role)
    OR has_role(auth.uid(), 'api_admin'::app_role)
  );

CREATE POLICY "Directors and admins can manage demo run steps"
  ON public.demo_run_steps FOR ALL TO authenticated
  USING (
    demo_run_id IN (
      SELECT id FROM public.demo_runs 
      WHERE has_role(auth.uid(), 'platform_admin'::app_role)
        OR has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'director'::app_role)
        OR has_role(auth.uid(), 'api_admin'::app_role)
    )
  )
  WITH CHECK (
    demo_run_id IN (
      SELECT id FROM public.demo_runs 
      WHERE has_role(auth.uid(), 'platform_admin'::app_role)
        OR has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'director'::app_role)
        OR has_role(auth.uid(), 'api_admin'::app_role)
    )
  );

-- Service role full access
CREATE POLICY "Service role manages demo runs" ON public.demo_runs FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role manages demo run steps" ON public.demo_run_steps FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
