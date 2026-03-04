
-- 1. Add missing BRD §7 columns to collapse_ledger
ALTER TABLE public.collapse_ledger
  ADD COLUMN IF NOT EXISTS payload_ciphertext text,
  ADD COLUMN IF NOT EXISTS timestamp_source_metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS annulment_reference uuid;

-- 2. Add api_admin and billing_admin to app_role enum (BRD §10)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'api_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'billing_admin';
