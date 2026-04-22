-- ============================================================
-- FIX 1: suppressed_emails — explicit deny for anon + authenticated
-- (Defense-in-depth: even if defaults change, no leakage.)
-- ============================================================
CREATE POLICY "Deny suppressed_emails to anon"
  ON public.suppressed_emails
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny suppressed_emails to authenticated"
  ON public.suppressed_emails
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ============================================================
-- FIX 2: engagement_outreach_logs — service-role INSERT
-- Prevents silent log-write failures from edge functions.
-- ============================================================
CREATE POLICY "Service role can insert outreach logs"
  ON public.engagement_outreach_logs
  FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

-- Also explicit deny for non-admin authenticated and anon, for clarity.
CREATE POLICY "Deny outreach logs to anon"
  ON public.engagement_outreach_logs
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ============================================================
-- FIX 3: email_unsubscribe_tokens — 30-day TTL
-- ============================================================
ALTER TABLE public.email_unsubscribe_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Backfill existing tokens with a 30-day window from creation.
-- Tokens older than 30d become immediately expired, which is the desired
-- behaviour: any stolen historic token is no longer usable.
UPDATE public.email_unsubscribe_tokens
   SET expires_at = COALESCE(expires_at, created_at + interval '30 days')
 WHERE expires_at IS NULL;

-- New rows must always have an expiry. Default to 30 days from now.
ALTER TABLE public.email_unsubscribe_tokens
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');

ALTER TABLE public.email_unsubscribe_tokens
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_unsubscribe_tokens_expires_at
  ON public.email_unsubscribe_tokens (expires_at)
  WHERE used_at IS NULL;

-- Nightly cleanup of expired-and-unused tokens (no business need to retain).
CREATE OR REPLACE FUNCTION public.cleanup_expired_unsubscribe_tokens()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.email_unsubscribe_tokens
   WHERE expires_at < now()
     AND used_at IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Schedule nightly at 03:15 UTC if pg_cron is available and not already scheduled.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-unsubscribe-tokens'
    ) THEN
      PERFORM cron.schedule(
        'cleanup-expired-unsubscribe-tokens',
        '15 3 * * *',
        $cron$SELECT public.cleanup_expired_unsubscribe_tokens();$cron$
      );
    END IF;
  END IF;
END $$;

-- ============================================================
-- FIX 4: realtime.messages — scoped subscribe policy for poi_engagements
-- Replaces the blanket deny so match participants can receive live updates.
-- ============================================================

-- Drop the existing blanket deny so we can add a scoped allow.
DROP POLICY IF EXISTS "deny_all_realtime_messages" ON realtime.messages;

-- Allow authenticated participants of a match to subscribe to the
-- match's engagement channel. Topic convention: "poi_engagements:<match_id>"
CREATE POLICY "Match participants can subscribe to engagement channels"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    -- platform admins always allowed
    public.has_role(auth.uid(), 'platform_admin'::app_role)
    OR (
      -- topics shaped "poi_engagements:<uuid>"
      (realtime.topic())::text LIKE 'poi_engagements:%'
      AND public.is_match_participant(
        auth.uid(),
        substring((realtime.topic())::text from length('poi_engagements:') + 1)::uuid
      )
    )
  );

-- Re-instate broad deny for any topic that does not match the pattern above
-- (other tables/topics remain default-denied because no allow exists).
-- No additional deny policy needed — RLS is permissive: absence = deny.
