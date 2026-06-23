# Payment credit → ledger promotion hardening (pre-PayFast)

**Classification:** `CONTAINED_BUT_HARDEN_BEFORE_PAYFAST_LIVE`. Smallest fix only — no provider abstraction, no payment rewrite, no balance/refund/cron changes.

## 1. Files / migrations / functions to change

**New migration:** `supabase/migrations/<ts>_atomic_paid_credit_purchase.sql`

- Adds new RPC `public.atomic_paid_credit_purchase(...)`.
- Adds new RPC `public.repair_skeletal_paid_credit(...)` for the sweeper.
- Does NOT modify existing `atomic_token_credit` (still used by admin top-ups, UAT, system reconciliation — leave untouched).

**Edge function edits:**

- `supabase/functions/token-purchase/index.ts`
  - Webhook path L1217–1274: replace `atomic_token_credit` + follow-up `UPDATE token_ledger` with single call to `atomic_paid_credit_purchase`.
  - Verify path L370–432: same swap.
  - Webhook path L1282–1309 (`credits.purchased` audit): make non-23505 errors **throw** (currently logs and continues), matching the fail-closed pattern at L1344–1349.
- `supabase/functions/transaction-reconciliation/index.ts`
  - Append a small repair pass that calls `repair_skeletal_paid_credit` and counts results into `results`.

**New test files:**

- `supabase/functions/_shared/payment-atomicity_test.ts` (Deno test, static-source guards)
- `supabase/tests/atomic_paid_credit_purchase_proof.sql` (pgTAP-style SQL proof, follows existing `batch_f1_atomic_credit_proof.sql` pattern)

## 2. New RPC signatures

