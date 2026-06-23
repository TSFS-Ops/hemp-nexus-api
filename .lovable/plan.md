# Refund Approval ≠ Provider Settlement — Hardening Plan (pre-PayFast)

Smallest safe change that prevents `status='approved'` from being misread as "money returned", without building outbound Paystack/PayFast refund submission or any provider abstraction.

---

## 1. Migration

**Name:** `<ts>_refund_provider_settlement_separation.sql`

**Additive columns on `public.refund_requests**` (all nullable, no backfill needed; no FK changes):


| Column                       | Type        | Default | Purpose                                                              |
| ---------------------------- | ----------- | ------- | -------------------------------------------------------------------- |
| `provider_settlement_status` | text        | `NULL`  | Provider-side lifecycle of the money movement.                       |
| `provider_refund_reference`  | text        | `NULL`  | Provider's refund id (e.g. Paystack `refund.processed.reference`).   |
| `provider_submitted_at`      | timestamptz | `NULL`  | When/if we ever submit outbound (kept null for now).                 |
| `provider_settled_at`        | timestamptz | `NULL`  | When provider confirmed money returned, OR manual-settle timestamp.  |
| `provider_settlement_actor`  | uuid        | `NULL`  | Admin who marked manual settlement (NULL for webhook-driven).        |
| `provider_settlement_notes`  | text        | `NULL`  | Reason / external reference for manual settle (≥ 20 chars when set). |


Plus:

- `CREATE INDEX idx_refund_requests_settlement_open ON public.refund_requests(reviewed_at) WHERE status='approved' AND provider_settlement_status='not_submitted';` — supports the reconciliation sweep cheaply.
- `CREATE UNIQUE INDEX idx_refund_requests_provider_ref ON public.refund_requests(provider_refund_reference) WHERE provider_refund_reference IS NOT NULL;` — guards against two refund_requests claiming the same provider refund id.

No new tables, no new RLS, no new grants (column-additive; existing table policies cover it). No CHECK constraint that references `now()` or other mutable expressions.

**One trigger** `public.refund_requests_settlement_status_guard` (BEFORE INSERT/UPDATE):

- Validates `status` ∈ the SSOT list (see §3).
- Validates `provider_settlement_status` ∈ the SSOT list when not NULL.
- Enforces: `provider_settlement_status IS NULL` whenever `status IN ('pending','blocked_credits_used','blocked_expired','superseded')`.
- Enforces: when `status='approved'`, `provider_settlement_status` must be NOT NULL (set by `approve_refund` to `'not_submitted'`).
- Enforces: when `status='declined'`, `provider_settlement_status` must be `'not_applicable'`.
- Enforces: when `provider_settlement_status='manually_settled_offline'`, `provider_settlement_actor IS NOT NULL` AND `char_length(provider_settlement_notes) >= 20` AND `provider_settled_at IS NOT NULL`.
- Enforces: when `provider_settlement_status='provider_completed'`, `provider_refund_reference IS NOT NULL` AND `provider_settled_at IS NOT NULL`.

Trigger logic, not CHECK, because the rules reference multiple columns and we want clear error codes.

---

## 2. Allowed `provider_settlement_status` values

```
not_submitted          -- internal approval recorded; nothing sent to provider
submitted              -- (reserved; not used until outbound submission ships)
provider_pending       -- (reserved; provider acknowledged, not yet completed)
provider_completed     -- provider webhook confirmed money returned
provider_failed        -- provider webhook reported failure / decline
manually_settled_offline -- admin issued the refund in provider dashboard and recorded it here
not_applicable         -- the refund_requests row was declined / blocked / superseded
```

Only `not_submitted`, `provider_completed`, `manually_settled_offline`, `not_applicable`, and `provider_failed` are writable in this patch. `submitted` and `provider_pending` are reserved for the later outbound-submission work.

---

## 3. CHECK / status SSOT

No SQL `CHECK` on the text values (avoids dump/restore brittleness). Validation lives in:

