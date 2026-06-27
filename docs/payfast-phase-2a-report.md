# PayFast Integration — Phase 2A Report

**Phase:** 2A — Database / provider-identity hardening
**Status:** Complete
**Live provider:** Paystack (unchanged, sole active provider)
**PayFast live surface introduced:** None

---

## 1. Goal recap

Give the `token_purchases` table a provider-agnostic identity slot so a future
PayFast settlement can land cleanly without overloading `paystack_reference`
and without changing any Paystack behaviour.

No PayFast checkout button, no PayFast ITN route, no PayFast secret, no FX
revival. Paystack must remain the only active provider after this phase.

---

## 2. Migration

**File:** `supabase/migrations/20260627115024_a48f929d-2549-4513-afed-91a2da238578.sql`

**Tables changed:** `public.token_purchases`

**Columns added (both nullable):**
- `provider TEXT` — `paystack` | `payfast`
- `provider_reference TEXT` — provider-native opaque reference

**Constraints added:**
- `token_purchases_provider_known_chk` —
  `CHECK (provider IS NULL OR provider IN ('paystack','payfast'))`

**Indexes added:**
- `token_purchases_provider_reference_uidx` — partial UNIQUE on
  `(provider, provider_reference)` where both are NOT NULL.
  This is the duplicate-credit guard PayFast will rely on.
- `idx_token_purchases_provider` — non-unique secondary index for admin /
  reconciliation lookups.

**Indexes preserved (unchanged):**
- `token_purchases_paystack_reference_key` — UNIQUE on `paystack_reference`
  (the historical Paystack idempotency guard).
- `idx_token_purchases_status_created`, `idx_token_purchases_org`.

**Backfill (verified):**
```
total                 4
has_paystack_ref      4
has_provider          4
has_provider_ref      4
paystack_aligned      4    (provider='paystack' AND provider_reference = paystack_reference)
unbackfilled          0
```
Every historical row carries `provider='paystack'` and
`provider_reference = paystack_reference`. Metadata-sourced values
(`metadata->>'provider'`, `metadata->>'provider_reference'`) are preserved
where present, before the Paystack-default fallback runs.

**Nullable decision:** `provider` and `provider_reference` remain nullable.
Forcing NOT NULL is unsafe because the table can in principle carry rows
with no `paystack_reference` (e.g. very old free-credit / fixture rows).
The CHECK constraint guarantees that any non-NULL value is a known
provider id, and the partial unique index covers duplicate-credit
protection wherever both values are present. Recommend re-evaluating
NOT NULL after Phase 2B (PayFast sandbox) once write paths for every
new row are confirmed.

**RLS / GRANTs:** No change. The existing row-level access rules and
GRANTs on `token_purchases` continue to apply.

---

## 3. Code changes

### Writes (Paystack initiation now also writes provider identity)
- `supabase/functions/token-purchase/index.ts` — the `token_purchases`
  pending insert now additionally writes:
  - `provider: "paystack"`
  - `provider_reference: paystackData.data.reference`
  - `metadata.provider` and `metadata.provider_reference`
  `paystack_reference` continues to be written (column preserved).

### Reads
- `supabase/functions/list-org-purchases/index.ts` — both `SELECT`
  projections now include `provider, provider_reference` alongside the
  historical `paystack_reference`.
- `src/components/desk/billing/PurchasesList.tsx` — `PurchaseRow` type
  carries optional `provider` / `provider_reference`. The rendered
  reference uses:
  ```ts
  display_reference = p.provider_reference || p.paystack_reference
  ```
  with a hover title that exposes the provider id. Historical Paystack
  rows continue to render correctly.

### Helpers
- `supabase/functions/_shared/payments/reference.ts` (Phase 1) already
  exposes `buildProviderMetadata`, `readProviderReference`, and
  `readProviderId`. Phase 2A keeps the live Paystack write path inline
  (no behavioural rewrite) but the helper is in place for PayFast (2B+).

### Edge-function deployment
- Both modified edge functions (`token-purchase`, `list-org-purchases`)
  must be redeployed for the additional columns to be written. No new
  routes are exposed.

---

## 4. Refund / dispute compatibility

Inspected:
- `refund_requests` / `request_refund` RPC — keys refunds by
  `token_purchase_id`, not by any provider-native reference. Adding
  `provider` / `provider_reference` does not alter refund eligibility
  or settlement classification.
- `transaction-reconciliation` edge function — still resolves rows by
  `paystack_reference`. Unchanged in Phase 2A; will be revisited in
  Phase 2B to add a PayFast-aware branch driven by `provider`.
- `payment_disputes` / chargeback flow — unaffected.

PayFast future-readiness shape is in place: PayFast rows will write
`provider='payfast'` and `provider_reference=<m_payment_id>` into the
same columns. Admin refund / dispute views can already render a
generic reference via the fallback expression above.

---

## 5. Tests

