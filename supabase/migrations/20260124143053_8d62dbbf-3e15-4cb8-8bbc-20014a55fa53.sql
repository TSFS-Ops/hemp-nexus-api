-- WaD (Without-a-Doubt) Module Schema
-- Creates sealed evidence bundles for POI records

-- WaD status enum
-- Status lifecycle: draft → awaiting_attestations → sealed → (optional: superseded/revoked)

-- Main WaD table
CREATE TABLE public.wads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id UUID NOT NULL REFERENCES matches(id),
  org_id UUID NOT NULL REFERENCES organizations(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'awaiting_attestations', 'sealed', 'superseded', 'revoked')),
  
  -- Commitment summary fields
  buyer_org_id UUID REFERENCES organizations(id),
  seller_org_id UUID REFERENCES organizations(id),
  buyer_signatory_user_id UUID REFERENCES profiles(id),
  seller_signatory_user_id UUID REFERENCES profiles(id),
  
  -- Evidence and payload
  canonical_payload_json JSONB NOT NULL DEFAULT '{}',
  evidence_bundle JSONB NOT NULL DEFAULT '{}',
  
  -- Seal data (populated when sealed)
  seal_hash TEXT,
  sealed_at TIMESTAMP WITH TIME ZONE,
  ledger_entry_hash TEXT,
  prev_ledger_entry_hash TEXT,
  
  -- Certificate storage
  certificate_path TEXT,
  certificate_generated_at TIMESTAMP WITH TIME ZONE,
  
  -- Revocation / supersession
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by UUID REFERENCES profiles(id),
  revoked_reason TEXT,
  superseded_by_wad_id UUID REFERENCES wads(id),
  supersedes_wad_id UUID REFERENCES wads(id),
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- WaD attestations table (per-party signatures)
CREATE TABLE public.wad_attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wad_id UUID NOT NULL REFERENCES wads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  org_id UUID NOT NULL REFERENCES organizations(id),
  
  -- Attestation details
  role TEXT NOT NULL CHECK (role IN ('buyer_signatory', 'seller_signatory', 'witness', 'admin')),
  attested_name TEXT NOT NULL,
  attestation_text TEXT NOT NULL DEFAULT 'I confirm this is not a contract. No payment. No obligation. This is a record that intent was confirmed.',
  
  -- Security context
  ip_address TEXT,
  user_agent TEXT,
  
  -- Timestamps
  attested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Prevent duplicate attestations
  UNIQUE(wad_id, user_id)
);

-- Indexes for performance
CREATE INDEX idx_wads_poi ON wads(poi_id);
CREATE INDEX idx_wads_org ON wads(org_id);
CREATE INDEX idx_wads_status ON wads(status);
CREATE INDEX idx_wads_created ON wads(created_at DESC);
CREATE INDEX idx_wad_attestations_wad ON wad_attestations(wad_id);
CREATE INDEX idx_wad_attestations_user ON wad_attestations(user_id);

-- Enable RLS
ALTER TABLE wads ENABLE ROW LEVEL SECURITY;
ALTER TABLE wad_attestations ENABLE ROW LEVEL SECURITY;

-- RLS policies for wads
-- POI parties and admin can view
CREATE POLICY "WaD visibility for POI parties and admin"
ON public.wads FOR SELECT
USING (
  -- POI creator org
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR
  -- Buyer org
  buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR
  -- Seller org
  seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR
  -- Admin access
  has_role(auth.uid(), 'admin'::app_role)
);

-- POI parties can create WaD drafts
CREATE POLICY "POI parties can create WaD"
ON public.wads FOR INSERT
WITH CHECK (
  poi_id IN (
    SELECT id FROM matches m
    WHERE m.org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
       OR m.buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
       OR m.seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  )
);

-- POI parties can update WaD (for attestation flow)
CREATE POLICY "POI parties can update WaD"
ON public.wads FOR UPDATE
USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Service role full access
CREATE POLICY "Service role can manage WaDs"
ON public.wads FOR ALL
USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- RLS policies for wad_attestations
CREATE POLICY "Attestation visibility for WaD parties"
ON public.wad_attestations FOR SELECT
USING (
  wad_id IN (
    SELECT id FROM wads w
    WHERE w.org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
       OR w.buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
       OR w.seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
       OR has_role(auth.uid(), 'admin'::app_role)
  )
);

-- Users can create their own attestations
CREATE POLICY "Users can create attestations"
ON public.wad_attestations FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND wad_id IN (
    SELECT id FROM wads w
    WHERE w.status IN ('draft', 'awaiting_attestations')
      AND (
        w.org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
        OR w.buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
        OR w.seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
      )
  )
);

-- Service role full access
CREATE POLICY "Service role can manage attestations"
ON public.wad_attestations FOR ALL
USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Create updated_at trigger for wads
CREATE TRIGGER update_wads_updated_at
BEFORE UPDATE ON wads
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();