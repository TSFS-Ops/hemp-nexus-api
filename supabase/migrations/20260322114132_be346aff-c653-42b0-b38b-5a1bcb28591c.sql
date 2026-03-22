
-- Add resolution fields and severity to breaches table
ALTER TABLE public.breaches
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS notification_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

-- Add unique constraint to prevent duplicate open breaches per milestone
CREATE UNIQUE INDEX IF NOT EXISTS idx_breaches_unique_open_milestone
  ON public.breaches (milestone_id)
  WHERE status NOT IN ('resolved', 'remediated', 'dismissed');

-- Add overdue_notified_at to pod_milestones to prevent duplicate notifications
ALTER TABLE public.pod_milestones
  ADD COLUMN IF NOT EXISTS overdue_notified_at timestamptz;

-- RLS policies for breaches - ensure org isolation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'breaches' AND policyname = 'breaches_org_select'
  ) THEN
    CREATE POLICY breaches_org_select ON public.breaches
      FOR SELECT TO authenticated
      USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'breaches' AND policyname = 'breaches_org_update'
  ) THEN
    CREATE POLICY breaches_org_update ON public.breaches
      FOR UPDATE TO authenticated
      USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));
  END IF;
END $$;
