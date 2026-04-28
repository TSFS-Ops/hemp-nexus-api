INSERT INTO public.admin_settings (key, value)
VALUES (
  'operator_verification_clip_on_pricing',
  jsonb_build_object(
    'currency', 'ZAR',
    'cost_per_request_zar', 250,
    'margin_pct', 80,
    'permanent_integration_monthly_zar', 2500,
    'permanent_integration_margin_pct', 80,
    'set_by', 'director_directive_2026_04_28',
    'effective_from', now()
  )
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.operator_verification_requests
  ADD COLUMN IF NOT EXISTS priced_cost_zar numeric(10,2),
  ADD COLUMN IF NOT EXISTS priced_margin_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS priced_total_zar numeric(10,2),
  ADD COLUMN IF NOT EXISTS priced_currency text DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS pricing_mode text;

DROP POLICY IF EXISTS "Pricing config readable by authenticated" ON public.admin_settings;
CREATE POLICY "Pricing config readable by authenticated"
  ON public.admin_settings
  FOR SELECT
  TO authenticated
  USING (key = 'operator_verification_clip_on_pricing');