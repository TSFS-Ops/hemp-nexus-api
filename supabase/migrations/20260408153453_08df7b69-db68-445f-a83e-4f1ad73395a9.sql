-- Task 1: Add missing org_id indexes for RLS performance

-- profiles.org_id — critical: joined by nearly every RLS policy
CREATE INDEX IF NOT EXISTS idx_profiles_org_id ON public.profiles (org_id);

-- disputes — uses raised_by_org_id as the org reference
CREATE INDEX IF NOT EXISTS idx_disputes_raised_by_org_id ON public.disputes (raised_by_org_id);

-- deal_terms.org_id
CREATE INDEX IF NOT EXISTS idx_deal_terms_org_id ON public.deal_terms (org_id);

-- notifications.org_id
CREATE INDEX IF NOT EXISTS idx_notifications_org_id ON public.notifications (org_id);

-- webhook_endpoints.org_id
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org_id ON public.webhook_endpoints (org_id);

-- poi_events.org_id and poi_events.match_id
CREATE INDEX IF NOT EXISTS idx_poi_events_org_id ON public.poi_events (org_id);
CREATE INDEX IF NOT EXISTS idx_poi_events_match_id ON public.poi_events (match_id);