# Acceptance-Receipt Delivery Backlog

## Batch B1 — Risk-item auto-resolve (applied)

Migration: `supabase/migrations/20260623220754_602f1df9-e6bd-4feb-b3b6-a7a3413466aa.sql`
Guard test: `src/tests/b1-acceptance-receipt-risk-auto-resolve.test.ts`
Final status: `ACCEPTANCE_RECEIPT_RISK_AUTO_RESOLVE_COMPLETE`

### What this batch does
Updates `public.reconcile_acceptance_notifications()` to:

1. Stamp `kind = 'acceptance_receipt_not_notified'` and
   `dedup_key = 'acceptance_receipt_not_notified:<receipt_id>'` on
   newly created `admin_risk_items` rows. Existing-alarm lookup now
   matches on either `dedup_key` or the legacy title.
2. After the detection loop, run a single bounded `UPDATE` that
   auto-resolves open risk items titled
   `Acceptance receipt <receipt_id> not notified` **only** when the
   referenced `acceptance_receipts` row now has a
   `notification_dispatches` row with `channel='email'` and
   `status IN ('delivered','opened')`.
3. On auto-resolve, set `status='resolved'`, `resolved_at=now()`,
   and merge into `metadata`:
   - `auto_resolved_reason = 'acceptance_receipt_delivered'`
   - `auto_resolved_by     = 'reconcile_acceptance_notifications'`
   - `auto_resolved_at     = now()`

### What this batch does NOT do
- No emails sent. No provider calls. No Mailgun / J1 / PayFast.
- No retry of the 8 `failed` `notification_dispatches` rows.
- No mutation of `notification_dispatches`, `acceptance_receipts`,
  or `email_send_log`.
- No cron schedule, job name, jobid, or active-flag change.
- No new index, RLS policy, or grant change.
- No mass backfill: auto-resolve only fires through normal cron
  execution of jobid 21 (`reconcile-acceptance-notifications`,
  `*/2 * * * *`).
- `kind`/`dedup_key` are NOT backfilled on the 45 pre-existing
  open risk items; the auto-resolve pass keys on `title`, so those
  rows are still eligible to resolve the next time the cron runs.

### Out of scope (remains as inspected)
- 8 `failed` `notification_dispatches` — CONTAINED, terminal
  `send_unverifiable` parity miss. Resend is a CLIENT_DECISION.
- 1 `pending` dispatch with NULL recipient/template — CONTAINED,
  not pickable by live cron.
- 12 receipts with no dispatch row (pre-backfill) — OPEN, future
  admin-visibility batch.
- C5b heartbeat helper for `reconcile-acceptance-notifications` —
  DEFERRED.

### Verification this turn
- Migration applied successfully via Lovable Cloud migration tool.
- Function signature replaced in place
  (`pg_get_functiondef` pre-state captured prior to apply).
- Vitest source-pattern guard added.
- No live data mutation triggered this turn — the function was not
  invoked from this session. The first auto-resolve update will
  occur on the next `*/2 * * * *` cron tick of jobid 21.

### Backlog counts (pre-batch read-only snapshot)
- Open "not notified" risk items: 45
- Failed dispatch rows: 8
- Pending dispatch rows: 1
