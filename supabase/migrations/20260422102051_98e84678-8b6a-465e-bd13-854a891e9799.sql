-- Seed outreach SLA configuration if not present.
-- Stores the threshold (hours) before a pending/awaiting-outreach engagement
-- is considered overdue, and the digest recipient for SLA reminder emails.
INSERT INTO public.admin_settings (key, value)
VALUES (
  'outreach_sla',
  jsonb_build_object(
    'threshold_hours', 48,
    'reminder_email', 'support@izenzo.co.za',
    'digest_enabled', true
  )
)
ON CONFLICT (key) DO NOTHING;

-- Index to speed up SLA scans (filter by status + created_at).
CREATE INDEX IF NOT EXISTS idx_poi_engagements_sla_scan
  ON public.poi_engagements (engagement_status, created_at)
  WHERE engagement_status IN ('pending', 'notification_sent');

-- Track when an SLA reminder was last dispatched per engagement so the
-- monitor doesn't re-spam the same overdue items every cron tick.
ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS sla_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_reminder_count INTEGER NOT NULL DEFAULT 0;