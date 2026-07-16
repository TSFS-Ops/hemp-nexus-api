-- =============================================================
-- FIX 1: Remove poi_engagements from Realtime publication
-- Any authenticated user could subscribe to changes on this table
-- and see engagement data for ALL organisations — a cross-org leak.
-- =============================================================
ALTER PUBLICATION supabase_realtime DROP TABLE public.poi_engagements;

-- =============================================================
-- FIX 2: Add RLS policy to storage_deletion_queue (RLS enabled, no policies)
-- This is an internal-only queue; deny all client access.
-- =============================================================
CREATE POLICY "No client access to storage deletion queue"
ON public.storage_deletion_queue
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- =============================================================
-- FIX 3: Harden match-documents INSERT policy
-- Current policy only checks folder path matches user's org.
-- Add cross-reference to ensure the match actually belongs to the org.
-- =============================================================
DROP POLICY IF EXISTS "Users can upload match documents to their org" ON storage.objects;

CREATE POLICY "Users can upload match documents to their org"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
bucket_id = 'match-documents'
AND (storage.foldername(name))[1] IN (
SELECT p.org_id::text FROM profiles p WHERE p.id = auth.uid()
)
AND (
-- The second path segment must be a match_id that belongs to the uploader's org
EXISTS (
SELECT 1 FROM matches m
WHERE m.id::text = (storage.foldername(name))[2]
AND (
m.org_id IN (SELECT p2.org_id FROM profiles p2 WHERE p2.id = auth.uid())
OR m.buyer_org_id IN (SELECT p2.org_id FROM profiles p2 WHERE p2.id = auth.uid())
OR m.seller_org_id IN (SELECT p2.org_id FROM profiles p2 WHERE p2.id = auth.uid())
)
)
-- Allow admin override
OR has_role(auth.uid(), 'platform_admin'::app_role)
)
);

-- =============================================================
-- FIX 4: Fix webhook-retry cron job
-- Failing because current_setting('app.settings.supabase_url') is not set.
-- Replace with hardcoded project URL (same pattern as all other working jobs).
-- =============================================================
-- Guard: clean disposable-DB replay may not have this job registered yet if the
-- historical cron.schedule migration that created it was itself guarded/skipped.
DO $guard_webhook_retry$
BEGIN
IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webhook-retry-job') THEN
PERFORM cron.unschedule('webhook-retry-job');
END IF;
END
$guard_webhook_retry$;

SELECT cron.schedule(
'webhook-retry-job',
'*/5 * * * *',
$$
SELECT
net.http_post(
url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/webhook-retry',
headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVncmZ5aHdsb25sbWxjbWNwY2RtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxMDU5MjYsImV4cCI6MjA3NTY4MTkyNn0.gpN9fLbxLSrpDo5zAOEhsHnRurkNIPql9MtkRdCTImw"}'::jsonb,
body := '{}'::jsonb
) as request_id;
$$
);
