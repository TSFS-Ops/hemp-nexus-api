-- Remove SAHPRA-related functionality

-- Drop sahpra_licenses table
DROP TABLE IF EXISTS public.sahpra_licenses CASCADE;

-- Remove SAHPRA fields from organizations table
ALTER TABLE public.organizations 
  DROP COLUMN IF EXISTS sahpra_licence_no,
  DROP COLUMN IF EXISTS sahpra_verification_data,
  DROP COLUMN IF EXISTS sahpra_verified,
  DROP COLUMN IF EXISTS sahpra_verified_at;