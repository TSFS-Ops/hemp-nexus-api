# Acceptance-Receipt Delivery Backlog

## Batch B2 — Pre-backfill risk-item closure (applied)

Migration: `supabase/migrations/20260623234215_f5494ff9-fc6c-4e92-a504-43bf9c3eccba.sql`
Guard test: `src/tests/b2-acceptance-receipt-pre-backfill-closure.test.ts`
Final status: `ACCEPTANCE_RECEIPT_PRE_BACKFILL_RISK_CLOSURE_COMPLETE`

### Inspection summary (C-12)
- 12 open `admin_risk_items` titled `Acceptance receipt <uuid> not notified` whose receipts pre-date dispatch tracking.
- Zero `notification_dispatches` rows for those receipts.
- Zero matching `email_send_log` rows in `[receipt.created_at - 1d, +7d]` for `template_name='acceptance-receipt'`.
- Composition: 4 with NULL recipient on the receipt; 8 with internal izenzo / demo recipients (`james@izenzo.co.za`, `dovedavies14@gmail.com`).
- No external paying counterparty affected. Manual resend remains CLIENT_DECISION and is not recommended.

### What B2 does
Extends `public.reconcile_acceptance_notifications()` with a second
audit-trailed auto-resolve pass that closes an `admin_risk_items`
row only when ALL of the following hold:

1. `status = 'open'` AND (`kind = 'acceptance_receipt_not_notified'`
   OR legacy title `Acceptance receipt <uuid> not notified`).
2. The referenced `acceptance_receipts` row exists.
3. `acceptance_receipts.created_at < '2026-04-23 09:46:24+00'`
   (the dispatch-tracking backfill cutoff, declared as a constant
   `v_dispatch_backfill_cutoff timestamptz` inside the function).
4. NO `notification_dispatches` row exists with
   `reference_type='acceptance_receipt' AND reference_id=ar.id`.
5. NO `email_send_log` row exists where `template_name='acceptance-receipt'`
   AND `created_at BETWEEN ar.created_at - interval '1 day' AND ar.created_at + interval '7 days'`
   AND `recipient_email` matches `ar.counterparty_email` or
   `ar.accepting_user_email` (when those fields are non-NULL).

On match, the function stamps `status='resolved'`, `resolved_at=now()`,
`updated_at=now()`, and merges into `metadata`:
- `auto_resolved_reason = 'acceptance_receipt_pre_backfill_no_dispatch'`
- `auto_resolved_by     = 'reconcile_acceptance_notifications'`
- `auto_resolved_at     = now()`
- `pre_backfill_cutoff  = '2026-04-23 09:46:24+00'`

Return JSON gains `pre_backfill_auto_resolved` alongside the
existing `checked_at`, `alarms_raised`, and `auto_resolved` keys.
The C5b heartbeat wrapper consumes the raw jsonb result and does
not depend on a specific key shape, so wrapper behaviour is
preserved.

### What B2 does NOT do
- Does NOT send any email or call any provider.
- Does NOT insert, update, or delete `notification_dispatches`.
- Does NOT mutate `acceptance_receipts` or `email_send_log`.
- Does NOT retry the 8 failed backfill dispatches (still CONTAINED).
- Does NOT touch the 1 malformed pending dispatch (still CONTAINED).
- Does NOT change cron schedule, job, jobid, RLS, or grants.
- Does NOT build an admin page in this batch.
- Does NOT auto-resolve any post-cutoff item, anything with a
  dispatch row of any status, or anything with email-send-log
  evidence near the receipt date.

### Verification this turn
- Migration applied successfully via Lovable Cloud migration tool.
- B1 path preserved verbatim (`acceptance_receipt_delivered`
  branch unchanged).
- Guard test pinned against the new migration file.
- No live data mutation was triggered from this session — the
  first pre-backfill auto-resolve update will occur on the next
  `*/2 * * * *` cron tick of jobid 21
  (`reconcile-acceptance-notifications`).

### Read-only counts (pre-batch snapshot)
- Open "Acceptance receipt … not notified" risk items: 45
  - 25 already-delivered (will resolve via B1 path)
  - 8 failed-only (CONTAINED, not touched by B2)
  - 12 pre-backfill no-dispatch (resolved by B2 on next cron tick)
- Failed dispatch rows: 8 (unchanged)
- Pending dispatch rows: 1 (unchanged, malformed)

---


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
