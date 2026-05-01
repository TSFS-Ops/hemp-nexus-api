-- Temporary billing-availability flag (USD settlement pending on Paystack).
-- Stored in admin_settings; surfaced to all authenticated users via a
-- SECURITY DEFINER RPC so we don't need to widen RLS on admin_settings.

INSERT INTO public.admin_settings (key, value)
VALUES (
  'billing_availability',
  jsonb_build_object(
    'enabled', false,
    'reason', 'usd_settlement_pending',
    'message', 'Credit purchases are temporarily unavailable while USD settlement is being enabled. Your existing balance is unaffected and all platform features that do not require new credits remain fully operational.'
  )
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_billing_availability()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.admin_settings WHERE key = 'billing_availability'),
    jsonb_build_object('enabled', true, 'reason', null, 'message', null)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_billing_availability() TO anon, authenticated;