- The BEFORE trigger above (§1).
- TS SSOT in `src/lib/policy/dec-007-refund-policy.ts`:
  - Extend `REFUND_REQUEST_STATUSES` (unchanged values).
  - Add `REFUND_PROVIDER_SETTLEMENT_STATUSES` const tuple with the seven values from §2.
  - Add `isMoneyReturned(status)` helper: `status === 'provider_completed' || status === 'manually_settled_offline'`.
  - Pin updated admin disclaimer copy that distinguishes the two statuses.

---

## 4. Defaults for existing & new rows

- Migration does **not** backfill. Existing rows retain `provider_settlement_status = NULL`. The trigger is enabled only for `INSERT` and for `UPDATE` rows where `status` or `provider_settlement_status` changes (`WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.provider_settlement_status IS DISTINCT FROM NEW.provider_settlement_status)`), so legacy NULL rows do not break.
- Going forward:
  - `request_refund` inserts: column stays `NULL` (status is `pending` or `blocked_*`).
  - `approve_refund` sets `provider_settlement_status='not_submitted'`.
  - `decline_refund` sets `provider_settlement_status='not_applicable'`.

---

## 5. Exact files/functions to change


| Area                    | File                                                                                                                                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approve RPC             | `supabase/migrations/<ts>_refund_provider_settlement_separation.sql` — `CREATE OR REPLACE FUNCTION public.approve_refund`                           | At the existing `UPDATE refund_requests SET status='approved' …`, also set `provider_settlement_status='not_submitted'`. No balance/ledger/audit change.                                                                                                                                                                                                                                                                                          |
| Decline RPC             | same migration — `CREATE OR REPLACE FUNCTION public.decline_refund`                                                                                 | Set `provider_settlement_status='not_applicable'`.                                                                                                                                                                                                                                                                                                                                                                                                |
| Approve edge fn         | `supabase/functions/admin-refund-approve/index.ts`                                                                                                  | No code change required; passes through unchanged. (Response can additionally surface `provider_settlement_status` for the UI, but optional.)                                                                                                                                                                                                                                                                                                     |
| Decline edge fn         | `supabase/functions/admin-refund-decline/index.ts`                                                                                                  | No code change.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Request edge fn         | `supabase/functions/refund-request/index.ts`                                                                                                        | No change.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Paystack refund webhook | `supabase/functions/token-purchase/index.ts` — `handleRefundProcessed`                                                                              | After the existing soft/hard idempotency guards and the `credit_purchase` validation, attempt to find a matching `refund_requests` row (see §7) and call new RPC `public.mark_refund_provider_settled`. No balance change beyond what already exists.                                                                                                                                                                                             |
| New RPC                 | same migration — `public.mark_refund_provider_settled(p_refund_request_id, p_provider_refund_reference, p_amount, p_currency, p_provider_event_id)` | SECURITY DEFINER, service_role only. Idempotent: if row already `provider_completed` with same reference → return `{deduplicated:true}`. Else flip `provider_settlement_status='provider_completed'`, set `provider_refund_reference`, `provider_settled_at=now()`. Writes one `audit_logs` row `billing.refund_provider_settled` and one `event_store` row `billing.refund_provider_settled`. Does NOT touch `token_balances` or `token_ledger`. |
| Manual settle edge fn   | new `supabase/functions/admin-refund-mark-settled/index.ts`                                                                                         | platform_admin + AAL2 + `provider_settlement_notes` ≥ 20. Wraps new RPC `public.mark_refund_manually_settled_with_governance(refund_id, admin_user_id, notes, request_id)`.                                                                                                                                                                                                                                                                       |
| Manual settle RPC       | same migration — `public.mark_refund_manually_settled_with_governance`                                                                              | Atomic: flip `provider_settlement_status='manually_settled_offline'`, set `provider_settlement_actor`, `provider_settlement_notes`, `provider_settled_at=now()`, plus governance event (mirrors F2 pattern). Returns structured `{success, deduplicated, event_id}`. No balance/ledger change.                                                                                                                                                    |
| Reconciliation          | `supabase/functions/transaction-reconciliation/index.ts`                                                                                            | Add one block that calls new RPC `public.surface_unsettled_refunds(p_min_age_minutes=>1440, p_limit=>100)` and counts results. Does NOT change cron schedule.                                                                                                                                                                                                                                                                                     |
| Risk-item RPC           | same migration — `public.surface_unsettled_refunds`                                                                                                 | For each `refund_requests` with `status='approved' AND provider_settlement_status='not_submitted' AND reviewed_at < now()-interval` UPSERT a single `admin_risk_items` row keyed by `dedup_key='refund_settlement_pending:<refund_id>'`, kind `refund_settlement_pending`, severity `medium`. Auto-resolves when settlement status flips.                                                                                                         |
| Admin UI                | `src/components/admin/AdminBillingReviewPanel.tsx`                                                                                                  | Render settlement-status badge next to existing status badge using the SSOT helper. Add "Mark manually settled" button (visible only when `status='approved' AND provider_settlement_status='not_submitted'`) opening dialog with notes ≥ 20 and confirmation that this records an offline settlement only. Wire to new edge fn.                                                                                                                  |
| SSOT                    | `src/lib/policy/dec-007-refund-policy.ts`                                                                                                           | Extend per §3.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Reporting helper        | new `src/lib/policy/refund-settlement.ts`                                                                                                           | Exports `isMoneyReturned(provider_settlement_status)` and `MONEY_RETURNED_STATUSES`.                                                                                                                                                                                                                                                                                                                                                              |
| Deploy manifest         | `scripts/edge-function-deploy-manifest.json`                                                                                                        | Add `admin-refund-mark-settled`.                                                                                                                                                                                                                                                                                                                                                                                                                  |


