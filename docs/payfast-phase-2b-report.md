# PayFast Integration — Phase 2B Report

**Status:** Sandbox ITN foundation complete. PayFast is **NOT** customer-facing live. Paystack remains the only active customer-facing payment provider.

## Files created

| Path | Purpose |
| --- | --- |
| `supabase/functions/_shared/payments/payfast.ts` | Pure helpers (PHP urlencode, ordered form parser, MD5 signature build/verify, status map, IP allowlist, validate post-back wrapper) **and** the testable `processPayfastItn` orchestrator. |
| `supabase/functions/payfast-itn/index.ts` | Thin Deno entry point. Injects real Supabase service client, real `defaultPayfastValidatePostback`, real client IP. Always returns HTTP 200 to PayFast (except `405` method-not-allowed). |
| `src/tests/payfast-helpers-phase-2b.test.ts` | 24 unit tests: signature build/verify (with & without passphrase), tampered amount, PHP urlencode parity, ordered form parser, status map, reference extraction, IP allowlist, validate URLs. |
| `src/tests/payfast-itn-phase-2b.test.ts` | 22 integration tests against an in-memory mock Supabase: credit-once, no-double-credit on replay, amount/currency/package mismatch, FAILED, CANCELLED, PENDING, unknown status, validate INVALID/timeout/network, invalid IP, missing purchase, missing reference, missing/invalid signature, method gating, empty body. |
| `src/tests/payfast-phase-2b-no-regression.test.ts` | 16 source-text guards: Paystack inline behaviour unchanged, no PayFast checkout button anywhere, PayFast unregistered in `select.ts`, `PAYFAST_PROVIDER.liveEnabled === false`, no FX revival, no PAYSTACK_ secret leak. |

## Files changed

None of Paystack's runtime files were modified. The only change outside new files is a comment update in `supabase/functions/_shared/payments/select.ts` (Phase 2B context note); `payfast` remains `undefined` in the registry so any "live customer-facing provider" lookup still throws.

## Tests run

```
src/tests/payfast-helpers-phase-2b.test.ts                 24 passed
src/tests/payfast-itn-phase-2b.test.ts                     22 passed
src/tests/payfast-phase-2b-no-regression.test.ts           16 passed
src/tests/payments-paystack-no-regression-phase1.test.ts   passed
src/tests/payments-provider-abstraction-phase1.test.ts     passed
src/tests/payfast-phase-2a-provider-identity.test.ts       passed
```

Total **110/110** across all payments/PayFast phases. The full project vitest run reports 14 pre-existing failures in unrelated suites (CP fixture admin UI proofs, P5 screening memory/audit, audit-ledger copy guard, NOT-010 notification, public-api V1 counterparty summary). None touch payments, Paystack, PayFast, provider abstraction, ledger, wallet, or reconciliation code.

## Confirmations

- **Paystack unchanged.** `token-purchase/index.ts` and `paystack-webhook/index.ts` still use `PAYSTACK_SECRET_KEY`, settle in USD (`fx_basis: "native_usd"`), credit via `atomic_paid_credit_purchase`, verify webhooks with HMAC-SHA512. No imports from `_shared/payments/payfast.ts`. No PAYFAST_ secrets referenced.
- **No customer-facing PayFast checkout.** No initiation route, no `payfast` button, no `selectProvider("payfast")` callsite in product code. The no-regression test enumerates every file in the repo that mentions "payfast" and asserts the set is limited to the shared module, the ITN edge function, the Phase 2A audit references, and the generated types.
- **PayFast is not live.** `PAYFAST_PROVIDER.liveEnabled === false`. `select.ts` keeps `payfast: undefined` in the live registry. The ITN entry point hard-defaults `PAYFAST_MODE` to `sandbox` and only opts in to `live` on explicit `=== "live"`.
- **No secrets touched.** PAYFAST_PASSPHRASE / PAYFAST_ALLOWED_IPS / PAYFAST_SANDBOX_SKIP_IP_CHECK / PAYFAST_MODE are read by the entry point only and all default to safe values. No secret is required for tests; the helpers and orchestrator have zero env reads.
- **No FX revival.** `payfast.ts` does not import `_shared/fx.ts`. ZAR is the only currency for PayFast. The amount comparison is in ZAR cents against `purchase.metadata.price_zar`.
- **`paystack_reference` is preserved.** Phase 2A's `provider`/`provider_reference` columns are the lookup keys; `paystack_reference` is untouched and stays the canonical Paystack column.

