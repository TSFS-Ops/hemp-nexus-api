
-- V3 Sprint 1: Vault docs, Screening, Risk, Attestations, Governance, Tokens, Event Store

CREATE TABLE IF NOT EXISTS public.vault_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  owner_entity_id uuid REFERENCES public.entities(id),
  case_id uuid REFERENCES public.compliance_cases(id),
  poi_id uuid REFERENCES public.pois(id),
  wad_id uuid REFERENCES public.p3_wads(id),
  pod_id uuid REFERENCES public.pods(id),
  doc_type text NOT NULL,
  storage_uri text NOT NULL,
  sha256_hash text NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  classification text NOT NULL DEFAULT 'SENSITIVE' CHECK (classification IN ('SENSITIVE', 'NON_SENSITIVE'))
);
CREATE INDEX IF NOT EXISTS idx_docs_case ON public.vault_documents(org_id, case_id);
CREATE INDEX IF NOT EXISTS idx_docs_wad ON public.vault_documents(org_id, wad_id);

CREATE TABLE IF NOT EXISTS public.screening_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  entity_id uuid NOT NULL REFERENCES public.entities(id),
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('CLEAR', 'POTENTIAL_MATCH', 'CONFIRMED_MATCH', 'ERROR')),
  response_hash text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  details jsonb
);
CREATE INDEX IF NOT EXISTS idx_screening_runs_entity ON public.screening_runs(org_id, entity_id, ran_at);

CREATE TABLE IF NOT EXISTS public.risk_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  entity_id uuid NOT NULL REFERENCES public.entities(id),
  risk_score numeric(5,2) NOT NULL,
  risk_band text NOT NULL CHECK (risk_band IN ('LOW', 'MEDIUM', 'HIGH', 'BLOCK')),
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_risk_snapshots_entity ON public.risk_snapshots(org_id, entity_id, created_at);

CREATE TABLE IF NOT EXISTS public.p3_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  wad_id uuid NOT NULL REFERENCES public.p3_wads(id),
  signatory_person_id uuid NOT NULL REFERENCES public.entities(id),
  clause_pack_id uuid NOT NULL,
  signature_payload text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'SIGNED' CHECK (status IN ('SIGNED'))
);

CREATE TABLE IF NOT EXISTS public.governance_doc_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  doc_type text NOT NULL,
  category text NOT NULL,
  industry_code text NOT NULL,
  jurisdiction_code text NOT NULL,
  mandatory_flag boolean NOT NULL DEFAULT false,
  fixed_token_burn_amount numeric(18,2) NOT NULL DEFAULT 0,
  allowed_from_state text NOT NULL,
  allowed_to_state text NOT NULL,
  requires_signature boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (org_id, doc_type, industry_code, jurisdiction_code)
);

CREATE TABLE IF NOT EXISTS public.governance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  deal_reference_type text NOT NULL CHECK (deal_reference_type IN ('POI', 'WAD', 'POD')),
  deal_reference_id uuid NOT NULL,
  registry_id uuid NOT NULL REFERENCES public.governance_doc_registry(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'UPLOADED', 'EXECUTED', 'VALIDATED', 'VOID')),
  token_burned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_govdocs_ref ON public.governance_documents(org_id, deal_reference_type, deal_reference_id);

CREATE TABLE IF NOT EXISTS public.token_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  entity_id uuid NOT NULL REFERENCES public.entities(id),
  balance numeric(18,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity_id)
);

CREATE TABLE IF NOT EXISTS public.token_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  wallet_id uuid NOT NULL REFERENCES public.token_wallets(id),
  governance_doc_id uuid REFERENCES public.governance_documents(id),
  type text NOT NULL CHECK (type IN ('BURN')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  balance_before numeric(18,2) NOT NULL,
  balance_after numeric(18,2) NOT NULL,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_token_tx_wallet ON public.token_transactions(org_id, wallet_id, created_at);

CREATE TABLE IF NOT EXISTS public.event_store (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  domain text NOT NULL CHECK (domain IN ('trade', 'trust', 'core', 'intel')),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  event_version int NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_role text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash text,
  event_hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_store_agg ON public.event_store(org_id, aggregate_type, aggregate_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_event_store_domain ON public.event_store(org_id, domain, occurred_at);

-- Append-only triggers
CREATE OR REPLACE FUNCTION public.prevent_event_store_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'Append-only table. No mutations permitted.';
END;
$$;

CREATE TRIGGER trg_event_store_no_update BEFORE UPDATE ON public.event_store FOR EACH ROW EXECUTE FUNCTION public.prevent_event_store_mutation();
CREATE TRIGGER trg_event_store_no_delete BEFORE DELETE ON public.event_store FOR EACH ROW EXECUTE FUNCTION public.prevent_event_store_mutation();
CREATE TRIGGER trg_token_tx_no_update BEFORE UPDATE ON public.token_transactions FOR EACH ROW EXECUTE FUNCTION public.prevent_event_store_mutation();
CREATE TRIGGER trg_token_tx_no_delete BEFORE DELETE ON public.token_transactions FOR EACH ROW EXECUTE FUNCTION public.prevent_event_store_mutation();

-- RLS for all new tables
ALTER TABLE public.vault_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p3_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_doc_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_store ENABLE ROW LEVEL SECURITY;

-- Vault documents
CREATE POLICY "Service role manages vault_documents" ON public.vault_documents FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users manage own org vault_documents" ON public.vault_documents FOR ALL USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())) WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- Screening runs
CREATE POLICY "Service role manages screening_runs" ON public.screening_runs FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org screening_runs" ON public.screening_runs FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins view all screening_runs" ON public.screening_runs FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Risk snapshots
CREATE POLICY "Service role manages risk_snapshots" ON public.risk_snapshots FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org risk_snapshots" ON public.risk_snapshots FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- P3 Attestations
CREATE POLICY "Service role manages p3_attestations" ON public.p3_attestations FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org p3_attestations" ON public.p3_attestations FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- Governance doc registry
CREATE POLICY "Service role manages governance_doc_registry" ON public.governance_doc_registry FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org governance_doc_registry" ON public.governance_doc_registry FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins manage governance_doc_registry" ON public.governance_doc_registry FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Governance documents
CREATE POLICY "Service role manages governance_documents" ON public.governance_documents FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users manage own org governance_documents" ON public.governance_documents FOR ALL USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())) WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- Token wallets
CREATE POLICY "Service role manages token_wallets" ON public.token_wallets FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org token_wallets" ON public.token_wallets FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- Token transactions
CREATE POLICY "Service role manages token_transactions" ON public.token_transactions FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org token_transactions" ON public.token_transactions FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- Event store
CREATE POLICY "Service role manages event_store" ON public.event_store FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org event_store" ON public.event_store FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins view all event_store" ON public.event_store FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
