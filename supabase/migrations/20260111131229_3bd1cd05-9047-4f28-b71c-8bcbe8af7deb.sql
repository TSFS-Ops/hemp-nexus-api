-- Token balances per organization
CREATE TABLE public.token_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 10000 CHECK (balance >= 0),
  minimum_required integer NOT NULL DEFAULT 5000,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Token ledger (append-only, immutable)
CREATE TABLE public.token_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES public.api_keys(id),
  endpoint text NOT NULL,
  tokens_burned integer NOT NULL DEFAULT 1,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'blocked')),
  remaining_balance integer NOT NULL,
  request_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Match documents table for document storage
CREATE TABLE public.match_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  uploader_user_id uuid REFERENCES public.profiles(id),
  doc_type text NOT NULL,
  filename text NOT NULL,
  storage_path text NOT NULL,
  file_size integer,
  mime_type text,
  sha256_hash text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'verified', 'expired', 'deleted')),
  expiry_date timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_token_ledger_org_id ON public.token_ledger(org_id);
CREATE INDEX idx_token_ledger_created_at ON public.token_ledger(created_at DESC);
CREATE INDEX idx_token_ledger_endpoint ON public.token_ledger(endpoint);
CREATE INDEX idx_match_documents_match_id ON public.match_documents(match_id);
CREATE INDEX idx_match_documents_org_id ON public.match_documents(org_id);

-- Enable RLS
ALTER TABLE public.token_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for token_balances
CREATE POLICY "Users can view their org's token balance"
ON public.token_balances FOR SELECT
USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Admins can view all token balances"
ON public.token_balances FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all token balances"
ON public.token_balances FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage token balances"
ON public.token_balances FOR ALL
USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- RLS Policies for token_ledger (append-only for service role)
CREATE POLICY "Users can view their org's token ledger"
ON public.token_ledger FOR SELECT
USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Admins can view all token ledger entries"
ON public.token_ledger FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can insert token ledger entries"
ON public.token_ledger FOR INSERT
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- RLS Policies for match_documents
CREATE POLICY "Users can view their org's match documents"
ON public.match_documents FOR SELECT
USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Users can upload documents to their org's matches"
ON public.match_documents FOR INSERT
WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Service role can manage match documents"
ON public.match_documents FOR ALL
USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Trigger to update updated_at
CREATE TRIGGER update_token_balances_updated_at
  BEFORE UPDATE ON public.token_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_match_documents_updated_at
  BEFORE UPDATE ON public.match_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to initialize token balance for new orgs
CREATE OR REPLACE FUNCTION public.initialize_org_token_balance()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.token_balances (org_id, balance, minimum_required)
  VALUES (NEW.id, 10000, 5000)
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to auto-create token balance for new orgs
CREATE TRIGGER on_org_created_init_tokens
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.initialize_org_token_balance();

-- Initialize token balances for existing orgs
INSERT INTO public.token_balances (org_id, balance, minimum_required)
SELECT id, 10000, 5000 FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;