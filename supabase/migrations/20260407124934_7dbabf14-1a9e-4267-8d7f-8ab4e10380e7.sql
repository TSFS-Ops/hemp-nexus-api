
-- Add org_id and user_id to behavioral_signals
ALTER TABLE public.behavioral_signals
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS idx_behavioral_signals_org_id ON public.behavioral_signals(org_id);

-- Function to compute behavioral engagement score per org (0-100)
CREATE OR REPLACE FUNCTION public.compute_behavioral_score(p_org_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total integer;
  v_views integer;
  v_skips integer;
  v_maybe integer;
  v_score numeric;
  v_band text;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE action_type = 'view'),
    count(*) FILTER (WHERE action_type = 'skip'),
    count(*) FILTER (WHERE action_type = 'maybe_later')
  INTO v_total, v_views, v_skips, v_maybe
  FROM behavioral_signals
  WHERE org_id = p_org_id
    AND created_at >= now() - (p_days || ' days')::interval;

  -- Score formula: views weigh positively, skips neutral, maybe_later shows engagement
  -- Base: log scale of total interactions + view ratio bonus
  IF v_total = 0 THEN
    v_score := 0;
  ELSE
    v_score := LEAST(100, (
      -- Activity volume (log scale, max 40 pts)
      LEAST(40, ln(v_total + 1) * 10) +
      -- View engagement ratio (max 30 pts)  
      (v_views::numeric / v_total) * 30 +
      -- "Maybe later" shows consideration (max 20 pts)
      LEAST(20, v_maybe * 5) +
      -- Recency bonus: any activity in last 3 days (10 pts)
      CASE WHEN EXISTS (
        SELECT 1 FROM behavioral_signals
        WHERE org_id = p_org_id AND created_at >= now() - interval '3 days'
      ) THEN 10 ELSE 0 END
    ));
  END IF;

  v_band := CASE
    WHEN v_score >= 70 THEN 'high'
    WHEN v_score >= 30 THEN 'medium'
    WHEN v_score > 0 THEN 'low'
    ELSE 'none'
  END;

  RETURN jsonb_build_object(
    'score', round(v_score, 1),
    'band', v_band,
    'total_signals', v_total,
    'views', v_views,
    'skips', v_skips,
    'maybe_later', v_maybe,
    'period_days', p_days
  );
END;
$$;

-- Revoke from anon, grant to authenticated
REVOKE EXECUTE ON FUNCTION public.compute_behavioral_score(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.compute_behavioral_score(uuid, integer) TO authenticated;
