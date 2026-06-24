# Acceptance-Receipt Delivery Backlog

## Batch B3.1 — Branch 3 recipient-correlated ESL suppression (applied + runtime confirmed)

Migration: `supabase/migrations/20260624075820_e5ab32ea-1ba3-4762-b3b2-9d78c8dd777f.sql`
Guard test: `src/tests/b3-1-branch3-recipient-correlated-suppression.test.ts`
Final status: `ACCEPTANCE_RECEIPT_CUTOFF_RESIDUAL_AUTO_RESOLVE_COMPLETE`

### Why
The original B3 Branch 3 used a bare
`NOT EXISTS (email_send_log WHERE template_name='acceptance-receipt' AND created_at BETWEEN ...)`
suppression. On the 2026-04-23 backfill day there are 140 unrelated
acceptance-receipt email logs in that window, none of which can be
correlated to the 4 NULL-recipient/no-dispatch Bucket C artefacts.
Branch 3 therefore failed to fire at the first post-B3 tick.

### What B3.1 changes
Replaces `public.reconcile_acceptance_notifications()` in place.
B1, B2, B3 Branch 1, and B3 Branch 2 are carried forward verbatim.
Branch 3's email-log suppression now requires recipient correlation:
an `email_send_log` row only blocks Branch 3 if its `recipient_email`
matches one of:

- `acceptance_receipts.counterparty_email` (when non-null);
- `acceptance_receipts.accepting_user_email` (when non-null);
- any `notification_dispatches.recipient_address` for the receipt
  (channel `email`, non-null address).

Branch 3's base criteria still require NULL recipient on the receipt
and no `notification_dispatches` rows — so for genuine Bucket C
artefacts the suppression is vacuously false and the branch resolves.
The predicate is written generally for defence in depth.

### Runtime verification
- `cron_heartbeats['reconcile-acceptance-notifications']`:
  `last_run_at=2026-06-24 08:02:00 UTC`, `last_status=success`,
  `last_error=NULL`.
- Open "Acceptance receipt … not notified" risk items: **12 → 8**.
- Resolved by reason:
  - `acceptance_receipt_delivered` (B1): 25 (unchanged)
  - `acceptance_receipt_pre_backfill_email_send_unverifiable_terminal` (B3 Branch 1): 8 (unchanged)
  - `acceptance_receipt_pre_backfill_cutoff_boundary_no_recipient` (B3 Branch 3): **0 → 4** ✅
- Audit rows since deploy: 4, all with the Branch 3 reason,
  `source='reconcile_acceptance_notifications'`, `admin_user_id=NULL`,
  `details.inclusive_backfill_cutoff='2026-04-23 09:46:24.999999+00'`.
- Residual 8 open rows confirmed all post-cutoff internal/demo
  recipients (`@izenzo.co.za` / `dovedavies14@gmail.com`). No
  external paying counterparty affected.

### Scope
- No emails sent. No provider calls. No Mailgun / Resend.
- No mutation of `notification_dispatches`, `acceptance_receipts`,
  or `email_send_log`. No dispatch retries.
- No changes to cron / RLS / grants / indexes / columns / payments /
  refunds / token ledger / POI / WaD / registry / lifecycle / engagement.
- C5b heartbeat wrapper unchanged.

Manual resend for the residual 8 Bucket D items remains a
CLIENT_DECISION and is not recommended.


## Batch B3 — Cutoff-inclusive residual auto-resolve (applied)



Migration: `supabase/migrations/20260624075000_e03cef59-03aa-4265-8ee8-1b99f25f55f3.sql`
Guard test: `src/tests/b3-acceptance-receipt-cutoff-residual.test.ts`
Final status: `ACCEPTANCE_RECEIPT_CUTOFF_RESIDUAL_AUTO_RESOLVE_SOURCE_REPAIR_DEPLOYED`
(promotes to `ACCEPTANCE_RECEIPT_CUTOFF_RESIDUAL_AUTO_RESOLVE_COMPLETE`
after the next scheduled jobid 21 tick confirms runtime.)

### Scope

Closes ONLY historical / cutoff-boundary acceptance-receipt
"not notified" risk items. Adds a third auto-resolve pass to
`public.reconcile_acceptance_notifications()` after B1 and B2.

Inclusive cutoff:
`2026-04-23 09:46:24.999999+00`. Anything created strictly after
this timestamp is never touched by B3.

### Three branches (any one is sufficient)

1. `acceptance_receipt_pre_backfill_email_send_unverifiable_terminal`
   — in-app dispatch `delivered`/`opened` exists AND email dispatch
   is `failed` with `error_message ILIKE '%send_unverifiable%'`.
2. `acceptance_receipt_pre_backfill_email_send_log_evidence`
   — `email_send_log` row exists in
   `[receipt.created_at - 1 day, +7 days]` with
   `template_name='acceptance-receipt'`, matching the receipt's
   `counterparty_email`, `accepting_user_email`, or the email
   dispatch's `recipient_address`.
3. `acceptance_receipt_pre_backfill_cutoff_boundary_no_recipient`
   — NULL recipient on receipt AND no `notification_dispatches`
   row AND no `email_send_log` row in the inspection window.

Each branch uses the same transaction-local trigger-guard bypass
`set_config('app.allow_risk_item_update', 'on', true)`, stamps
`status='resolved'` plus metadata, and writes a paired
`admin_audit_logs` row with `action='admin_risk_item.auto_resolved'`,
`admin_user_id=NULL`, `details.source='reconcile_acceptance_notifications'`,
`details.reason=<branch reason>`, and
`details.inclusive_backfill_cutoff='2026-04-23 09:46:24.999999+00'`.

### Expected runtime effect

- 12 residual risk items expected to resolve at next jobid 21 tick
  (Bucket B1: 7, Bucket B2: 1, Bucket C: 4).
- 8 post-cutoff internal/demo rows (Bucket D) remain OPEN by
  design, pending admin visibility / CLIENT_DECISION handling.
- Return JSON adds `cutoff_boundary_auto_resolved` and the three
  per-branch counters. C5b wrapper consumes the raw jsonb result
  and is unaffected.

### What B3 does NOT do

- Does NOT send any email or call any provider.
- Does NOT retry, insert, update, or delete `notification_dispatches`.
- Does NOT mutate `acceptance_receipts` or `email_send_log`.
- Does NOT change cron schedule, jobid, RLS, grants, indexes, or columns.
- Does NOT touch the C5b heartbeat wrapper.
- Does NOT close any post-cutoff item (Bucket D remains open).
- Does NOT close items with malformed titles, missing receipt rows,
  pending-only dispatches, or failed email without in-app delivery
  evidence outside the cutoff window.

Manual resend for the 8 residual Bucket D items remains a
CLIENT_DECISION and is not recommended. No external paying
counterparty is affected.

### Verification this turn

- Migration applied successfully via Lovable Cloud migration tool.
- B1 + B2 paths preserved verbatim (full text reproduced in the
  replacement function definition).
- Guard tests: B3, B1, B2, B1/B2 runtime, C5b, C5c — 74 tests pass.
- No live data mutation triggered from this session. First B3
  auto-resolve update will occur on the next `*/2 * * * *` tick of
  jobid 21 (`reconcile-acceptance-notifications`).




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
