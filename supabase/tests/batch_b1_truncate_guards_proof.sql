-- Batch B1 — TRUNCATE guards proof.
--
-- Asserts that BEFORE TRUNCATE statement triggers raise
-- `protected_table_truncate_blocked` on every protected append-only /
-- sealed-immutability table. Each attempt is wrapped in a savepoint and
-- rolled back, so no data is ever changed.
--
-- Run privileged (table owner or service_role / postgres). Sandbox roles
-- without TRUNCATE privilege will hit the permission check before the
-- trigger — that is intentional defence in depth, but means this proof
-- must be executed in a CI/service-role context to exercise the trigger.

BEGIN;

DO $proof$
DECLARE
  protected_tables CONSTANT text[] := ARRAY[
    'event_store',
    'match_events',
    'poi_events',
    'audit_logs',
    'admin_audit_logs',
    'wads',
    'token_ledger',
    'wad_attestations'
  ];
  t          text;
  raised_ok  boolean;
  err_msg    text;
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
    raised_ok := false;
    err_msg   := NULL;
    BEGIN
      EXECUTE format('SAVEPOINT sp_%I', t);
      EXECUTE format('TRUNCATE public.%I', t);
      EXECUTE format('ROLLBACK TO SAVEPOINT sp_%I', t);
      RAISE EXCEPTION 'PROOF_FAIL: TRUNCATE public.% was NOT blocked', t;
    EXCEPTION WHEN check_violation THEN
      err_msg := SQLERRM;
      IF position('protected_table_truncate_blocked' IN err_msg) > 0
         AND position(t IN err_msg) > 0 THEN
        raised_ok := true;
      ELSE
        RAISE EXCEPTION
          'PROOF_FAIL: TRUNCATE public.% raised wrong message: %', t, err_msg;
      END IF;
      BEGIN
        EXECUTE format('ROLLBACK TO SAVEPOINT sp_%I', t);
      EXCEPTION WHEN OTHERS THEN
        NULL; -- savepoint already cleaned up by the exception path
      END;
    WHEN OTHERS THEN
      RAISE EXCEPTION
        'PROOF_FAIL: TRUNCATE public.% raised unexpected SQLSTATE % (%)',
        t, SQLSTATE, SQLERRM;
    END;

    IF NOT raised_ok THEN
      RAISE EXCEPTION 'PROOF_FAIL: TRUNCATE public.% did not raise protected_table_truncate_blocked', t;
    END IF;
  END LOOP;

  RAISE NOTICE 'PROOF_OK: all 8 protected tables refused TRUNCATE';
END
$proof$;

-- No data was ever written. Roll back to be belt-and-braces explicit.
ROLLBACK;