No changes to: `token_balances`, `token_ledger` schemas, RLS, GRANTs on existing tables, `paystack-webhook` outer handler, cron schedules, POI/WaD, registry, infra alerts, engagement reminders.

---

## 6. Exact meaning of each status after the change

`refund_requests.status` — **internal lifecycle only**:

- `pending` — customer requested; admin has not decided.
- `approved` — admin recorded internal approval. **Credits have been reversed in `token_balances` and `token_ledger`. This does NOT mean money has been returned.**
- `declined` — admin rejected the request.
- `blocked_credits_used` — auto-blocked because credits were consumed.
- `blocked_expired` — auto-blocked because outside 7-day window.
- `superseded` — replaced by a newer request.

`refund_requests.provider_settlement_status` — **money-movement lifecycle**:

- `not_submitted` — internal approval exists; provider has not been told.
- `provider_completed` — provider webhook confirmed money returned.
- `provider_failed` — provider webhook reported failure; needs admin attention.
- `manually_settled_offline` — admin issued refund in provider dashboard and recorded it.
- `not_applicable` — non-approved row; money movement is irrelevant.
- `submitted`, `provider_pending` — reserved for future outbound submission (not writable in this patch).

"Money has been returned to the customer" ⇔ `provider_settlement_status ∈ {'provider_completed','manually_settled_offline'}`. Nothing else.

---

## 7. Webhook marking provider settled without double-debit

In `handleRefundProcessed`:

1. Existing layers run unchanged: HMAC verify, `webhook_replay_guard`, soft check on `token_ledger.request_id=refundRef AND action_type='credit_refund'`, UNIQUE on `token_ledger.request_id`.
2. **New step before balance mutation:** look up matching `refund_requests` row:
  - `org_id = metadata.org_id`
  - `token_purchase_id` matches via `token_purchases.paystack_reference = data.transaction_reference`
  - `status = 'approved'`
  - `provider_settlement_status = 'not_submitted'` (or already `provider_completed` with same `provider_refund_reference` → idempotent return)
3. If exactly one match: call `mark_refund_provider_settled` and **skip the balance/ledger mutation block** (credits were already reversed by `approve_refund`). Still insert `credits.refund_settled_from_webhook` audit row for the trail.
4. If zero matches: fall through to existing webhook behaviour (the current path that deducts balance and writes a `credit_refund` ledger row keyed on `refundRef`) — i.e. unchanged behaviour for refunds issued in the dashboard with no prior internal approval.
5. If more than one match: do NOT mutate balance; open an `admin_risk_items` row `refund_settlement_ambiguous` and return.

This means a webhook for a refund that admin already approved never double-debits, and a webhook for a dashboard-only refund (no prior approval) keeps today's behaviour.

