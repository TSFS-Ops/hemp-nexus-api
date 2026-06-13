
-- ── staging_password_tokens: convert deny to a hard RESTRICTIVE floor ──
DROP POLICY IF EXISTS "Deny all client access to staging_password_tokens" ON public.staging_password_tokens;
CREATE POLICY "staging_password_tokens deny anon and authenticated"
  ON public.staging_password_tokens
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ── auth_rate_limits: RESTRICTIVE deny for anon and authenticated ──
DROP POLICY IF EXISTS "auth_rate_limits deny anon and authenticated" ON public.auth_rate_limits;
CREATE POLICY "auth_rate_limits deny anon and authenticated"
  ON public.auth_rate_limits
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ── email_unsubscribe_tokens: RESTRICTIVE deny for anon and authenticated ──
DROP POLICY IF EXISTS "email_unsubscribe_tokens deny anon and authenticated" ON public.email_unsubscribe_tokens;
CREATE POLICY "email_unsubscribe_tokens deny anon and authenticated"
  ON public.email_unsubscribe_tokens
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ── webhook_replay_guard: explicit service_role policy + deny for client roles ──
DROP POLICY IF EXISTS "webhook_replay_guard service role only" ON public.webhook_replay_guard;
CREATE POLICY "webhook_replay_guard service role only"
  ON public.webhook_replay_guard
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "webhook_replay_guard deny anon and authenticated" ON public.webhook_replay_guard;
CREATE POLICY "webhook_replay_guard deny anon and authenticated"
  ON public.webhook_replay_guard
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ── brd_constraints: restrict SELECT to platform_admin only ──
DROP POLICY IF EXISTS "Authenticated can view BRD constraints" ON public.brd_constraints;
CREATE POLICY "Platform admins can view BRD constraints"
  ON public.brd_constraints
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
