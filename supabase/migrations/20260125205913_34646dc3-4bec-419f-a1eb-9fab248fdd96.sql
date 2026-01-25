-- ==============================================
-- P-2 COMPLETION: Database Schema Changes
-- Phase 1: Licences table
-- Phase 2: Match state machine columns
-- Phase 3-5: Token ledger action tracking
-- ==============================================

-- ==============================================
-- PHASE 1: LICENCES TABLE
-- ==============================================

-- Create licences table for annual licence enforcement
CREATE TABLE public.licences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('professional', 'corporate', 'institutional', 'sovereign')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  payment_reference TEXT,
  amount_usd NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT licences_valid_dates CHECK (expires_at > starts_at)
);

-- Create index for fast org lookups
CREATE INDEX idx_licences_org_status ON public.licences(org_id, status);
CREATE INDEX idx_licences_expires_at ON public.licences(expires_at);

-- Enable RLS
ALTER TABLE public.licences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for licences
CREATE POLICY "Users can view their org's licences"
ON public.licences FOR SELECT
USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage all licences"
ON public.licences FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can manage licences"
ON public.licences FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_licences_updated_at
BEFORE UPDATE ON public.licences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==============================================
-- PHASE 2: MATCH STATE MACHINE
-- ==============================================

-- Add state column to matches for transaction state machine
-- States: discovery → intent_declared → counterparty_sighted → committed → completed
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'discovery'
CHECK (state IN ('discovery', 'intent_declared', 'counterparty_sighted', 'committed', 'completed'));

-- Add counterparty sighting tracking
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS counterparty_sighted_at TIMESTAMPTZ;

ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS sighting_tokens_burned INTEGER DEFAULT 0;

-- Add commit tracking for both parties
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS buyer_committed_at TIMESTAMPTZ;

ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS seller_committed_at TIMESTAMPTZ;

-- Add finality burn tracking
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS finality_tokens_burned INTEGER DEFAULT 0;

-- Add declared transaction value for finality burn calculation
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS declared_value_usd NUMERIC;

-- Index for state-based queries
CREATE INDEX IF NOT EXISTS idx_matches_state ON public.matches(state);
CREATE INDEX IF NOT EXISTS idx_matches_org_state ON public.matches(org_id, state);

-- ==============================================
-- PHASE 3-5: TOKEN LEDGER ENHANCEMENTS
-- ==============================================

-- Add action_type to track specific token burns
ALTER TABLE public.token_ledger 
ADD COLUMN IF NOT EXISTS action_type TEXT;

-- Add entity_id for linking burns to specific entities
ALTER TABLE public.token_ledger 
ADD COLUMN IF NOT EXISTS entity_id UUID;

-- Index for action-based queries
CREATE INDEX IF NOT EXISTS idx_token_ledger_action_type ON public.token_ledger(action_type);
CREATE INDEX IF NOT EXISTS idx_token_ledger_entity ON public.token_ledger(entity_id);

-- ==============================================
-- SECURITY: Revoke anon access from licences
-- ==============================================
REVOKE ALL ON public.licences FROM anon;
REVOKE ALL ON public.licences FROM authenticated;