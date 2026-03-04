-- Add provider tracking to screening_results
ALTER TABLE public.screening_results 
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'dilisense',
  ADD COLUMN IF NOT EXISTS provider_config jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS response_hash text,
  ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES public.entities(id);

-- Add NTP drift columns to collapse_ledger  
ALTER TABLE public.collapse_ledger
  ADD COLUMN IF NOT EXISTS ntp_source text DEFAULT 'database-server-utc',
  ADD COLUMN IF NOT EXISTS ntp_drift_ms integer;

-- Create data retention tracking table
CREATE TABLE IF NOT EXISTS public.retention_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  record_created_at timestamptz NOT NULL,
  retention_expires_at timestamptz NOT NULL,
  flag_type text NOT NULL DEFAULT 'approaching_expiry',
  flagged_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE(table_name, record_id)
);

ALTER TABLE public.retention_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on retention_flags"
  ON public.retention_flags FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins can view retention flags"
  ON public.retention_flags FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));