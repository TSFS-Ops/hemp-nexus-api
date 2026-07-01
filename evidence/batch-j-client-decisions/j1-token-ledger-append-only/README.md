# Batch J1 — token_ledger append-only widened allowlist

**Tracker item:** #35
**Status:** `BATCH_J1_TOKEN_LEDGER_APPEND_ONLY_ALLOWLIST_DEPLOYED_PENDING_VERIFICATION`

## First-attempt rollback (context)

The first J1 apply installed a trigger that only allowed the
`credit → credit_purchase` promotion. The post-install static guard
detected a third live token_ledger UPDATE writer that the prior B2
inspection had missed — the legacy dashboard refund settlement branch
in `supabase/functions/token-purchase/index.ts:2076` which performs
`credit → credit_refund` label promotion. That trigger would have
broken refund settlement, so per strict-scope rule the first J1 was
rolled back within the same turn. Zero live rows mutated.

## Widened allowlist decision

Not a new business decision — same class of internal label promotion
the client already approved for #35, extended to the refund settlement
variant. Balance / token amount / org id / request id remain
untouchable; only the two `credit → X` label promotions with an
approved metadata marker are permitted.

## Complete live UPDATE writer inventory

| # | Path | OLD → NEW `action_type` | Approved marker keys |
|---|------|-------------------------|----------------------|
| 1 | RPC `public.atomic_paid_credit_purchase` (migration `20260623124308`) | `credit` → `credit_purchase` | `promoted_by` |
| 2 | RPC `public.repair_skeletal_paid_credit` (migration `20260623124308`) | `credit` → `credit_purchase` | `repaired_by` |
| 3 | Edge fn `supabase/functions/token-purchase/index.ts:2076` (legacy dashboard refund branch) | `credit` → `credit_refund` | `refund_reference` |

No live DELETE, UPSERT, or additional UPDATE writers were found.

## Migration

`supabase/migrations/20260701212418_f8e96785-4817-4404-852b-ef38fa2f4c97.sql`

Adds:

- Function `public.assert_token_ledger_append_only()`
  - `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`
  - `USING ERRCODE = 'check_violation'`
  - Error marker `token_ledger_append_only`
- Trigger `token_ledger_append_only_trg`
  - `BEFORE UPDATE OR DELETE ON public.token_ledger FOR EACH ROW`
  - No role gate — service_role and table owner are also subject to it.

Live trigger inventory now on `public.token_ledger`:

- `enforce_demo_inheritance_trg` (pre-existing)
- `token_ledger_append_only_trg` (**J1, new**)
- `token_ledger_no_truncate_trg` (Batch B1)

## Exact allowed UPDATE shape

**DELETE:** always raises `token_ledger_append_only`.

**UPDATE — protected columns must not differ (via `IS DISTINCT FROM`):**
`id`, `org_id`, `api_key_id`, `tokens_burned`, `remaining_balance`,
`outcome`, `request_id`, `created_at`, `entity_id`, `is_demo`,
`demo_dataset_id`.

**UPDATE — allowed transitions (exactly one of):**

- **Purchase promotion:**
  `OLD.action_type = 'credit'` AND `NEW.action_type = 'credit_purchase'` AND
  (`NEW.metadata ? 'promoted_by'` OR `NEW.metadata ? 'repaired_by'`).
- **Refund promotion:**
  `OLD.action_type = 'credit'` AND `NEW.action_type = 'credit_refund'` AND
  (`NEW.metadata ? 'refund_reference'` OR `NEW.metadata ? 'refunded_by'` OR `NEW.metadata ? 'promoted_by'`).

Any other `(OLD.action_type, NEW.action_type)` diff → blocked. Missing
marker → blocked. NULL `NEW.metadata` → blocked.

**Implicitly mutable on an allowed promotion:** `action_type`,
`endpoint`, `metadata` (everything else is pinned by the protected-column
guard).

## Tests / guards run

| Guard / test | Result |
|---|---|
| `scripts/check-batch-j1-token-ledger-append-only.mjs` | ✓ passed (install migration matched, all shape assertions passed, live writer scan matched approved inventory) |
| `scripts/check-batch-b1-truncate-guards.mjs` | ✓ passed (8 protected tables intact) |
| `scripts/check-dec-007-pay-009-no-ledger-delete.mjs` | ✓ passed |
| `bunx vitest run src/tests/batch-i1-payment-observability.test.ts` | ✓ 18 passed |
| `bunx vitest run src/tests/batch-i2-verify-path-audit-parity.test.ts` | ✓ 13 passed |

Rollback-only SQL proof:
`supabase/tests/batch_j1_token_ledger_append_only_allowlist_proof.sql`

Covers cases 1–12 in the spec (arbitrary UPDATE, DELETE, both purchase
markers, refund marker, protected-column blocks for balance/org/request,
missing-marker blocks for both transitions, credit→credit metadata-only
touch block, post-promotion UPDATE blocks for both terminal states,
Batch B1 trigger presence check). **Trigger existence and shape**
verified live via `pg_trigger` query; **trigger message-level
verification is pending privileged CI execution** because the sandbox
role cannot mutate arbitrary `token_ledger` rows.

## Explicit non-changes

- ❌ No RLS / grant / policy / FORCE RLS / ownership change.
- ❌ No change to `atomic_paid_credit_purchase`,
  `repair_skeletal_paid_credit`, `atomic_token_credit`,
  `atomic_token_burn`, or `token-purchase/index.ts` (including the
  refund path).
- ❌ No edge function deployed.
- ❌ No token balance, token amount, credit, refund, or settlement row
  mutated in production.
- ❌ No provider call (Paystack / PayFast / other).
- ❌ No email / notification / webhook dispatch.
- ❌ Item #67 settlement mismatch behaviour untouched.
- ❌ Batch B1 truncate guard and `enforce_demo_inheritance_trg`
  untouched.
- ❌ Indexes, unique constraints, and column definitions untouched.

## Reversibility

```sql
DROP TRIGGER IF EXISTS token_ledger_append_only_trg ON public.token_ledger;
DROP FUNCTION IF EXISTS public.assert_token_ledger_append_only();
```
