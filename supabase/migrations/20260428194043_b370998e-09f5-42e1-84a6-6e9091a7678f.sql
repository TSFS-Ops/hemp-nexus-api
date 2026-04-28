CREATE TABLE IF NOT EXISTS public.ledger_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number bigserial NOT NULL,
  event_type      text NOT NULL,
  org_id          uuid NOT NULL,
  match_id        uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  prev_hash       text,
  payload_hash    text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_events_sequence ON public.ledger_events (sequence_number DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_events_org      ON public.ledger_events (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_events_match    ON public.ledger_events (match_id);
CREATE INDEX IF NOT EXISTS idx_ledger_events_type     ON public.ledger_events (event_type);

ALTER TABLE public.ledger_events ENABLE ROW LEVEL SECURITY;

-- Reads scoped to org membership via the profiles table; writes happen
-- only inside SECURITY DEFINER functions (atomic_generate_poi_v2 etc.),
-- so no INSERT/UPDATE/DELETE policies are exposed to clients — the
-- ledger is append-only.
CREATE POLICY "Org members can read their ledger events"
  ON public.ledger_events
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "Platform admins can read all ledger events"
  ON public.ledger_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