**Added:** `src/tests/payfast-phase-2a-provider-identity.test.ts` — 20 tests
covering:
- migration adds the two columns
- migration backfills `provider_reference` from `paystack_reference`
- migration backfills `provider='paystack'` for legacy Paystack rows
- migration preserves `metadata.provider` / `metadata.provider_reference`
- partial unique index on `(provider, provider_reference)` exists
- CHECK constraint restricts `provider` to known ids (NULL allowed)
- no migration drops/renames/weakens `paystack_reference` or its UNIQUE
- token-purchase still writes `paystack_reference`
- token-purchase additionally writes `provider='paystack'` + `provider_reference`
- token-purchase metadata also carries provider / provider_reference
- USD settlement preserved, no FX import revived
- list-org-purchases selects the new columns in both projections
- PurchasesList uses `provider_reference || paystack_reference` fallback
- PurchasesList still surfaces `paystack_reference` for legacy rows
- no PayFast secret read in live payment functions
- no `payfast-itn` / `payfast-webhook` route exposed
- no PayFast call-to-action rendered in PurchasesList

**Adjusted:** `src/tests/batch-c-payment-idempotency.test.ts` — bumped the
character budget in the pending-row insert regex from 400 → 900 to
accommodate the additional `provider` / `provider_reference` / extended
`metadata` fields. The asserted behaviour (insert keyed on
`paystack_reference`, status `pending`, tolerant of duplicate-key
retries) is unchanged.

**Tests run (payment-suite only):**
```
src/tests/batch-c-payment-idempotency.test.ts                    23 passed
src/tests/payments-paystack-no-regression-phase1.test.ts         15 passed
src/tests/payments-provider-abstraction-phase1.test.ts           13 passed
src/tests/payfast-phase-2a-provider-identity.test.ts             20 passed
src/tests/paystack-webhook-missing-metadata-containment.test.ts   8 passed
src/tests/payment-reconciliation-credit-trail-parity.test.ts     21 passed
src/tests/payment-metadata-recovery-payfast-ready.test.ts        15 passed
src/tests/purchases-list-resolved-refunds.test.tsx                1 passed
                                                          ────────────────
                                                                116 passed
```

**Full suite:** 6860 / 6879 pass. The 19 unrelated failures are
pre-existing in compliance / screening / fixture surfaces (e.g.
`p5-screening-phase-6-memory-audit`, `cp-fixtures-admin-ui-proof`,
`audit-ledger-copy-capability-guard`) and are not touched by Phase 2A.

---

## 6. Duplicate-webhook-receiver report

The smaller `paystack-webhook` shim (HMAC verify → forward to
`token-purchase/webhook`) is **untouched** in Phase 2A. No
duplicate-receiver consolidation happened. Expected and confirmed.

---

## 7. Boundary confirmations

| Constraint                                                      | Confirmed |
|-----------------------------------------------------------------|-----------|
| Paystack remains the only active payment provider               | Yes       |
| `paystack_reference` column preserved                            | Yes       |
| `paystack_reference` UNIQUE index preserved                      | Yes       |
| No PayFast checkout button / call-to-action exposed              | Yes       |
| No `payfast-itn` / `payfast-webhook` route exposed               | Yes       |
| No PayFast secret touched / required                             | Yes       |
| No FX conversion code revived (`_shared/fx.ts` not imported)     | Yes       |
| Phase 1 provider-abstraction tests still green                   | Yes (28)  |
| Existing payment regression tests still green                    | Yes       |

---

## 8. Recommendation for Phase 2B

Phase 2B should be **PayFast sandbox ITN only** — still with no live
customer button:

1. Add `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`
   (sandbox) via the secrets tool. No live keys yet.
2. New edge function `payfast-itn` that:
   - validates the PayFast signature (MD5 over sorted fields + passphrase),
   - validates the post-back via PayFast's
     `https://sandbox.payfast.co.za/eng/query/validate` round-trip,
   - dedupes via `webhook_replay_guard` keyed on `pf_payment_id`,
   - resolves the matching `token_purchases` row by
     `(provider='payfast', provider_reference=m_payment_id)`,
   - credits via the existing `atomic_paid_credit_purchase` RPC.
3. A `payfast-initiate` function that creates a pending
   `token_purchases` row with `provider='payfast'`,
   `provider_reference=<generated m_payment_id>`, status `pending`,
   `currency='ZAR'`, and returns a sandbox checkout redirect — gated
   behind an internal feature flag so no customer can reach it.
4. Tests:
   - PayFast signature verification (positive + tampered).
   - PayFast ITN post-back validation (mocked).
   - Replay guard rejects duplicate `pf_payment_id`.
   - Credit allocation runs through `atomic_paid_credit_purchase`.
   - Partial unique index blocks duplicate
     `(payfast, pf_payment_id)` writes.
   - Paystack flow still works unchanged.
5. Reconciliation: extend `transaction-reconciliation` with a
   PayFast-aware branch driven by `provider`, calling PayFast's
   `query/fetch` endpoint instead of Paystack `verify`.

Phase 2B must not expose a customer-facing PayFast button. That is
Phase 2C (post sandbox sign-off).
