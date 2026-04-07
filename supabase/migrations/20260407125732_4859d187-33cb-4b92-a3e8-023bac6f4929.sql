
CREATE OR REPLACE FUNCTION public.compute_all_behavioral_kyc_scores(p_days integer DEFAULT 30)
RETURNS TABLE(
  org_id uuid,
  org_name text,
  behavioral_score numeric,
  behavioral_band text,
  total_signals bigint,
  views bigint,
  skips bigint,
  maybe_later bigint,
  kyc_status text,
  kyc_completeness numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH signal_agg AS (
    SELECT
      bs.org_id,
      count(*) AS total,
      count(*) FILTER (WHERE bs.action_type = 'view') AS v,
      count(*) FILTER (WHERE bs.action_type = 'skip') AS s,
      count(*) FILTER (WHERE bs.action_type = 'maybe_later') AS ml,
      bool_or(bs.created_at >= now() - interval '3 days') AS recent
    FROM behavioral_signals bs
    WHERE bs.created_at >= now() - (p_days || ' days')::interval
      AND bs.org_id IS NOT NULL
    GROUP BY bs.org_id
  )
  SELECT
    o.id AS org_id,
    o.name AS org_name,
    CASE WHEN COALESCE(sa.total, 0) = 0 THEN 0::numeric
    ELSE LEAST(100, round((
      LEAST(40, ln(sa.total + 1) * 10) +
      (sa.v::numeric / sa.total) * 30 +
      LEAST(20, sa.ml * 5) +
      CASE WHEN sa.recent THEN 10 ELSE 0 END
    )::numeric, 1))
    END AS behavioral_score,
    CASE
      WHEN COALESCE(sa.total, 0) = 0 THEN 'none'
      WHEN LEAST(100, (ln(COALESCE(sa.total,1) + 1) * 10 + (COALESCE(sa.v,0)::numeric / GREATEST(sa.total,1)) * 30 + LEAST(20, COALESCE(sa.ml,0) * 5) + CASE WHEN COALESCE(sa.recent, false) THEN 10 ELSE 0 END)) >= 70 THEN 'high'
      WHEN LEAST(100, (ln(COALESCE(sa.total,1) + 1) * 10 + (COALESCE(sa.v,0)::numeric / GREATEST(sa.total,1)) * 30 + LEAST(20, COALESCE(sa.ml,0) * 5) + CASE WHEN COALESCE(sa.recent, false) THEN 10 ELSE 0 END)) >= 30 THEN 'medium'
      ELSE 'low'
    END AS behavioral_band,
    COALESCE(sa.total, 0) AS total_signals,
    COALESCE(sa.v, 0) AS views,
    COALESCE(sa.s, 0) AS skips,
    COALESCE(sa.ml, 0) AS maybe_later,
    COALESCE(ks.status, 'not_started') AS kyc_status,
    COALESCE(ks.completeness_percentage, 0) AS kyc_completeness
  FROM organizations o
  LEFT JOIN signal_agg sa ON sa.org_id = o.id
  LEFT JOIN kyc_status ks ON ks.org_id = o.id
  ORDER BY COALESCE(sa.total, 0) DESC, o.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_all_behavioral_kyc_scores(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.compute_all_behavioral_kyc_scores(integer) TO authenticated;