---

## 8. Idempotency for duplicate provider refund webhooks

Unchanged guards stay:

- `webhook_replay_guard` table (HMAC body+sig hash).
- Soft `token_ledger` lookup by `request_id=refundRef`.
- UNIQUE on `token_ledger.request_id`.

New guards added:

- UNIQUE partial index on `refund_requests.provider_refund_reference` (§1) — second webhook with same reference cannot create a second settlement.
- `mark_refund_provider_settled` early-returns `{deduplicated:true}` when the row already has the same `provider_refund_reference` and `provider_settlement_status='provider_completed'`.
- The webhook lookup in §7 step 2 explicitly tolerates "already provider_completed with same reference" as a no-op success.

---

## 9. Manual settlement flow

- **Who:** `platform_admin` only, AAL2 enforced in `admin-refund-mark-settled` edge fn (same gate as approve/decline).
- **Required reason:** `provider_settlement_notes` ≥ 20 chars (validated by Zod and by the trigger).
- **Audit / governance:** atomic via `mark_refund_manually_settled_with_governance` — single transaction writes the column flip + `audit_logs` `billing.refund_manually_settled` + `event_store` `admin.hq_decision_recorded` (subtype `refund.manual_settlement`).
- **No balance side effect:** RPC body does not touch `token_balances` or `token_ledger`. The credit reversal already happened at approve time. This step only records that the external money movement actually occurred.
- **Visible:** UI badge flips from "Awaiting provider settlement" to "Manually settled offline" with reviewer + timestamp.
- **Idempotent:** repeated calls with the same `request_id` within 5 min return `{deduplicated:true}` (mirrors F2 wrapper pattern).

---

## 10. Reconciliation surfacing of approved-but-not-settled refunds (> 24h)

`public.surface_unsettled_refunds(p_min_age_minutes int default 1440, p_limit int default 100)`:

```text
FOR each refund_requests r WHERE
  r.status = 'approved'
  AND r.provider_settlement_status = 'not_submitted'
  AND r.reviewed_at < now() - (p_min_age_minutes || ' minutes')::interval
LIMIT p_limit:
  INSERT INTO admin_risk_items (org_id, kind, title, description, severity, status, dedup_key, metadata)
  VALUES (..., 'refund_settlement_pending',
          'Approved refund awaiting provider settlement',
          'Refund <id> was approved <reviewed_at> and credits were reversed. No provider settlement has been recorded. Run the refund in the provider dashboard and mark settled, or attach the provider refund reference.',
          'medium', 'open',
          'refund_settlement_pending:' || r.id::text,
          jsonb_build_object('refund_request_id', r.id, 'reviewed_at', r.reviewed_at))
  ON CONFLICT (dedup_key) DO NOTHING;
```

Plus auto-resolve pass in same RPC: any `admin_risk_items` with `kind='refund_settlement_pending'` whose linked `refund_requests.provider_settlement_status` is no longer `'not_submitted'` is updated to `status='resolved', resolved_at=now()`.

Called once per `transaction-reconciliation` tick. **No cron schedule change.**

---

## 11. Reports distinguishing the three meanings

- **Internally approved (credits reversed):** `refund_requests.status = 'approved'`.
- **Money actually returned to customer:** `refund_requests.provider_settlement_status IN ('provider_completed','manually_settled_offline')`, exposed via `isMoneyReturned()` in `src/lib/policy/refund-settlement.ts`.
- **Manually settled outside provider:** `refund_requests.provider_settlement_status = 'manually_settled_offline'`.

A Vitest static guard forbids new code from using `status='approved'` as the money-returned filter:

```ts
// src/tests/refund-settlement-reporting.test.ts
// fails when any src/** or supabase/functions/** file contains
// /refund.*status.*=.*'approved'/ unless the same file imports
// MONEY_RETURNED_STATUSES from @/lib/policy/refund-settlement
```

---

## 12. How this prepares the seat for PayFast

