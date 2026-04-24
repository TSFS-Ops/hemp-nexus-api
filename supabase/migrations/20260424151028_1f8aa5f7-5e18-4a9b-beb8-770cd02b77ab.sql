-- Explicit invoker-rights so RLS on poi_engagements + engagement_outreach_logs
-- governs visibility, not the view owner. Resolves linter 0010.
ALTER VIEW public.engagement_email_sent_but_status_stuck SET (security_invoker = true);