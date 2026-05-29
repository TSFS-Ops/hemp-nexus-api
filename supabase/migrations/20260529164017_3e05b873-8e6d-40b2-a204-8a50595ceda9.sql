
-- DATA-004 Phase 3 — Retention run evidence table.
-- Append-only audit log for retention sweeper runs.

CREATE TABLE IF NOT EXISTS public.retention_run_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  job_name text NOT NULL,
  record_class text NOT NULL,
  org_id uuid NULL,
  status text NOT NULL CHECK (status IN ('started','success','partial','failed','skipped')),
  decision text NULL,
  reason text NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  rows_seen integer NOT NULL DEFAULT 0,
  rows_eligible integer NOT NULL DEFAULT 0,
  rows_purged integer NOT NULL DEFAULT 0,
  rows_skipped_missing_policy integer NOT NULL DEFAULT 0,
  rows_skipped_disabled_policy integer NOT NULL DEFAULT 0,
  rows_skipped_invalid_policy integer NOT NULL DEFAULT 0,
  rows_skipped_legal_hold integer NOT NULL DEFAULT 0,
  rows_skipped_error integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retention_run_evidence_run_id_idx
  ON public.retention_run_evidence (run_id);
CREATE INDEX IF NOT EXISTS retention_run_evidence_job_started_idx
  ON public.retention_run_evidence (job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS retention_run_evidence_class_started_idx
  ON public.retention_run_evidence (record_class, started_at DESC);

-- GRANTs: platform_admin reads via authenticated role + RLS policy below;
-- service_role writes from edge functions.
GRANT SELECT ON public.retention_run_evidence TO authenticated;
GRANT ALL ON public.retention_run_evidence TO service_role;
-- No anon grant: this is sensitive operational evidence.

ALTER TABLE public.retention_run_evidence ENABLE ROW LEVEL SECURITY;

-- Platform admins can read all rows.
CREATE POLICY "platform_admin_can_read_retention_run_evidence"
  ON public.retention_run_evidence
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

-- No INSERT/UPDATE/DELETE policies for authenticated → effectively forbidden.
-- Service role bypasses RLS and is the only writer.
