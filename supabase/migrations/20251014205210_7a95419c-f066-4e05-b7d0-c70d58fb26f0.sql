-- Add normalized company name column for faster fuzzy matching
ALTER TABLE public.sahpra_licenses
ADD COLUMN company_name_norm text;

-- Create index on normalized name
CREATE INDEX idx_sahpra_licenses_company_name_norm ON public.sahpra_licenses(company_name_norm);

-- Add licence number to organizations for quick reference
ALTER TABLE public.organizations
ADD COLUMN sahpra_licence_no text;