-- Index for stale-unilateral queries (lifecycle-scheduler + admin panel)
CREATE INDEX IF NOT EXISTS idx_matches_unilateral_created
  ON public.matches (match_type, created_at)
  WHERE match_type = 'unilateral';

-- Index for audit-log rate-limit count queries (web-search, etc.)
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_action_time
  ON public.audit_logs (org_id, action, created_at DESC);

-- Index for behavioral score computation
CREATE INDEX IF NOT EXISTS idx_behavioral_signals_org_time
  ON public.behavioral_signals (org_id, created_at DESC);