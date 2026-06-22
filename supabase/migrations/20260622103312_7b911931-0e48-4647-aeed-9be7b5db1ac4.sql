
ALTER TABLE public.registry_api_usage_events
  ADD COLUMN IF NOT EXISTS artefact_code text,
  ADD COLUMN IF NOT EXISTS credits_burned numeric,
  ADD COLUMN IF NOT EXISTS remaining_balance numeric;

COMMENT ON COLUMN public.registry_api_usage_events.artefact_code IS
  'P-4 Point 4: artefact code from registry-api-artefact-pricing SSOT; null on non-chargeable calls. Label is derived at display time from the pricing SSOT.';
COMMENT ON COLUMN public.registry_api_usage_events.credits_burned IS
  'P-4 Point 4: wallet credits actually burned for this call. 0 or null on skipped / non-chargeable calls.';
COMMENT ON COLUMN public.registry_api_usage_events.remaining_balance IS
  'P-4 Point 4: wallet balance immediately after this call''s burn (null if no burn).';
