# Batch N — Refund cluster inspection (tracker #8, #31)

**Status:** `BATCH_N_REFUND_CLUSTER_CLIENT_DECISION_REQUIRED`

## Scope
Inspection only. **No code, migration, deploy, or data mutation.** No provider
calls, no emails.

## Files / functions inspected

Edge functions
- `supabase/functions/refund-request/index.ts` — customer request.
- `supabase/functions/admin-refund-approve/index.ts` — admin approval (AAL2, reason ≥ 20).
- `supabase/functions/admin-refund-decline/index.ts` — admin decline.
- `supabase/functions/admin-refund-mark-settled/index.ts` — admin manual "issued in provider dashboard".
- `supabase/functions/paystack-webhook/index.ts` — dedicated Paystack HMAC entry.
- `supabase/functions/token-purchase/index.ts` — canonical webhook incl. `refund.processed` handler (lines 1685-2010).
- `supabase/functions/transaction-reconciliation/index.ts` — calls `surface_unsettled_refunds` (lines 726-742).

DB (migrations)
- `20260525124849_...admin_refund_approve_with_governance.sql` — atomic approve + governance.
- `20260623133810_...` — `approve_refund`, `decline_refund`, `mark_refund_provider_settled`, `mark_refund_manually_settled_with_governance`, `surface_unsettled_refunds`, `refund_requests_settlement_status_guard_fn`.

Client tests corroborating current wiring
- `src/tests/admin-refund-wiring.test.ts`
- `src/tests/admin-refund-mark-settled-wiring.test.ts`
- `src/tests/refund-settlement-status-ssot.test.ts`
- `src/tests/batch-h-refund-fx-legacy.test.ts`

## Current refund state machine (plain English)

`refund_requests` carries two orthogonal status fields:

1. `status` — internal admin decision: `pending → approved | declined`.
2. `provider_settlement_status` — money-movement state relative to Paystack:
   `not_submitted` (default on approve) → `provider_completed` (webhook) /
   `manually_settled_offline` (admin) / `not_applicable` (on decline).

Flow:

1. **Customer requests refund** (`refund-request` → RPC `request_refund`).
   Classified server-side: `unused_within_window` proceeds; `blocked_credits_used`
   / `blocked_expired` return 409 without creating a pending row.
2. **Admin approves** (`admin-refund-approve` → RPC
   `admin_refund_approve_with_governance` → RPC `approve_refund`, all in one
   DB transaction).
   - `refund_requests.status = 'approved'`, `provider_settlement_status = 'not_submitted'`.
   - `token_balances.balance := max(0, balance - credits_at_request)` **immediately**.
   - `token_ledger` row inserted with `action_type = 'refund'`, `endpoint = 'refund'`,
     `entity_id = refund_request.id`, `request_id = 'refund_req_<uuid>'`.
   - Governance event (`admin.hq_decision_recorded`) hash-chained on
     `event_store` in the same transaction.
3. **Money movement to customer is out-of-band.** No code path in this
   codebase calls the Paystack Refund API. Admin issues the refund in the
   Paystack dashboard manually, then either:
   - **(a) webhook path** — Paystack sends `refund.processed` →
     `paystack-webhook` (HMAC-verified) → forwards to
     `token-purchase/webhook` → `handleRefundProcessed`:
       - `webhook_replay_guard` blocks body+signature replays;
       - looks up `token_purchases` by `org_id + paystack_reference`;
       - finds the single approved+`not_submitted` `refund_requests` row for
         that purchase; if exactly one, calls
         `mark_refund_provider_settled` (sets
         `provider_settlement_status='provider_completed'`,
         `provider_refund_reference`, `provider_settled_at`, auto-resolves
         the `refund_settlement_pending` risk item). Balance is NOT
         re-mutated in this branch (approve_refund already debited).
       - ambiguous (>1) / RPC-failure / no matching purchase → open
         `admin_risk_items`, do not mutate balance.
       - partial refund → `refund_partial_parked` risk item, no
         proportional deduction.
   - **(b) admin manual path** — admin clicks "Mark manually settled" →
     `admin-refund-mark-settled` → RPC
     `mark_refund_manually_settled_with_governance` flips
     `provider_settlement_status = 'manually_settled_offline'` and writes
     a governance event. Does not touch tokens.