```
public.atomic_paid_credit_purchase(
  p_org_id           uuid,
  p_amount           integer,
  p_reference_id     text,          -- provider reference (paystack_reference / payfast pf_payment_id)
  p_endpoint         text,          -- 'payment:paystack' | 'payment:paystack:verify' | 'payment:payfast' …
  p_metadata         jsonb          -- package_id, price_usd, currency, fx_basis, customer_email, paid_at, …
) RETURNS jsonb                     -- { new_balance, ledger_id, already_credited }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

```
public.repair_skeletal_paid_credit(
  p_min_age_minutes  integer DEFAULT 15,
  p_limit            integer DEFAULT 100
) RETURNS TABLE (ledger_id uuid, reference text, action_taken text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

## 3. Existing `atomic_token_credit`: change?

**No.** Add a new paid-purchase-specific RPC alongside. Rationale:

- The current 46 `action_type='credit'` rows in DB are legitimate (admin top-ups, UAT, system reconciliation) — they must keep that classification.
- Only the *paid* path needs to land as `credit_purchase` directly.
- Smaller blast radius; no migration risk to admin-credit-org, UAT, or reconciliation backfills.

## 4. Idempotency on retry

`atomic_paid_credit_purchase` inside one SQL transaction:

1. `SELECT id, action_type FROM token_ledger WHERE request_id = p_reference_id FOR UPDATE` (uses existing `idx_token_ledger_request_id_unique` partial index).
2. If row exists with `action_type='credit_purchase'` → return `{already_credited: true, new_balance: <current>}` — no balance change, no second row.
3. If row exists with `action_type='credit'` (legacy skeletal from a prior partial run) → promote to `credit_purchase`, merge metadata, return `{already_credited: true}`.
4. If no row → `UPDATE token_balances SET balance = balance + p_amount … RETURNING balance`, then `INSERT INTO token_ledger (… action_type='credit_purchase', request_id=p_reference_id, endpoint=p_endpoint, metadata=p_metadata)`.

Webhook retry and verify retry both call the same RPC, so the verify ↔ webhook race resolves at the unique `request_id` index — exactly one settlement row, idempotent on any number of retries.

## 5. Double-credit prevention

- Existing partial UNIQUE on `token_ledger(request_id) WHERE request_id IS NOT NULL` is the hard ceiling.
- `FOR UPDATE` row lock inside the RPC prevents two concurrent webhook+verify deliveries from both incrementing balance before the unique index fires.
- `UPDATE token_balances` is the only mutation in step 4 and is conditional on the prior `SELECT FOR UPDATE` confirming no row exists.

## 6. Skeletal-row prevention

The ledger row is written with `action_type='credit_purchase'` in the same transaction as the balance update. There is no intermediate state. The skeletal `action_type='credit'` path can no longer occur on paid charges.

## 7. Repair of pre-existing skeletal rows

`repair_skeletal_paid_credit` selects rows where:

- `action_type='credit'`
- `request_id IS NOT NULL`
- `created_at < now() - (p_min_age_minutes || ' minutes')::interval`
- `EXISTS (SELECT 1 FROM token_purchases tp WHERE tp.paystack_reference = token_ledger.request_id)` — i.e. confirmed paid via `token_purchases`, not an admin/UAT/system row.

For each match: `UPDATE token_ledger SET action_type='credit_purchase', endpoint=COALESCE(endpoint, 'payment:paystack'), metadata = metadata || jsonb_build_object('repaired_by','sweeper','repaired_at',now())` — **balance untouched** (already credited). Idempotent: a second run sees no matches.

Today this returns zero rows (verified: 0 of 46 skeletal rows match a real `token_purchases.paystack_reference`). The sweeper is insurance against future partial runs.

## 8. Audit insert failure on webhook path

Webhook L1304–1308 currently swallows non-23505 errors. Change to:

```
if (auditErr && auditErr.code !== "23505") {
  throw new Error(`AUDIT_WRITE_FAILED: ${auditErr.message}`);
}
```

Paystack/PayFast then retry. RPC idempotency (step 4) guarantees no double-credit on retry. Same pattern already used at L1344–1349 for `payment.event_created`.

## 9. Verify path changes

- Replaces credit + promotion with the same RPC.
- Verify path already throws on non-23505 audit error at L458 — keep as-is.
- Verify path does NOT currently write `payment.event_created`; out of scope for this hardening (separate concern, would expand scope).
- Net behaviour: verify path becomes structurally identical to webhook on the credit+ledger+audit triple.

## 10. Reconciliation: extend or new function?

**Extend `transaction-reconciliation`.** Add one short block that calls `repair_skeletal_paid_credit(15, 100)` and records counts into the existing `results` object. Reasons:

- It already runs daily and already touches `token_purchases`.
- Avoids a new cron job (user explicitly excluded cron changes).
- One bounded SQL call; bounded result; no external sends.

## 11. Tests / guards

**Static guards** (`payment-atomicity_test.ts`):

- Assert `token-purchase/index.ts` contains zero direct `UPDATE token_ledger … SET action_type='credit_purchase'` strings on the paid path (forces use of RPC).
- Assert webhook audit insert block contains a `throw` on non-23505.
- Assert RPC is called exactly twice (webhook + verify).

**SQL proof** (`atomic_paid_credit_purchase_proof.sql`):

- Concurrent call with identical `p_reference_id` → exactly one ledger row, balance incremented once.
- Second call after first commits → `already_credited:true`, balance unchanged.
- Skeletal `credit` row pre-seeded → first RPC call promotes in place, balance unchanged.
- `repair_skeletal_paid_credit` against a seeded skeletal row matching `token_purchases` → row promoted, balance unchanged; second run → zero rows.
- `repair_skeletal_paid_credit` ignores admin/UAT/system rows (no matching `token_purchases`).

**CI invariant query** (added to existing health checks if present, otherwise documented in `docs/cron-setup.md`):

```
SELECT count(*) FROM token_ledger l
WHERE l.action_type='credit'
  AND l.created_at < now() - interval '15 minutes'
  AND EXISTS (SELECT 1 FROM token_purchases tp WHERE tp.paystack_reference = l.request_id);
-- expected: 0
```

## 12. Pre-apply safety checks

Before approving the migration, verify (read-only):

- `SELECT count(*) FROM token_ledger WHERE action_type='credit' AND EXISTS(SELECT 1 FROM token_purchases tp WHERE tp.paystack_reference = token_ledger.request_id)` → 0 (already confirmed).
- `SELECT count(*) FROM token_purchases WHERE status='pending' AND created_at < now() - interval '24 hours'` → 0 (already confirmed).
- `SELECT count(*) FROM admin_risk_items WHERE status='open' AND title ILIKE '%ledger promotion%'` → 0 (already confirmed).
- Confirm Paystack live traffic is quiet (no in-flight webhook within the deploy window) by checking `cron.job_run_details` and recent `audit_logs` action='credits.purchased' timestamps.
- Confirm PayFast is still NOT live.

## 13. Rollback plan

- **Migration:** the new RPCs are additive. Rollback = `DROP FUNCTION public.atomic_paid_credit_purchase(uuid,integer,text,text,jsonb); DROP FUNCTION public.repair_skeletal_paid_credit(integer,integer);`. No data touched.
- **Edge function:** revert `token-purchase/index.ts` and `transaction-reconciliation/index.ts` to prior commit. The old `atomic_token_credit + UPDATE` path still works because `atomic_token_credit` is unchanged.
- **Ordering:** deploy migration first (additive, safe), then edge function. If edge function misbehaves, revert edge function alone — migration can stay.
- **Reversibility window:** the new RPC produces canonical rows that match the existing schema, so revert at any time leaves valid data.

## 14. Final recommendation

`APPLY_SMALL_HARDENING` — additive migration plus two narrow edge-function edits and one sweeper extension. No balance logic change, no cron change, no provider abstraction. Closes the structural gap before PayFast inherits it.

## Technical details

- RPC uses `SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE … TO authenticated, service_role; REVOKE … FROM anon` — mirrors the existing `atomic_token_credit` grant pattern.
- RPC returns `jsonb` (not table) so the edge function can read `result.new_balance` / `result.already_credited` exactly like today.
- Sweeper RPC is `LIMIT`-bounded and read-locks rows with `FOR UPDATE SKIP LOCKED` to avoid blocking the live webhook path.
- No changes to: `token_balances` schema, `token_ledger` schema, `token_purchases` schema, RLS, GRANTs on tables, `payment.event_created` writer, `emitRevenueNotification`, refunds, disputes, POI burn, webhooks_endpoints, cron schedule, UI.  
  
Good. This is the right fix: **small, additive, provider-safe, and directly relevant before PayFast goes live.**
  Paste this into Lovable:
  ```text
  Apply the approved small hardening.

  Target:
  Payment credit → ledger promotion → audit trail hardening before PayFast goes live.

  Approved classification:
  CONTAINED_BUT_HARDEN_BEFORE_PAYFAST_LIVE

  Approved plan:
  - Add new paid-purchase-specific RPC `public.atomic_paid_credit_purchase(...)`.
  - Add new bounded repair RPC `public.repair_skeletal_paid_credit(...)`.
  - Do not modify existing `atomic_token_credit`.
  - Update `token-purchase/index.ts` so the Paystack webhook path and verify path use `atomic_paid_credit_purchase` instead of `atomic_token_credit` + separate `UPDATE token_ledger`.
  - Make webhook `credits.purchased` audit insert fail-closed on non-23505 errors.
  - Extend `transaction-reconciliation/index.ts` with one bounded repair pass calling `repair_skeletal_paid_credit(15, 100)`.
  - Add the proposed tests/guards.

  Strict scope:
  - Do not add provider abstraction.
  - Do not rewrite payments.
  - Do not change balance schema.
  - Do not change ledger schema.
  - Do not change token_purchases schema.
  - Do not change refunds.
  - Do not change disputes.
  - Do not change cron schedules.
  - Do not call Paystack.
  - Do not call PayFast.
  - Do not run live payments.
  - Do not alter existing balances.
  - Do not alter existing ledger rows except through tests or the bounded repair RPC if explicitly verified against zero live matches.
  - Do not touch POI, WaD, registry, UI, RLS, table grants, lifecycle, webhook endpoints, engagement reminders, infra alerts, or unrelated systems.

  Pre-apply safety checks first:
  1. Count skeletal paid-credit rows:
     `token_ledger.action_type='credit'` where `request_id` matches `token_purchases.paystack_reference`.
     Expected: 0.
  2. Count stale pending purchases older than 24h.
     Expected: 0.
  3. Count open admin risk items with title like `%ledger promotion%`.
     Expected: 0.
  4. Confirm PayFast is not live.
  5. Confirm no very recent Paystack purchase/webhook is in-flight.

  Only proceed if the pre-apply checks are safe.

  Implementation requirements:

  1. New migration:
     `supabase/migrations/<timestamp>_atomic_paid_credit_purchase.sql`

  2. Add RPC:

  `public.atomic_paid_credit_purchase(
    p_org_id uuid,
    p_amount integer,
    p_reference_id text,
    p_endpoint text,
    p_metadata jsonb
  ) RETURNS jsonb`

  Behaviour:
  - SECURITY DEFINER.
  - SET search_path = public.
  - Revoke from anon.
  - Grant execute to authenticated and service_role, matching existing RPC pattern.
  - If `token_ledger.request_id = p_reference_id` already exists with `action_type='credit_purchase'`, return JSON with `already_credited:true`, current balance, and ledger_id. Do not change balance.
  - If a legacy skeletal row exists with `action_type='credit'`, promote it to `credit_purchase`, merge metadata, return `already_credited:true`. Do not change balance.
  - If no row exists, update `token_balances` by adding `p_amount`, then insert `token_ledger` directly with `action_type='credit_purchase'`, `request_id=p_reference_id`, `endpoint=p_endpoint`, and `metadata=p_metadata`, all inside the same SQL transaction.
  - Use row locking / safe idempotency so webhook and verify cannot double-credit the same provider reference.

  3. Add repair RPC:

  `public.repair_skeletal_paid_credit(
    p_min_age_minutes integer DEFAULT 15,
    p_limit integer DEFAULT 100
  ) RETURNS TABLE (ledger_id uuid, reference text, action_taken text)`

  Behaviour:
  - SECURITY DEFINER.
  - SET search_path = public.
  - Revoke from anon.
  - Grant execute to service_role only unless there is an existing authenticated pattern that requires otherwise.
  - Only repair rows where:
    - `token_ledger.action_type='credit'`;
    - `request_id IS NOT NULL`;
    - row is older than `p_min_age_minutes`;
    - `request_id` matches a real `token_purchases.paystack_reference`;
    - bounded by `p_limit`;
    - use `FOR UPDATE SKIP LOCKED`.
  - Promote to `credit_purchase`.
  - Set/merge endpoint and metadata with `repaired_by='repair_skeletal_paid_credit'` and `repaired_at`.
  - Do not touch balance.
  - Idempotent second run returns zero rows.

  4. Update `supabase/functions/token-purchase/index.ts`:
  - Replace both paid paths:
    - webhook charge success path;
    - verify fallback path.
  - Remove the paid-path separate `UPDATE token_ledger SET action_type='credit_purchase'`.
  - Preserve existing response shape as much as possible.
  - Preserve existing idempotency behaviour.
  - Preserve existing no-double-credit behaviour.
  - Make webhook `credits.purchased` audit insert throw on non-23505 errors.

  5. Update `supabase/functions/transaction-reconciliation/index.ts`:
  - Add one bounded repair pass calling `repair_skeletal_paid_credit(15, 100)`.
  - Add repair counts into existing `results`.
  - Do not add a cron.
  - Do not send external notifications.

  6. Add tests/guards:
  - Static guard confirming paid path uses `atomic_paid_credit_purchase`.
  - Static guard confirming direct paid-path `UPDATE token_ledger SET action_type='credit_purchase'` is gone.
  - Static guard confirming webhook audit non-23505 throws.
  - SQL proof confirming:
    - same reference credits once only;
    - retry returns `already_credited:true`;
    - skeletal matching paid row is promoted without balance change;
    - repair function promotes matching paid skeletal row and ignores admin/UAT/system rows;
    - second repair run is idempotent.

  After applying, run:
  1. Relevant payment atomicity tests.
  2. SQL proof test.
  3. Existing payment/token tests if available.
  4. Typecheck/build guard if available.
  5. Final invariant query:
     count paid skeletal rows older than 15 minutes where `token_ledger.action_type='credit'` and `request_id` matches `token_purchases.paystack_reference`.
     Expected: 0.

  Report:
  1. Files changed.
  2. Migration name.
  3. Tests added.
  4. Tests run and results.
  5. Pre-apply check results.
  6. Post-apply invariant result.
  7. Whether any live balance/ledger rows were changed.
  8. Whether Paystack or PayFast were called.
  9. Whether PayFast remains not live.
  10. Final status.

  Expected final status if green:
  PAYMENT_ATOMIC_PAID_CREDIT_PURCHASE_HARDENING_COMPLETE
  ```