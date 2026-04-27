
ALTER TABLE public.match_counterparty_intel
  ADD COLUMN IF NOT EXISTS auto_summary text,
  ADD COLUMN IF NOT EXISTS auto_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_status text NOT NULL DEFAULT 'pending'
    CHECK (auto_status IN ('pending','ready','failed','unavailable'));

COMMENT ON COLUMN public.match_counterparty_intel.auto_summary IS
  'System-generated 1–3 sentence public-source summary of the named counterparty. Daniel 2026-04-27: light public-source check must be system-assisted, not user-assembled.';
COMMENT ON COLUMN public.match_counterparty_intel.auto_sources IS
  'Array of {label, url, kind} the auto-intel function inspected (e.g. guessed website, LinkedIn, news mention).';
COMMENT ON COLUMN public.match_counterparty_intel.auto_status IS
  'pending → no run yet; ready → auto-intel complete; failed → run errored; unavailable → AI gateway off / no signal.';
