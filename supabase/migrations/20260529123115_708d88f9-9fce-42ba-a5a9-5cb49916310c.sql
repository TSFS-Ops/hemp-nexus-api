-- Restrict admin_settings pricing key reads to platform_admin only
DROP POLICY IF EXISTS "Pricing config readable by authenticated" ON public.admin_settings;

-- Restrict platform-wide aggregate analytics to admins (was open to all authenticated)
DROP POLICY IF EXISTS "Users can view platform-wide aggregate analytics" ON public.match_analytics;