
-- Add governance roles to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'api_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'billing_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'compliance_analyst';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'legal_reviewer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'director';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'org_member';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'platform_admin';
