-- Data Source Connector Marketplace Tables

-- Registration requests from external suppliers/marketplaces
CREATE TABLE IF NOT EXISTS public.data_source_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  submitted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  
  -- Company/Organization Info
  company_name TEXT NOT NULL,
  company_description TEXT,
  company_website TEXT,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  
  -- Data Source Details
  data_source_name TEXT NOT NULL,
  data_source_type TEXT NOT NULL, -- 'api', 'webhook', 'scraper', 'manual'
  endpoint_url TEXT,
  api_documentation TEXT,
  supported_products JSONB DEFAULT '[]'::jsonb,
  supported_regions JSONB DEFAULT '[]'::jsonb,
  
  -- Compliance & Verification
  regulatory_licenses JSONB DEFAULT '[]'::jsonb,
  certifications JSONB DEFAULT '[]'::jsonb,
  verification_documents JSONB DEFAULT '[]'::jsonb,
  
  -- Status & Workflow
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'active', 'suspended'
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.data_source_registrations ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view registrations for their org"
  ON public.data_source_registrations
  FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create registrations for their org"
  ON public.data_source_registrations
  FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their org's registrations"
  ON public.data_source_registrations
  FOR UPDATE
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage all registrations"
  ON public.data_source_registrations
  FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Reputation System Tables

-- Reputation scores for organizations
CREATE TABLE IF NOT EXISTS public.reputation_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  
  -- Core Metrics
  total_matches_completed INTEGER NOT NULL DEFAULT 0,
  total_matches_failed INTEGER NOT NULL DEFAULT 0,
  total_signals_created INTEGER NOT NULL DEFAULT 0,
  total_options_selected INTEGER NOT NULL DEFAULT 0,
  
  -- Response Time Metrics (in seconds)
  avg_response_time_seconds NUMERIC,
  median_response_time_seconds NUMERIC,
  
  -- Transaction History
  first_match_at TIMESTAMP WITH TIME ZONE,
  last_match_at TIMESTAMP WITH TIME ZONE,
  
  -- Calculated Scores (0-100)
  reliability_score NUMERIC DEFAULT 0,
  responsiveness_score NUMERIC DEFAULT 0,
  completion_score NUMERIC DEFAULT 0,
  overall_score NUMERIC DEFAULT 0,
  
  -- Reputation Level
  reputation_level TEXT DEFAULT 'new', -- 'new', 'bronze', 'silver', 'gold', 'platinum'
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.reputation_scores ENABLE ROW LEVEL SECURITY;

-- Policies - reputation scores are publicly readable but only system can update
CREATE POLICY "Anyone authenticated can view reputation scores"
  ON public.reputation_scores
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage reputation scores"
  ON public.reputation_scores
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- Match analytics aggregation table
CREATE TABLE IF NOT EXISTS public.match_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Time dimension
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  period_type TEXT NOT NULL, -- 'hourly', 'daily', 'weekly', 'monthly'
  
  -- Geographic dimension
  source_country TEXT,
  source_region TEXT,
  target_country TEXT,
  target_region TEXT,
  is_cross_border BOOLEAN DEFAULT false,
  
  -- Product dimension
  product_category TEXT,
  signal_type TEXT, -- 'buyer', 'seller'
  
  -- Metrics
  total_signals INTEGER DEFAULT 0,
  total_matches INTEGER DEFAULT 0,
  total_options INTEGER DEFAULT 0,
  avg_options_per_signal NUMERIC,
  match_rate NUMERIC,
  avg_match_time_hours NUMERIC,
  
  -- Provider performance
  data_source_id UUID REFERENCES public.data_sources(id) ON DELETE CASCADE,
  provider_success_rate NUMERIC,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.match_analytics ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins can view all analytics"
  ON public.match_analytics
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view analytics for their data"
  ON public.match_analytics
  FOR SELECT
  USING (
    data_source_id IN (
      SELECT id FROM public.data_sources 
      WHERE org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Service role can manage analytics"
  ON public.match_analytics
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- Indexes for performance
CREATE INDEX idx_registrations_status ON public.data_source_registrations(status);
CREATE INDEX idx_registrations_org ON public.data_source_registrations(org_id);
CREATE INDEX idx_reputation_org ON public.reputation_scores(org_id);
CREATE INDEX idx_reputation_level ON public.reputation_scores(reputation_level);
CREATE INDEX idx_analytics_period ON public.match_analytics(period_start, period_end);
CREATE INDEX idx_analytics_geo ON public.match_analytics(source_country, target_country);
CREATE INDEX idx_analytics_product ON public.match_analytics(product_category);

-- Trigger for updated_at
CREATE TRIGGER update_registrations_updated_at
  BEFORE UPDATE ON public.data_source_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_reputation_updated_at
  BEFORE UPDATE ON public.reputation_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();