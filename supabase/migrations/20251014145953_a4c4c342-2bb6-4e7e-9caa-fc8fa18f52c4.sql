-- Add SAHPRA verification fields to organizations table
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS sahpra_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS sahpra_verification_data JSONB,
ADD COLUMN IF NOT EXISTS sahpra_verified_at TIMESTAMP WITH TIME ZONE;

-- Create a table to cache SAHPRA CSV data
CREATE TABLE IF NOT EXISTS public.sahpra_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  licence_no TEXT NOT NULL,
  licence_type TEXT,
  responsible_pharmacist TEXT,
  province TEXT,
  date_issued DATE,
  expiry_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(licence_no)
);

-- Enable RLS on sahpra_licenses
ALTER TABLE public.sahpra_licenses ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read SAHPRA data
CREATE POLICY "Authenticated users can view SAHPRA licenses"
ON public.sahpra_licenses
FOR SELECT
TO authenticated
USING (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sahpra_company_name ON public.sahpra_licenses(LOWER(company_name));
CREATE INDEX IF NOT EXISTS idx_sahpra_licence_no ON public.sahpra_licenses(licence_no);
CREATE INDEX IF NOT EXISTS idx_sahpra_expiry ON public.sahpra_licenses(expiry_date);

-- Add trigger for updated_at
CREATE TRIGGER update_sahpra_licenses_updated_at
BEFORE UPDATE ON public.sahpra_licenses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();