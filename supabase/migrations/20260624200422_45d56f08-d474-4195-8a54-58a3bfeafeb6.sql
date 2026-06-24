
-- P-5 Batch 2 — Stage 6: isolated tasks + cron-heartbeat surface.
CREATE TABLE IF NOT EXISTS public.p5_batch2_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL,
  audience text NOT NULL,
  severity text NOT NULL,
  idempotency_key text NOT NULL,
  safe_message text NOT NULL,
  internal_message text,
  evidence_item_id uuid REFERENCES public.p5_batch2_evidence_items(id) ON DELETE SET NULL,
  record_id uuid REFERENCES public.p5_batch2_kyc_records(id) ON DELETE SET NULL,
  organization_id uuid,
  audit_action text NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  source text NOT NULL DEFAULT 'sla_monitor',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS p5_batch2_tasks_idempotency_key_uidx
  ON public.p5_batch2_tasks (idempotency_key);

CREATE INDEX IF NOT EXISTS p5_batch2_tasks_record_idx ON public.p5_batch2_tasks (record_id);
CREATE INDEX IF NOT EXISTS p5_batch2_tasks_evidence_idx ON public.p5_batch2_tasks (evidence_item_id);
CREATE INDEX IF NOT EXISTS p5_batch2_tasks_audience_idx ON public.p5_batch2_tasks (audience);

GRANT SELECT ON public.p5_batch2_tasks TO authenticated;
GRANT ALL ON public.p5_batch2_tasks TO service_role;

ALTER TABLE public.p5_batch2_tasks ENABLE ROW LEVEL SECURITY;

-- Read-only for platform_admin and compliance_owner; external audiences (counterparty/funder/api)
-- never see the task table directly — they get safe wording via the edge function in later wiring.
CREATE POLICY "p5b2_tasks_admin_read"
  ON public.p5_batch2_tasks
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin'::app_role)
  );

-- Append-only: no UPDATE / DELETE for any client role; service_role still has ALL.
-- Acknowledgement is a future RPC; for Stage 6 we ship strict append-only.
CREATE OR REPLACE FUNCTION public.p5b2_tasks_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'p5_batch2_tasks is append-only';
END;
$$;

DROP TRIGGER IF EXISTS p5b2_tasks_no_update ON public.p5_batch2_tasks;
CREATE TRIGGER p5b2_tasks_no_update
  BEFORE UPDATE ON public.p5_batch2_tasks
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_tasks_block_mutation();

DROP TRIGGER IF EXISTS p5b2_tasks_no_delete ON public.p5_batch2_tasks;
CREATE TRIGGER p5b2_tasks_no_delete
  BEFORE DELETE ON public.p5_batch2_tasks
  FOR EACH ROW EXECUTE FUNCTION public.p5b2_tasks_block_mutation();
