CREATE OR REPLACE VIEW public.notification_skipped_24h_rollup
WITH (security_invoker = true) AS
SELECT
  (metadata->>'reason')           AS reason,
  (metadata->>'source_function')  AS source_function,
  COUNT(*)                        AS skip_count,
  MIN(created_at)                 AS first_seen,
  MAX(created_at)                 AS last_seen
FROM public.audit_logs
WHERE action = 'notification_skipped'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY skip_count DESC;

COMMENT ON VIEW public.notification_skipped_24h_rollup IS
  'D-07: 24h rollup of notification_skipped audit rows by structured reason and source function. security_invoker=true so RLS on audit_logs is enforced.';