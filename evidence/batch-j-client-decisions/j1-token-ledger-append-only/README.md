# Batch J1 — token_ledger append-only allowlist

**Tracker item:** #35
**Final status this turn:** `BATCH_J1_TOKEN_LEDGER_APPEND_ONLY_ALLOWLIST_NEEDS_MORE_INSPECTION`

## Result

**Not deployed.** The trigger was installed and then immediately rolled
back in the same turn because a live UPDATE path outside the two
approved RPCs was discovered during the pre-apply writer-path
re-verification / post-install guard run. Per the strict-scope rule
("if any new live UPDATE/DELETE path exists, stop and report
`NEEDS_MORE_INSPECTION`") the safe action is to stop and re-open for
client decision on whether the refund promotion also belongs in the
allowlist.

No live token_ledger row was mutated during this turn. No production
data changed. No provider was called. No email was sent.

## Approved client decision (unchanged)

Item #35 — allow only the existing narrow internal promotion from
temporary `credit` to final `credit_purchase`; balance, token amount,
`org_id`, `request_id` must not change; only approved promotion marker
(`promoted_by` or `repaired_by`) allowed; all other UPDATE/DELETE
blocked.

## Live token_ledger UPDATE writers found (updated inventory)

Re-scan across `src/`, `supabase/functions/`, `scripts/`, `e2e/` with
the regex `.from("token_ledger")<=400 chars>\.(update|delete|upsert)\(`:

| # | Path | Old → New | Marker in metadata |
|---|------|-----------|--------------------|
| 1 | `public.atomic_paid_credit_purchase` RPC (migration 20260623124308, line 54) | `credit` → `credit_purchase` | `promoted_by = 'atomic_paid_credit_purchase'` |
| 2 | `public.repair_skeletal_paid_credit` RPC (migration 20260623124308, line 166) | `credit` → `credit_purchase` | `repaired_by = 'repair_skeletal_paid_credit'` |
| 3 | **NEW / not covered by prior inspection** — `supabase/functions/token-purchase/index.ts` refund settlement (line 2076) | `credit` → `credit_refund` | `refund_reference` present (but neither `promoted_by` nor `repaired_by`) |

Live UPDATE writer #3 is functionally analogous to #1/#2: it takes a
skeletal `credit` row (auto-written by `atomic_token_credit` during the
refund debit) and promotes it in place to the canonical `credit_refund`
settlement row, keyed by unique `request_id = refund_reference`. It
does not mutate any protected balance/identity column, but:

- it uses a **different terminal `action_type`** (`credit_refund`, not
  `credit_purchase`), and
- it uses a **different metadata marker** (`refund_reference`, not
  `promoted_by` / `repaired_by`).

The J1 allowlist as authorised by the client would block it.

No live DELETE or UPSERT writer found on `token_ledger` outside the two
historical one-shot migrations (20260418155054 seed-cleanup, 20260503202233
D-01 test cleanup) — both are already-run migrations, not live code.

## What was done and undone this turn

1. **Migration installed** (`20260701211537_3c89fa33-160c-427e-8ce0-f64ecf45d915.sql`):
   - `public.assert_token_ledger_append_only()` (`plpgsql`, `SECURITY
     DEFINER`, `SET search_path = public`) blocking DELETE and
     requiring `credit → credit_purchase` promotion with
     `promoted_by`/`repaired_by` marker;
   - `token_ledger_append_only_trg BEFORE UPDATE OR DELETE ON
     public.token_ledger FOR EACH ROW`.
2. **Static guard authored and executed** — it detected live UPDATE
   writer #3 above and failed.
3. **Migration rolled back** (`20260701211810_*`) via
   `DROP TRIGGER IF EXISTS token_ledger_append_only_trg` +
   `DROP FUNCTION IF EXISTS public.assert_token_ledger_append_only()`.
4. Draft guard script and SQL proof deleted (they will be re-emitted
   once the allowlist covers all three legitimate paths).

Current DB state: **no J1 trigger, no J1 function present.** Batch B1
`token_ledger_no_truncate_trg` is untouched and still in place. RLS,
grants, policies, ownership, indexes, constraints unchanged.

## Explicit non-changes

- ❌ No RLS / grant / policy / FORCE RLS / ownership change.
- ❌ No change to `atomic_paid_credit_purchase`,
  `repair_skeletal_paid_credit`, `atomic_token_credit`,
  `atomic_token_burn`, or the refund path.
- ❌ No token balance, token amount, credit, or refund mutated.
- ❌ No edge function deployed.
- ❌ No email, notification, or provider call.
- ❌ No customer-visible behaviour change.
- ❌ Item #67 settlement mismatch behaviour untouched.
- ❌ Batch B1 truncate guard untouched.

## Recommended next step (client decision needed)

Choose the shape of the widened allowlist before re-applying J1:

**Option A — extend the allowlist to a second promotion transition:**
allow `credit → credit_refund` when the row carries
`refund_reference` in metadata (and, symmetrically, unchanged
protected columns). Rationale: mirrors #1/#2, keeps refund path
working, still blocks arbitrary edits and all DELETE. Suggested new
status on approval: `ITEM_35_TOKEN_LEDGER_ALLOWLIST_INCLUDES_REFUND_PROMOTION_APPROVED`.

**Option B — refactor first, then apply:** move the refund promotion
into a `SECURITY DEFINER` RPC that stamps
`promoted_by = 'refund_settlement'` (or `repaired_by`) into metadata so
the current authorised allowlist suffices without a widening decision.
Higher touch on live refund code — not recommended without a separate
approval since refunds are strict-scope out.

**Option C — leave J1 deferred** until refund automation policy (also
deferred under item #67) is decided, then apply both together.

No apply should proceed until one of the above is authorised.