- The internal approval path is provider-agnostic — it never mentions Paystack.
- `provider_settlement_status` is the single field a future PayFast webhook handler flips, using the same `mark_refund_provider_settled` RPC keyed by `provider_refund_reference`.
- `manually_settled_offline` covers the period when PayFast is live but its refund webhook is not yet wired — admins issue refunds in PayFast dashboard and record settlement here, with full audit.
- No PayFast code, no provider abstraction, no outbound submission is written now. When PayFast outbound submission is added later, the existing reserved statuses (`submitted`, `provider_pending`) are already in the SSOT and trigger so no second status migration is needed.
- Reporting is decoupled from the provider name via `isMoneyReturned()`.

---

## 13. Pre-apply safety checks

Run before approving the migration:

1. `SELECT count(*) FROM public.refund_requests WHERE status='approved';` — expect 0 today; if non-zero, the migration still works (`provider_settlement_status` stays NULL on legacy rows, trigger ignored on no-op updates) but we note the row for manual labelling.
2. `SELECT count(*) FROM public.refund_requests WHERE status NOT IN ('pending','approved','declined','blocked_credits_used','blocked_expired','superseded');` — must be 0 before the new trigger is enabled.
3. Confirm no in-flight Paystack `refund.processed` events in the last 24h that would race the deploy (`supabase--analytics_query` on `function_edge_logs` filtered by `token-purchase` + `refund`).
4. Confirm PayFast is still NOT live.
5. Confirm no open `admin_risk_items` of kind `refund_settlement_pending` already exist (collision check).
6. Confirm `transaction-reconciliation` last tick is healthy.

---

## 14. Tests / guards

Static guards (Vitest):

- `src/tests/refund-settlement-status-ssot.test.ts` — SSOT exports both status tuples and `isMoneyReturned`; pinned values match the migration.
- `src/tests/refund-settlement-reporting.test.ts` — forbids `status='approved'` as a money-returned filter outside the SSOT.
- `src/tests/admin-refund-mark-settled-wiring.test.ts` — mirrors `admin-refund-wiring.test.ts`: AAL2 + platform_admin + notes ≥ 20 + atomic RPC + governance event surfaced.
- `src/tests/dec-007-pay-009-admin-disclaimer.test.ts` (extend) — pinned new disclaimer wording.

SQL proof (`supabase/tests/refund_provider_settlement_proof.sql`, ROLLBACK-wrapped, mirrors F2 proof):

- A. `approve_refund` sets `provider_settlement_status='not_submitted'`.
- B. `mark_refund_provider_settled` is idempotent on the same `provider_refund_reference`; second call returns `deduplicated=true`; no second event; balance unchanged.
- C. `mark_refund_manually_settled_with_governance` enforces notes ≥ 20, writes governance event, leaves balance untouched, second call dedups.
- D. Webhook path against an already-approved refund does NOT double-debit balance (uses helper to invoke `handleRefundProcessed` logic at SQL level via the new RPC chain).
- E. Trigger blocks invalid transitions (e.g. setting `provider_settlement_status='provider_completed'` without a reference; flipping `status='approved'` without `not_submitted`).
- F. `surface_unsettled_refunds` opens exactly one risk item per stale row and auto-resolves once settled.

CI workflow: add the proof to the existing `supabase/tests` runner; no new GHA job.

---

## 15. Rollback

- The migration is fully additive; rollback script `DROP`s in this order, all idempotent:
  1. `DROP TRIGGER refund_requests_settlement_status_guard ON public.refund_requests;`
  2. `DROP FUNCTION public.mark_refund_provider_settled(...);`
  3. `DROP FUNCTION public.mark_refund_manually_settled_with_governance(...);`
  4. `DROP FUNCTION public.surface_unsettled_refunds(...);`
  5. `DROP INDEX idx_refund_requests_settlement_open;`
  6. `DROP INDEX idx_refund_requests_provider_ref;`
  7. `ALTER TABLE public.refund_requests DROP COLUMN provider_settlement_status, DROP COLUMN provider_refund_reference, DROP COLUMN provider_submitted_at, DROP COLUMN provider_settled_at, DROP COLUMN provider_settlement_actor, DROP COLUMN provider_settlement_notes;`