## Signature verification (PayFast)

PayFast's signature is computed over the ITN form fields in their **POST-order**, PHP-`urlencode`d (spaces → `+`, uppercase hex, `!'()*` percent-encoded), joined `k=v&…`, optionally suffixed with `&passphrase=<encoded>`, then MD5 lowercase-hex. Implementation: `buildPayfastSignature` / `verifyPayfastSignature` in `payfast.ts`. `parseFormEncodedOrdered` preserves the original POST order so verification matches PayFast's server-side computation. Verification is constant-time-ish (length check + xor diff accumulator).

## Validate post-back

`defaultPayfastValidatePostback` posts the raw ITN body back to PayFast's sandbox or live validate endpoint with an 8s `AbortController` timeout. It returns a discriminated union — `{ok: true, raw: "VALID"}` / `{ok: false, reason: "invalid" | "timeout" | "network_error" | "unexpected_response"}`. Tests inject mocks; production injects the real wrapper. The orchestrator never credits when validate fails for any reason and always raises a high-severity `admin_risk_items` row.

## Source-IP handling

`isAllowedPayfastIp` is a strict membership check against an explicit allowlist. The ITN entry point reads the list from `PAYFAST_ALLOWED_IPS` (comma-separated). A `PAYFAST_SANDBOX_SKIP_IP_CHECK=true` env flag exists for sandbox only — the entry point ignores it unless `PAYFAST_MODE === "sandbox"`, and production deploys MUST NOT set it. Before live cutover (Phase 2C/2D) the entry point must additionally resolve PayFast's published source hostnames (`www.payfast.co.za`, `w1w.payfast.co.za`, `w2w.payfast.co.za`, `sandbox.payfast.co.za`) to A-records with caching, and merge those into the allowlist. The pure helper makes this a one-line composition change in the entry point with no orchestrator changes.

## Replay / idempotency handling

Two layers:

1. **Webhook replay guard.** The orchestrator inserts `(source='payfast_itn_<mode>', signature_hash=SHA256(signature))` into `webhook_replay_guard`. The unique index raises `23505` on duplicates, which we translate to a `replay_detected` rejection. No credit attempted on replay.
2. **Atomic RPC idempotency.** `atomic_paid_credit_purchase` is idempotent on `p_reference_id` via the partial UNIQUE index on `token_ledger.request_id`. The credit reference passed in is `pf_payment_id` when present (PayFast's stable settlement id) else `m_payment_id` — chosen so two ITNs for the same settlement always resolve to the same ledger row. Documented in `extractPayfastProviderReference`. Even if the replay guard were defeated, the RPC would return `already_credited=true` and no second ledger row is written.

## Phase 2C recommendation

Phase 2C should be **sandbox checkout initiation** behind a strict admin/test flag:

1. New `payfast-init` edge function (admin-only, JWT-required) that creates a `pending` `token_purchases` row (`provider='payfast'`, `provider_reference=<m_payment_id>`, `currency='ZAR'`, `metadata.price_zar=<zar>`) and returns a signed redirect to PayFast sandbox.
2. Tighten the source-IP allowlist (DNS-resolve PayFast's published hostnames + cache + tests).
3. Provider selector UI change behind a feature flag — still no live `liveEnabled` flip.
4. End-to-end Playwright walkthrough in sandbox: init → PayFast sandbox → ITN → wallet credited.

Refunds (Phase 2D) and live cutover (Phase 2E) remain explicitly out of scope until 2C is signed off.
