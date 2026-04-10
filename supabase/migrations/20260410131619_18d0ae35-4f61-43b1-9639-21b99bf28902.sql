
-- Discovery search quality metrics for baseline measurement (SOW 12% uplift target)
CREATE TABLE public.discovery_search_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  request_id TEXT NOT NULL,
  raw_query TEXT NOT NULL,
  parsed_product TEXT,
  parsed_location TEXT,
  parsed_role TEXT,
  search_method TEXT NOT NULL DEFAULT 'fts',
  fts_result_count INTEGER NOT NULL DEFAULT 0,
  ilike_fallback_used BOOLEAN NOT NULL DEFAULT false,
  ilike_result_count INTEGER NOT NULL DEFAULT 0,
  order_book_result_count INTEGER NOT NULL DEFAULT 0,
  total_results_returned INTEGER NOT NULL DEFAULT 0,
  response_time_ms INTEGER,
  parse_token_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for time-range baseline queries
CREATE INDEX idx_discovery_search_logs_created ON public.discovery_search_logs (created_at DESC);
CREATE INDEX idx_discovery_search_logs_org ON public.discovery_search_logs (org_id);

-- RLS: org members see own logs, admins see all
ALTER TABLE public.discovery_search_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view own search logs"
  ON public.discovery_search_logs FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  );

-- Only service_role inserts (edge function)
CREATE POLICY "Service role inserts search logs"
  ON public.discovery_search_logs FOR INSERT TO service_role
  WITH CHECK (true);

-- Baseline reporting view (security_invoker so RLS applies)
CREATE VIEW public.discovery_baseline_metrics
  WITH (security_invoker = true) AS
SELECT
  date_trunc('day', created_at) AS day,
  count(*) AS total_searches,
  round(avg(total_results_returned), 1) AS avg_results,
  round(avg(parse_token_count), 1) AS avg_parse_tokens,
  round(100.0 * count(*) FILTER (WHERE fts_result_count > 0) / NULLIF(count(*), 0), 1) AS fts_hit_rate_pct,
  round(100.0 * count(*) FILTER (WHERE ilike_fallback_used) / NULLIF(count(*), 0), 1) AS fallback_rate_pct,
  round(avg(response_time_ms), 0) AS avg_response_ms,
  round(avg(fts_result_count), 1) AS avg_fts_results,
  round(avg(order_book_result_count), 1) AS avg_order_book_results
FROM public.discovery_search_logs
GROUP BY date_trunc('day', created_at)
ORDER BY day DESC;
