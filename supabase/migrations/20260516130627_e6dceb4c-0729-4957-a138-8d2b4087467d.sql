
CREATE TABLE IF NOT EXISTS public.ai_provider_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'lovable_ai_gateway',
  cooldown_until timestamptz,
  last_status text,
  last_status_code int,
  last_error text,
  retry_after_seconds int,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_ai_provider_state_cooldown
  ON public.ai_provider_state (org_id, provider, cooldown_until);
ALTER TABLE public.ai_provider_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_provider_state admin select"
  ON public.ai_provider_state FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ai_call_meter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  call_type text NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, call_type, day)
);
CREATE INDEX IF NOT EXISTS idx_ai_call_meter_day ON public.ai_call_meter (day);
ALTER TABLE public.ai_call_meter ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_call_meter admin select"
  ON public.ai_call_meter FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.ai_meter_check_and_increment(
  p_org_id uuid, p_call_type text, p_daily_cap int
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_count int;
BEGIN
  INSERT INTO public.ai_call_meter (org_id, call_type, day, count, updated_at)
  VALUES (p_org_id, p_call_type, v_today, 1, now())
  ON CONFLICT (org_id, call_type, day)
  DO UPDATE SET
    count = CASE WHEN public.ai_call_meter.count >= p_daily_cap THEN public.ai_call_meter.count ELSE public.ai_call_meter.count + 1 END,
    updated_at = now()
  RETURNING count INTO v_count;
  IF v_count > p_daily_cap THEN RETURN -1; END IF;
  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION public.ai_meter_check_and_increment(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_meter_check_and_increment(uuid, text, int) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_provider_in_cooldown(
  p_org_id uuid, p_provider text DEFAULT 'lovable_ai_gateway'
) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cooldown_until FROM public.ai_provider_state
  WHERE org_id = p_org_id AND provider = p_provider
    AND cooldown_until IS NOT NULL AND cooldown_until > now()
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.ai_provider_in_cooldown(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_provider_in_cooldown(uuid, text) TO service_role;
