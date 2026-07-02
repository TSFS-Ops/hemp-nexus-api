# token-purchase Batch I1/I2 local handler smoke test

Status: `TOKEN_PURCHASE_I1_I2_LOCAL_SMOKE_TEST_COMPLETE`

## Scope

Tests only. No production runtime behaviour was changed, no test seam
was added to `supabase/functions/token-purchase/index.ts`, no
migrations were applied, no functions were deployed, no secrets or
config were altered, no payments initiated, no PayFast/provider calls
made, no credits/tokens/ledger/audit/risk/event rows mutated in
production, no emails or notifications sent.

## Test seam decision

**No seam added.** The Batch I1/I2 observability contracts under test
live in `supabase/functions/_shared/payment-observability.ts`, whose
helpers already accept an injected admin client (typed `any`) — a
first-class dependency-injection surface. The existing vitest guards
in `src/tests/batch-i1-payment-observability.test.ts` (18 tests) and
`src/tests/batch-i2-verify-path-audit-parity.test.ts` (13 tests)
already prove that `token-purchase/index.ts` wires these helpers into
the correct call sites (missing-secret, invalid-signature,
verify-path post-credit audit/event/notification). Adding a runtime
seam to the 2 822-line monolith to re-prove that same wiring would
have been a behaviour-touching change on a live payment function,
which the scope guidance explicitly deprecates.

The new Deno test therefore drives the helpers with an in-memory stub
client and asserts the runtime side of the contract: exact audit
`action`, risk `kind`, `severity`, `dedup_key`, dedup-window
behaviour, and fire-and-forget error swallowing.

## File added

- `supabase/functions/token-purchase/i1_i2_handler_smoke_test.ts`
  (11 Deno tests; ~400 lines).

## Paths exercised

| Test | Contract | I1/I2 item |
|---|---|---|
| `recordProviderSecretMissing` writes correct audit + critical risk (checkout source) | `audit_logs.action='payment.provider_secret_missing'` + `admin_risk_items.kind='paystack_secret_missing'` (severity `critical`), dedup key `paystack_secret_missing:token-purchase` | #56 |
| Same helper emits webhook-source variant with distinct dedup key | Dedup key `paystack_secret_missing:token-purchase/webhook` | #56 |
| Dedup window suppresses duplicate risk inserts (audit still writes) | Second call within 1h → audit written, risk skipped | #56 |
| Audit insert failure is swallowed | `safeAudit` catches, helper does not throw, caller stays on its own status code | #56 |
| `recordWebhookSignatureInvalid` emits audit action, no risk item | `audit_logs.action='payment.webhook_signature_invalid'`; no `admin_risk_items` write by contract | #78 |
| HMAC-SHA512 signature check rejects mismatched signature (mirrors handler primitive) | Reproduces the exact Web Crypto primitive at index.ts:1077 with different keys → digests differ; same key + body → deterministic | #78 |
| `recordVerifyPostCreditAuditFailed` writes audit + high risk (does not throw) | `payment.verify_post_credit_audit_failed`, kind `payment_verify_post_credit_audit_failed`, severity `high`, dedup key `<kind>:<reference>` | #61 |
| `recordVerifyPostCreditEventFailed` writes audit + high risk (does not throw) | `payment.verify_post_credit_event_failed`, kind `payment_verify_post_credit_event_failed`, severity `high`, dedup key `<kind>:<reference>` | #61 |
| `recordVerifyRevenueNotificationFailed` writes audit + medium risk (does not throw) | `payment.verify_revenue_notification_failed`, kind `payment_verify_revenue_notification_failed`, severity `medium`, dedup key `<kind>:<reference>` | #61 |
| Verify helpers swallow their own audit failure so caller stays 200 to customer | All three helpers, with audit insert throwing → no upward throw | #61 |
| `recordLedgerLabelRepairFailed` marks balance-untouched, high severity | `payment.ledger_label_repair_failed`, audit metadata `note='balances are not changed by this repair path'`, kind severity `high` | I1 residual |

## Stub strategy

- **`makeStubAdmin({ dedupHit?, throwOnInsertTable? })`** — in-memory
  builder that records `.from(table).insert(row)` and the dedup-lookup
  chain `.select().eq().eq().gte().limit().maybeSingle()`. No DB.
- **`installFetchTripwire()`** — replaces `globalThis.fetch` with a
  function that throws on any call. Every test asserts `fetchCalls.length === 0`.
- All arguments (`orgId`, `reference`, `packageId`) are synthetic
  literals. No secrets are read.

## Side-effect confirmation

- **Network:** fetch tripwire installed in every test; no outbound
  request permitted or attempted.
- **Provider:** no import of `../_shared/provider-fetch.ts`; no
  Paystack URL constructed.
- **Supabase client:** no `createClient` call; helpers receive the
  stub `{ from(table) }` object.
- **Credit RPC:** `atomic_paid_credit_purchase` / `atomic_token_credit`
  / `atomic_token_burn` never referenced.
- **Ledger / balance / token / org / profile:** no writes possible —
  stub records inserts only in memory.
- **Emails / notifications:** `emitRevenueNotification` never invoked;
  we only assert that its *failure path* helper writes the correct
  markers when it would have thrown.
- **Handler runtime:** `token-purchase/index.ts` is not imported or
  invoked in the new test file.

## Commands run

```
supabase test edge functions --functions token-purchase
→ 11 passed | 0 failed (32 ms)

bunx vitest run \
  src/tests/batch-i1-payment-observability.test.ts \
  src/tests/batch-i2-verify-path-audit-parity.test.ts
→ 2 files, 31 passed (31)
```

`supabase/functions/_shared/payment-atomicity_test.ts` was inspected
and left untouched — it is a source-level guard suite covering the
paid-path RPC surface, orthogonal to Batch I1/I2 observability, and
already passing in the existing pipeline.

## Recommended status per tracker item

| # | Prior | New | Ceiling requires |
|---|---|---|---|
| #56 | `DEPLOYED_PENDING_VERIFICATION` (deploy caveat cleared → `DEPLOYED_AND_STATIC_GUARDED`) | **`DEPLOYED_AND_LOCAL_SMOKE_TESTED`** | Natural production missing-secret event (rare; monitor `payment.provider_secret_missing` audit action) |
| #78 | `DEPLOYED_PENDING_VERIFICATION` (→ `DEPLOYED_AND_STATIC_GUARDED`) | **`DEPLOYED_AND_LOCAL_SMOKE_TESTED`** | Natural production invalid-signature event (monitor `payment.webhook_signature_invalid` audit action) |
| #61 | `DEPLOYED_PENDING_VERIFICATION` (→ `DEPLOYED_AND_STATIC_GUARDED`) | **`DEPLOYED_AND_LOCAL_SMOKE_TESTED`** for the three failure branches; happy verify path remains `DEPLOYED_PENDING_NATURAL_RUNTIME_EVENT` | Natural production verify-path invocation to confirm the `payment.event_created` write with `source_function='token-purchase/verify'` occurs on success |

The failure-branch contracts for #61 (audit failure, event-write
failure, notification failure) are now closed at
`DEPLOYED_AND_LOCAL_SMOKE_TESTED`. True `CLOSED_RUNTIME_CONFIRMED`
still requires a real production verify event and remains explicitly
out of scope for this pass.

## Final status

`TOKEN_PURCHASE_I1_I2_LOCAL_SMOKE_TEST_COMPLETE`
