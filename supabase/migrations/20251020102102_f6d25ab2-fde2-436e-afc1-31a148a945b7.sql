-- Create performance tracking table
CREATE TABLE public.data_source_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid REFERENCES public.data_sources(id) ON DELETE CASCADE NOT NULL,
  signal_id uuid REFERENCES public.signals(id) ON DELETE CASCADE NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  
  -- Performance metrics
  options_returned int DEFAULT 0 NOT NULL,
  options_selected int DEFAULT 0 NOT NULL,
  response_time_ms int NOT NULL,
  search_success boolean DEFAULT false NOT NULL,
  
  -- Context for learning
  product_category text,
  location text,
  signal_type text,
  
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Add index for performance queries
CREATE INDEX idx_data_source_performance_lookup 
  ON public.data_source_performance(data_source_id, org_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.data_source_performance ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their org's performance data"
  ON public.data_source_performance 
  FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Service role can insert performance data"
  ON public.data_source_performance 
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can manage all performance data"
  ON public.data_source_performance
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));