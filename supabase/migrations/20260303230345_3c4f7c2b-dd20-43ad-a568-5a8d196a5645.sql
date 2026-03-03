
-- Append-only collapse ledger table
CREATE TABLE public.collapse_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  counterparty_org_id uuid NOT NULL REFERENCES public.organizations(id),
  match_id uuid REFERENCES public.matches(id),
  asset_id text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  price numeric NOT NULL CHECK (price > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  client_timestamp timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  signed_payload text NOT NULL,
  signature_key_id text,
  signature_valid boolean NOT NULL DEFAULT false,
  payload_hash text NOT NULL,
  poi_state text NOT NULL DEFAULT 'COLLAPSED',
  metadata jsonb DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_idempotency_per_org UNIQUE (org_id, idempotency_key),
  CONSTRAINT no_self_trade CHECK (org_id != counterparty_org_id)
);

-- Prevent any UPDATE or DELETE on collapse_ledger (append-only)
CREATE OR REPLACE FUNCTION public.prevent_collapse_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'Collapse ledger is append-only. No mutations permitted.';
END;
$$;

CREATE TRIGGER prevent_collapse_update
  BEFORE UPDATE ON public.collapse_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_collapse_ledger_mutation();

CREATE TRIGGER prevent_collapse_delete
  BEFORE DELETE ON public.collapse_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_collapse_ledger_mutation();

-- RLS
ALTER TABLE public.collapse_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages collapse ledger"
  ON public.collapse_ledger FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Users view own org collapse records"
  ON public.collapse_ledger FOR SELECT
  USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Admins view all collapse records"
  ON public.collapse_ledger FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for idempotency lookups
CREATE INDEX idx_collapse_ledger_idempotency ON public.collapse_ledger (org_id, idempotency_key);
CREATE INDEX idx_collapse_ledger_match ON public.collapse_ledger (match_id);
