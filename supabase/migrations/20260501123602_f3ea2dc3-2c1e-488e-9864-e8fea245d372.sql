-- Dual-currency billing support: USD display, ZAR Paystack settlement.
-- Stored as rows in the existing admin_settings key/value table.

INSERT INTO public.admin_settings (key, value, updated_at)
VALUES (
  'pricing_currency_mode',
  jsonb_build_object(
    'mode', 'usd_display_zar_charge',
    'note', 'USD is the commercial reference price; Paystack charges in ZAR converted at checkout time. See James Davies email 2026-04-30.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.admin_settings (key, value, updated_at)
VALUES (
  'fx_rate_usd_zar',
  jsonb_build_object(
    'rate', NULL,
    'basis', NULL,
    'fetched_at', NULL,
    'source', 'exchangerate.host',
    'note', 'Last successful USD→ZAR rate fetched by token-purchase. Used as a fallback when the live FX API is unreachable. Updated by edge function, never manually.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();