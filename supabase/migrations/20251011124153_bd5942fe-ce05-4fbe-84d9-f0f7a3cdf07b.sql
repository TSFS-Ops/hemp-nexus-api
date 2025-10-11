-- SignalRank schema: signal-based matching system

-- Drop old marketplace tables (no longer needed)
DROP TABLE IF EXISTS broker_mandates CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS listings CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS certificates CASCADE;
DROP TABLE IF EXISTS categories CASCADE;

-- Signal types enum
CREATE TYPE signal_type AS ENUM ('buyer', 'seller');

-- Signals table (buyer/seller needs or offers)
CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type signal_type NOT NULL,
  content JSONB NOT NULL, -- { what, how_much, unit, where, when, price_budget, quality_requirements }
  status TEXT NOT NULL DEFAULT 'active', -- active, matched, expired
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

-- Data sources (connectors to external systems)
CREATE TABLE data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- marketplace, sheet, erp, registry, lab
  config JSONB NOT NULL DEFAULT '{}', -- connection settings, credentials
  status TEXT NOT NULL DEFAULT 'active',
  last_queried_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consents (permission to query data sources)
CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  data_source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES profiles(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  scope JSONB NOT NULL DEFAULT '{}', -- what can be queried
  revoked_at TIMESTAMPTZ
);

-- Options (normalized search results)
CREATE TABLE options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  data_source_id UUID NOT NULL REFERENCES data_sources(id),
  
  -- Normalized fields
  what TEXT NOT NULL,
  how_much NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  where_location TEXT,
  when_available TEXT,
  price NUMERIC,
  currency TEXT DEFAULT 'USD',
  quality_flags JSONB DEFAULT '{}',
  
  -- Metadata
  confidence_score NUMERIC, -- 0-1
  freshness TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_link TEXT,
  score NUMERIC, -- combined score
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Selections (when user picks an option)
CREATE TABLE selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(id),
  option_id UUID NOT NULL REFERENCES options(id),
  selected_by UUID REFERENCES profiles(id),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handoff_status TEXT DEFAULT 'pending', -- pending, completed, failed
  handoff_data JSONB DEFAULT '{}',
  handoff_token TEXT -- short-lived token for handoff
);

-- Enable RLS
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE options ENABLE ROW LEVEL SECURITY;
ALTER TABLE selections ENABLE ROW LEVEL SECURITY;

-- RLS Policies for signals
CREATE POLICY "Users can manage their org's signals"
  ON signals FOR ALL
  USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- RLS Policies for data_sources
CREATE POLICY "Users can manage their org's data sources"
  ON data_sources FOR ALL
  USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- RLS Policies for consents
CREATE POLICY "Users can manage their org's consents"
  ON consents FOR ALL
  USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- RLS Policies for options
CREATE POLICY "Users can view options for their signals"
  ON options FOR SELECT
  USING (signal_id IN (SELECT id FROM signals WHERE org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())));

CREATE POLICY "System can insert options"
  ON options FOR INSERT
  WITH CHECK (true); -- Inserted by edge functions with service role

-- RLS Policies for selections
CREATE POLICY "Users can manage selections for their signals"
  ON selections FOR ALL
  USING (signal_id IN (SELECT id FROM signals WHERE org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())));

-- Indexes for performance
CREATE INDEX idx_signals_org_status ON signals(org_id, status);
CREATE INDEX idx_signals_created ON signals(created_at DESC);
CREATE INDEX idx_options_signal ON options(signal_id);
CREATE INDEX idx_options_score ON options(signal_id, score DESC);
CREATE INDEX idx_data_sources_org ON data_sources(org_id);
CREATE INDEX idx_consents_org_source ON consents(org_id, data_source_id);

-- Triggers for updated_at
CREATE TRIGGER update_signals_updated_at
  BEFORE UPDATE ON signals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_data_sources_updated_at
  BEFORE UPDATE ON data_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Drop storage bucket for compliance docs (no longer needed)
DELETE FROM storage.buckets WHERE id = 'compliance-documents';