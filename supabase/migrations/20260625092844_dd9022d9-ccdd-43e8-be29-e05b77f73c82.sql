CREATE TABLE IF NOT EXISTS public.p5_batch3_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('internal_admin', 'external_funder', 'system')),
  idempotency_key text NOT NULL UNIQUE,
  due_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.p5_batch3_tasks TO authenticated;
GRANT ALL ON public.p5_batch3_tasks TO service_role;

ALTER TABLE public.p5_batch3_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p5b3_tasks_admin_read" ON public.p5_batch3_tasks;
CREATE POLICY "p5b3_tasks_admin_read"
  ON public.p5_batch3_tasks
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

CREATE INDEX IF NOT EXISTS idx_p5b3_tasks_kind ON public.p5_batch3_tasks (kind);
CREATE INDEX IF NOT EXISTS idx_p5b3_tasks_due_at ON public.p5_batch3_tasks (due_at);

CREATE OR REPLACE FUNCTION public.p5b3_record_task_intent_v1(
  p_kind text,
  p_audience text,
  p_idempotency_key text,
  p_due_at timestamptz,
  p_payload jsonb,
  p_refs jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'platform_admin') THEN
    RAISE EXCEPTION 'p5b3_record_task_intent_v1: platform_admin required';
  END IF;

  INSERT INTO public.p5_batch3_tasks (kind, audience, idempotency_key, due_at, payload, refs)
  VALUES (p_kind, p_audience, p_idempotency_key, p_due_at, p_payload, p_refs)
  ON CONFLICT (idempotency_key) DO UPDATE SET due_at = EXCLUDED.due_at
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.p5b3_record_task_intent_v1(text, text, text, timestamptz, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p5b3_record_task_intent_v1(text, text, text, timestamptz, jsonb, jsonb)
  TO authenticated, service_role;