- Restore the prior `approve_refund` / `decline_refund` bodies (kept in the migration file as commented "prior version" for fast revert).
- Edge function rollback: `admin-refund-mark-settled` can be removed from manifest; `token-purchase` webhook block is a small additive guard — revert the file to the pre-change commit.
- UI rollback: revert `AdminBillingReviewPanel.tsx` and remove `refund-settlement.ts`.
- No data destruction: legacy rows have NULL settlement status throughout, so rollback is lossless.

---

## 16. Final recommendation

**APPLY_SMALL_HARDENING.**

Additive migration (six columns, two indexes, one trigger, three RPCs, two RPC bodies updated). One new edge function. One webhook block. One reconciliation call. One UI badge + dialog. One SSOT extension. No outbound provider call. No provider abstraction. No balance logic change. No cron change. Closes the structural "approved means money moved" ambiguity before PayFast inherits it.  
  
This is a good plan. It keeps the fix narrow and avoids building the actual PayFast refund engine before we are ready.

Paste this into Lovable:

```text
Apply the approved small hardening.

Target:
Refund approval must be separated from provider settlement before PayFast goes live.

Approved status:
OPEN_NEEDS_HARDENING_BEFORE_PAYFAST_LIVE

Approved goal:
Stop `refund_requests.status='approved'` from being treated as “money returned”.
Keep it as internal approval / internal credit reversal only.
Add a separate provider-settlement lifecycle so Paystack now, and PayFast later, can record whether money actually moved.

Strict scope:
- Do not build outbound Paystack refund submission.
- Do not build outbound PayFast refund submission.
- Do not add provider abstraction.
- Do not rewrite refunds.
- Do not change balance logic.
- Do not change token_balances schema.
- Do not change token_ledger schema.
- Do not approve refunds.
- Do not call Paystack.
- Do not call PayFast.
- Do not move money.
- Do not change cron schedules.
- Do not touch POI, WaD, registry, payment credit atomicity, infra alerts, engagement reminders, RLS, grants, or unrelated systems.

Pre-apply checks:
1. `SELECT count(*) FROM public.refund_requests WHERE status='approved';`
2. `SELECT count(*) FROM public.refund_requests WHERE status NOT IN ('pending','approved','declined','blocked_credits_used','blocked_expired','superseded');`
3. Confirm no in-flight Paystack `refund.processed` events in the last 24h.
4. Confirm PayFast is still not live.
5. Confirm no open `admin_risk_items` of kind `refund_settlement_pending`.
6. Confirm `transaction-reconciliation` last tick is healthy.

Only proceed if safe.

Implement:

1. New migration:
`<timestamp>_refund_provider_settlement_separation.sql`

Add nullable columns to `public.refund_requests`:
- `provider_settlement_status text`
- `provider_refund_reference text`
- `provider_submitted_at timestamptz`
- `provider_settled_at timestamptz`
- `provider_settlement_actor uuid`
- `provider_settlement_notes text`

Add indexes:
- `idx_refund_requests_settlement_open`
- `idx_refund_requests_provider_ref`

Add trigger:
`public.refund_requests_settlement_status_guard`

Trigger must enforce:
- valid existing `refund_requests.status` values;
- valid `provider_settlement_status` values;
- `status='approved'` requires `provider_settlement_status='not_submitted'`;
- `status='declined'` requires `provider_settlement_status='not_applicable'`;
- pending/blocked/superseded rows must not have provider settlement status;
- `manually_settled_offline` requires actor, settled timestamp and notes of at least 20 chars;
- `provider_completed` requires provider reference and settled timestamp.

2. Extend SSOT:
`src/lib/policy/dec-007-refund-policy.ts`

Add provider settlement statuses:
- `not_submitted`
- `submitted`
- `provider_pending`
- `provider_completed`
- `provider_failed`
- `manually_settled_offline`
- `not_applicable`

Add helper:
- `isMoneyReturned(...)`

Pin wording that clearly says:
- `approved` = internal approval / credits reversed;
- money returned = provider completed or manually settled offline.

3. Add reporting helper:
`src/lib/policy/refund-settlement.ts`

Export:
- `MONEY_RETURNED_STATUSES`
- `isMoneyReturned(provider_settlement_status)`

4. Update approve/decline RPCs:
- `approve_refund` must set `provider_settlement_status='not_submitted'`.
- `decline_refund` must set `provider_settlement_status='not_applicable'`.
- Do not otherwise change credit/balance/ledger behaviour.

5. Add RPC:
`public.mark_refund_provider_settled(...)`

Purpose:
- mark provider settlement complete from webhook;
- set `provider_settlement_status='provider_completed'`;
- set provider reference and settled timestamp;
- write audit/governance trail;
- do not touch balance;
- do not touch token ledger;
- idempotent on duplicate provider reference.

6. Add RPC:
`public.mark_refund_manually_settled_with_governance(...)`

Purpose:
- platform_admin manual settlement record;
- requires notes ≥ 20 chars;
- sets `provider_settlement_status='manually_settled_offline'`;
- sets actor, notes, settled timestamp;
- writes audit/governance event;
- no balance or ledger side effect;
- idempotent using request_id/dedup pattern.

7. Add RPC:
`public.surface_unsettled_refunds(...)`

Purpose:
- find approved refunds with `provider_settlement_status='not_submitted'` older than 24h;
- create one deduped `admin_risk_items` row per refund;
- auto-resolve risk item when settlement status is no longer `not_submitted`;
- no external sends.

8. Update Paystack refund webhook:
`supabase/functions/token-purchase/index.ts`

In `handleRefundProcessed`:
- if webhook matches an already internally approved refund with `provider_settlement_status='not_submitted'`, call `mark_refund_provider_settled`;
- do not double-debit balance;
- do not write a second refund ledger row;
- preserve existing behaviour for dashboard-only provider refunds that do not match an internal approval;
- if more than one match, do not mutate balance; open `refund_settlement_ambiguous` admin risk item.

9. Add edge function:
`supabase/functions/admin-refund-mark-settled/index.ts`

Requirements:
- platform_admin only;
- AAL2 required;
- notes ≥ 20 chars;
- calls `mark_refund_manually_settled_with_governance`;
- no balance or ledger side effects.

Add it to:
`scripts/edge-function-deploy-manifest.json`

10. Update reconciliation:
`supabase/functions/transaction-reconciliation/index.ts`

Add one bounded call to:
`surface_unsettled_refunds(1440, 100)`

Add result count to existing results object.
Do not change cron schedule.

11. Update UI:
`src/components/admin/AdminBillingReviewPanel.tsx`

Add:
- settlement status badge next to refund status;
- visible difference between internal approval and money returned;
- “Mark manually settled” action only when `status='approved' AND provider_settlement_status='not_submitted'`;
- dialog requiring notes ≥ 20 chars;
- clear copy that manual settlement only records that the refund was done outside Izenzo and does not move money.

12. Add tests/guards:
- SSOT provider-settlement status test.
- Reporting guard forbidding `status='approved'` as a money-returned filter.
- Admin mark-settled wiring guard.
- DEC-007 disclaimer guard.
- SQL proof `refund_provider_settlement_proof.sql` covering:
  - approve sets `not_submitted`;
  - provider settlement idempotently marks completed;
  - duplicate provider reference does not duplicate settlement;
  - manual settlement requires notes ≥ 20 chars;
  - manual settlement writes governance event;
  - no balance change on provider/manual settlement;
  - invalid trigger transitions are blocked;
  - `surface_unsettled_refunds` creates one risk item and auto-resolves after settlement.

After applying, run:
1. All new refund settlement tests.
2. Existing refund/governance tests.
3. SQL proof.
4. Typecheck/build guard if available.
5. Pre/post invariant checks.

Report:
1. Files changed.
2. Migration name.
3. Edge functions changed/added.
4. Tests added.
5. Tests run and results.
6. Pre-apply safety check results.
7. Post-apply production counts:
   - refund_requests by status;
   - refund_requests by provider_settlement_status;
   - approved but not submitted;
   - approved and money returned;
   - refund_settlement_pending risk items.
8. Whether any live balances or ledger rows changed.
9. Whether Paystack or PayFast were called.
10. Whether PayFast remains not live.
11. Final status.

Expected final status if green:
REFUND_PROVIDER_SETTLEMENT_SEPARATION_COMPLETE
```