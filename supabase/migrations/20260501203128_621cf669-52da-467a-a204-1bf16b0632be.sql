-- Stage B: Revoke EXECUTE from PUBLIC/anon/authenticated for service-role/internal-only
-- SECURITY DEFINER functions. Each function listed has been pre-flight verified to have
-- zero callers from frontend/anon-client code. service_role and postgres retain access.
-- No business-facing RPCs are touched.

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    -- Email queue plumbing
    'enqueue_email(text, jsonb)',
    'read_email_batch(text, integer, integer)',
    'delete_email(text, bigint)',
    'move_to_dlq(text, text, bigint, jsonb)',

    -- Scheduled cleanup jobs (pg_cron)
    'cleanup_expired_idempotency_keys()',
    'cleanup_expired_rate_limits()',
    'cleanup_expired_unsubscribe_tokens()',
    'cleanup_old_auth_rate_limits()',

    -- Lifecycle locking and auth rate limit reset
    'release_lifecycle_lock()',
    'try_lifecycle_lock()',
    'reset_auth_rate_limit(text, text)',

    -- Internal integrity sweeps
    'check_anon_grants(text[])',
    'check_public_exposure(text[])',
    'check_security_definer_views()',
    'check_view_security_invoker()',
    'check_backend_only_views(text[])',
    'check_document_version_integrity()',
    'check_engagement_email_delivery()',
    'check_engagement_log_integrity()',
    'check_match_state_invariants()',
    'verify_event_chain_integrity()',
    'run_data_integrity_checks()',
    'dry_run_legacy_reconciliation()',
    'reconcile_acceptance_notifications()',
    'reconcile_token_balances()',

    -- Behavioural scoring jobs
    'compute_all_behavioral_kyc_scores(integer)',
    'compute_behavioral_score(uuid, integer)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
END $$;