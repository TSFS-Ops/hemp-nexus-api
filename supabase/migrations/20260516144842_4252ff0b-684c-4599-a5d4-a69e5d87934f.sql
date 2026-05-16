-- Batch I: compliance gate consistency hardening
ALTER TABLE public.screening_results
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.admin_risk_items
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS admin_risk_items_dedup_key_uniq
  ON public.admin_risk_items (dedup_key)
  WHERE dedup_key IS NOT NULL;

ALTER TABLE public.dd_approval_requests
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS dd_approval_requests_dedup_key_uniq
  ON public.dd_approval_requests (dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Provider retry cooldown table (Fix 6)
CREATE TABLE IF NOT EXISTS public.provider_retry_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL UNIQUE,
  gate text NOT NULL,
  provider text NOT NULL,
  entity_id uuid,
  org_id uuid,
  failure_count integer NOT NULL DEFAULT 0,
  last_failure_at timestamptz NOT NULL DEFAULT now(),
  cooldown_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_retry_state_cooldown
  ON public.provider_retry_state (cooldown_until)
  WHERE cooldown_until IS NOT NULL;

ALTER TABLE public.provider_retry_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages provider retry state" ON public.provider_retry_state;
CREATE POLICY "Service role manages provider retry state"
  ON public.provider_retry_state
  FOR ALL
  USING (((auth.jwt() ->> 'role'::text) = 'service_role'::text))
  WITH CHECK (((auth.jwt() ->> 'role'::text) = 'service_role'::text));

DROP POLICY IF EXISTS "Admins view provider retry state" ON public.provider_retry_state;
CREATE POLICY "Admins view provider retry state"
  ON public.provider_retry_state
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- RPC: bump retry counter, set cooldown when threshold crossed
CREATE OR REPLACE FUNCTION public.bump_provider_retry(
  _scope_key text,
  _gate text,
  _provider text,
  _entity_id uuid,
  _org_id uuid,
  _threshold int DEFAULT 3,
  _cooldown_seconds int DEFAULT 86400
)
RETURNS public.provider_retry_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.provider_retry_state;
  _now timestamptz := now();
BEGIN
  INSERT INTO public.provider_retry_state AS p
    (scope_key, gate, provider, entity_id, org_id, failure_count, last_failure_at)
  VALUES (_scope_key, _gate, _provider, _entity_id, _org_id, 1, _now)
  ON CONFLICT (scope_key) DO UPDATE
    SET failure_count = p.failure_count + 1,
        last_failure_at = _now,
        gate = EXCLUDED.gate,
        provider = EXCLUDED.provider,
        entity_id = COALESCE(EXCLUDED.entity_id, p.entity_id),
        org_id = COALESCE(EXCLUDED.org_id, p.org_id),
        updated_at = _now,
        cooldown_until = CASE
          WHEN (p.failure_count + 1) >= _threshold THEN _now + make_interval(secs => _cooldown_seconds)
          ELSE p.cooldown_until
        END
  RETURNING * INTO _row;

  RETURN _row;
END
$$;

REVOKE ALL ON FUNCTION public.bump_provider_retry(text, text, text, uuid, uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_provider_retry(text, text, text, uuid, uuid, int, int) TO service_role;
