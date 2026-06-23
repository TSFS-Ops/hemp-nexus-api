# Audit-log Immutability — Bypass Freeze (Option A)

**Status:** AUDIT_LOG_BYPASS_FREEZE_GUARD_COMPLETE (containment-only)
**Date:** 2026-06-23

## What this batch does

This batch **freezes** the current de-facto-safe state of the
`app.allow_audit_cleanup` session-variable bypass on the
`assert_audit_immutable()` trigger that protects `public.audit_logs` and
`public.admin_audit_logs`.

It does **not** remove the bypass. It does **not** change the trigger,
the GUC, RLS, grants, or any production data.

## Why the bypass is left in place

Repository inspection found:

- **Zero callers** of `app.allow_audit_cleanup` anywhere in
  `src/`, `supabase/functions/`, `supabase/migrations/` (other than the
  trigger function itself), `supabase/tests/`, or `scripts/`.
- Retention and account-deletion flows (`scrub_user_pii`,
  `anonymise_old_email_send_log`, `delete-account`) **insert** audit rows;
  they never `UPDATE` or `DELETE` them, so they do not need the bypass.
- Production state at freeze time: `audit_logs = 5388`,
  `admin_audit_logs = 619`, open audit/bypass risk items = 0.

Live exposure is low; removing the bypass in this batch would not unblock
any current path but would require schema-level changes outside this
batch's scope.

## What the freeze enforces

1. **Repo-grep guard** —
   `src/tests/audit-log-cleanup-bypass-freeze.test.ts` fails CI if
   `allow_audit_cleanup` appears in any file outside an explicit
   allowlist (the original migration, the capability/policy doc, the
   guard test, the SQL proof, and this README).
2. **Static trigger-contract assertions** — the same test verifies the
   migration text still defines `assert_audit_immutable()`, creates both
   `audit_logs_no_mutate_trg` and `admin_audit_logs_no_mutate_trg` on
   `BEFORE UPDATE OR DELETE`, and raises `AUDIT_IMMUTABLE`.
3. **SQL freeze proof** —
   `supabase/tests/audit_log_immutability_freeze_proof.sql` is a
   rollback-wrapped proof that, when executed against the database, shows
   `UPDATE`/`DELETE` on both audit tables raise `AUDIT_IMMUTABLE` in the
   default (no-bypass) session. It MUST NOT set the bypass GUC.

## What this batch deliberately does NOT do

- Does not remove or narrow the `app.allow_audit_cleanup` GUC bypass.
- Does not add `BEFORE TRUNCATE` triggers (TRUNCATE remains permitted by
  the trigger function as written).
- Does not add an `EVENT TRIGGER` blocking `DROP TRIGGER` /
  `ALTER TABLE ... DISABLE TRIGGER` — table/function owner (`postgres`)
  can still drop these triggers. This is an acknowledged residual risk.
- Does not introduce the audited cleanup RPC.
- Does not change RLS, grants, payments, refunds, POI, WaD, registry,
  lifecycle, cron, reconciliation, or any other subsystem.

## Deferred — Option B (future hardening batch)

End-state recommendation, to be planned and reviewed as its own batch:

1. Replace the raw GUC bypass with a narrow `SECURITY DEFINER` RPC such
   as `cleanup_audit_row(p_table, p_row_id, p_reason, p_request_id)`
   that:
   - requires `platform_admin` via `has_role`;
   - writes an `admin_audit_logs` row recording actor, reason, table,
     row, request_id **before** the mutation;
   - performs the scoped `UPDATE`/`DELETE` itself instead of toggling a
     session flag.
2. Add `BEFORE TRUNCATE` statement-level triggers on both audit tables.
3. Add an `EVENT TRIGGER` protecting against `DROP TRIGGER` /
   `ALTER TABLE ... DISABLE TRIGGER` on the audit tables outside a
   flagged migration.
4. Optionally `ALTER DATABASE ... SET app.allow_audit_cleanup = 'off'`
   and keep the GUC read as a belt-and-braces tripwire.
5. Add CI runtime mutation tests (not just static text grep) executing
   the SQL freeze proof against a real Postgres instance.

## Files in this batch

- `src/tests/audit-log-cleanup-bypass-freeze.test.ts` (new)
- `supabase/tests/audit_log_immutability_freeze_proof.sql` (new)
- `evidence/audit-log-immutability-bypass-freeze/README.md` (this file)

No database migrations, edge functions, RLS, grants, triggers, or
runtime code were changed in this batch.
