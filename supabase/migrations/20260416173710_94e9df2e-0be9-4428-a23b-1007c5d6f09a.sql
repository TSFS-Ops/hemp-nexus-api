CREATE OR REPLACE FUNCTION public.reconcile_token_balances()
RETURNS TABLE(org_id uuid, recorded_balance integer, computed_balance integer, total_burned bigint, total_credited bigint, discrepancy integer, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH ledger_sums AS (
    SELECT
      tl.org_id,
      COALESCE(SUM(tl.tokens_burned) FILTER (
        WHERE tl.outcome = 'allowed'
          AND tl.action_type NOT IN ('credit', 'refund', 'system_adjustment')
      ), 0)::bigint AS burned,
      COALESCE(SUM(tl.tokens_burned) FILTER (
        WHERE tl.action_type IN ('credit', 'refund')
      ), 0)::bigint AS credited
    FROM token_ledger tl
    GROUP BY tl.org_id
  )
  SELECT
    tb.org_id,
    tb.balance AS recorded_balance,
    (1000 - COALESCE(ls.burned, 0) + COALESCE(ls.credited, 0))::integer AS computed_balance,
    COALESCE(ls.burned, 0) AS total_burned,
    COALESCE(ls.credited, 0) AS total_credited,
    (tb.balance - (1000 - COALESCE(ls.burned, 0) + COALESCE(ls.credited, 0)))::integer AS discrepancy,
    CASE
      WHEN tb.balance = (1000 - COALESCE(ls.burned, 0) + COALESCE(ls.credited, 0))::integer THEN 'ok'
      ELSE 'MISMATCH'
    END AS status
  FROM token_balances tb
  LEFT JOIN ledger_sums ls ON ls.org_id = tb.org_id
  ORDER BY ABS(tb.balance - (1000 - COALESCE(ls.burned, 0) + COALESCE(ls.credited, 0))::integer) DESC;
END;
$$;