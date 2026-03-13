
-- Create a system organization for internal audit entries
-- This ensures system-level audit logs don't create orphan rows
INSERT INTO public.organizations (id, name, status)
VALUES ('00000000-0000-0000-0000-000000000000', 'SYSTEM', 'active')
ON CONFLICT (id) DO NOTHING;

-- Add unique constraint on deal_terms(match_id, version) to prevent
-- duplicate version numbers during concurrent edits
ALTER TABLE public.deal_terms
ADD CONSTRAINT deal_terms_match_version_unique UNIQUE (match_id, version);