4. **Sweeper** — `transaction-reconciliation` cron calls
   `surface_unsettled_refunds(min_age_minutes=1440, limit=100)`:
   opens dedup'd `admin_risk_items(kind='refund_settlement_pending',
   severity='medium')` for approved refunds still `not_submitted` after 24h;
   auto-resolves them once the row transitions away from `not_submitted`.
   Does NOT call Paystack, does NOT initiate a refund.

Duplicate/idempotency posture
- `admin_refund_approve_with_governance` dedupes on
  `(refund_request_id, idempotency_key, event_type)` within 5 min via
  `event_store`.
- `approve_refund` takes `FOR UPDATE` on `refund_requests` and gates on
  `status = 'pending'` → returns `REFUND_ALREADY_DECIDED` (409).
- `mark_refund_provider_settled` idempotent on
  `(refund_request_id, provider_refund_reference)`; mismatched reference
  opens a `refund_settlement_conflict` risk item and does NOT overwrite.
- Ledger has `token_ledger.request_id` UNIQUE (per correlation
  `refund_req_<uuid>`). J1 append-only trigger prevents amount/balance
  mutation; label promotion allowed only per the J1 allowlist.

## Provider confirmation findings

- **Paystack refund API is never called from this codebase.** Grep confirms:
  no `fetch` to `api.paystack.co/transaction/refund` or `/refund` endpoint;
  no `PAYSTACK_SECRET_KEY` usage outside signature-verify on incoming
  webhooks and outbound `initialize`/`verify` for purchases.
- Internal "approve" therefore never triggers money movement. Money
  moves only when an admin (or Paystack) acts in the Paystack dashboard.

## Webhook / poller findings

- **Webhook**: Paystack `refund.processed` is recognised, HMAC-verified,
  replay-guarded, and reconciles the `refund_requests` row to
  `provider_completed`. Invalid signatures and missing secret already
  audited (Batch I1). Duplicate deliveries idempotent (soft via ledger
  lookup, hard via `token_ledger.request_id` UNIQUE, DB-level via
  `mark_refund_provider_settled` idempotency).
- **Poller**: there is no scheduled process that queries Paystack for
  refund status. The only "poller-like" job is `surface_unsettled_refunds`,
  which reads the local table only and opens risk items — it does not
  reach Paystack.

## Ledger / balance findings

- **Balance is deducted at internal approve time**, before any provider
  confirmation. This is the meaningful gap for tracker #8.
- If Paystack refund never occurs or fails silently, the customer loses
  credits without receiving money. The 24h sweeper opens a medium-severity
  risk item; no customer-facing status regression.
- Ledger row inserted at approve is `action_type='refund'`. Only the
  webhook path uses `action_type='credit_refund'` (different label,
  different code path — that path is the direct-in-dashboard refund with
  no prior internal approval; the code short-circuits before double-debit
  when a matching approved refund_request exists).
- No safe automatic repair path exists if provider refund is later
  cancelled after `provider_completed`; admin must open a manual
  `admin-credit-org` counter-entry.

## Risk classification

- **#8 — refund can be approved even though no money has been sent back**:
  `BALANCE_DEDUCTED_BEFORE_PROVIDER_SUCCESS`.
  Internal approval currently means "credits reversed in-platform" AND
  is the trigger for the offline provider refund. Customer's platform
  balance drops immediately; actual cash return depends on out-of-band
  Paystack action. Sweeper surfaces the gap to admins after 24h but the
  customer-facing state already reads "refunded".
- **#31 — missing refund webhook / poller safety**:
  `WEBHOOK_EXISTS_NO_POLLER`.
  A webhook does exist, is verified, replay-guarded, and reconciles state
  correctly. There is no scheduled Paystack-side poller; the local
  `surface_unsettled_refunds` sweeper only escalates internally. Poller
  would require a new Paystack API surface (`GET /refund/{reference}`),
  a stored `provider_refund_reference` at approve time (currently only
  populated by the webhook), and either a new secret scope or reuse of
  `PAYSTACK_SECRET_KEY`.

## Recommended smallest safe design (not applied)

Two-phase state, no accounting change unless client approves it:

1. Split `refund_requests.status` semantics into approval and settlement:
   introduce (or repurpose the existing) `provider_settlement_status`
   with an explicit `approved_awaiting_provider` phase and stop calling
   the customer-facing state "refunded" until
   `provider_completed` OR `manually_settled_offline`.
2. Do NOT change when `token_balances` is decremented **unless the client
   explicitly approves it**. Current accounting policy is "credit reversal
   at internal approval" — moving the debit to post-provider-success is a
   commercial/accounting decision, not a bug fix. This is the material
   client-decision gate.
3. Customer-facing UI/API should render:
   - approved but `not_submitted` → "Approved, refund in progress"
   - `provider_completed` / `manually_settled_offline` → "Refund complete"
   - never claim "refunded" while `not_submitted`.
4. Optional refund-status poller (per #31): if desired, a new
   `refund-status-poller` cron would call
   `GET https://api.paystack.co/refund/{reference}` **only** for rows
   with `provider_refund_reference IS NOT NULL` and
   `provider_settlement_status IN ('submitted','provider_pending')`. It
   must NEVER call `POST /refund` (never initiate). It should share the
   same reconciliation function as the webhook (`mark_refund_provider_settled`).
   Requires: no new secret (reuses `PAYSTACK_SECRET_KEY`); requires
   capturing `provider_refund_reference` at some point (admin paste at
   mark-settled, or via webhook — the poller only helps when the webhook
   never arrives, which is the case that most needs it, so the reference
   has to come from admin entry).
5. Provider failures should create high-severity `admin_risk_items` and
   NEVER auto-flip the customer state to "refunded".
6. `#67` settlement mismatch remains per the prior client decision:
   manual admin review, no auto refund, no auto credit. Not touched.

## Client decisions required

1. **Balance-debit timing.** Keep current "debit at internal approval"
   (pro: consumer cannot spend a to-be-refunded credit; con: customer
   status appears completed before money arrives) OR move to "debit only
   after provider confirmation" (pro: matches money-movement truth; con:
   customer can spend a credit that will be reversed). Same
   trade-off exists for the language shown to the customer.
2. **Whether to introduce a Paystack refund-status poller** (#31) given
   the webhook + 24h sweeper already covers the main failure mode.
3. **Whether to store `provider_refund_reference` at approve time** (by
   requiring the admin to paste it when clicking approve, so both the
   webhook and any future poller can reconcile deterministically).

## Confirmation — no changes applied
- No files edited.
- No migrations applied.
- No edge functions deployed.
- No rows mutated.
- No provider calls made.
- No emails / notifications sent.
- WaD, POI, legal-hold, storage, token-ledger triggers, cron schedules,
  RLS/grants, `#67` settlement-mismatch policy — all untouched.

## Final status
`BATCH_N_REFUND_CLUSTER_CLIENT_DECISION_REQUIRED`

Recommendation: obtain client sign-off on (1) balance-debit timing and
(2) whether a Paystack refund-status poller is wanted before applying any
code. The safe minimum-viable fix (state-name + customer-facing wording
changes) can proceed independently of the accounting decision if the
client wants to move on #8 without answering the debit-timing question.
