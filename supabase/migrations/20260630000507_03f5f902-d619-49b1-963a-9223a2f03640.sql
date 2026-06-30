UPDATE public.admin_settings
SET value = jsonb_build_object(
  'enabled', true,
  'reason', 'enabled',
  'message', null
),
updated_at = now()
WHERE key = 'billing_availability';