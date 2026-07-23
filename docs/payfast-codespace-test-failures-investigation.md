# PayFast Codespace Test Failures — Investigation Report

Branch: `investigate/payfast-codespace-failures` (from `main`)
Scope: investigate only the 3 PayFast test failures observed in the Codespace broader-regression run during the Paystack admin-only hardening work (PR #28). This branch does not touch PR #28, does not touch Paystack, and does not touch main.

## Summary

Of the 3 failing tests, 2 were caused by stale test assertions that encoded an incorrect assumption about PayFast's wire protocol, and 1 was caused by a genuine security-relevant defect in the ITN signature verification fallback. All 3 are now fixed. No PayFast customer-facing behavior, checkout flow, wallet/ledger crediting, or idempotency logic was changed. One small, additive defensive check was added to a signature-verification helper.

## Failing tests, exact failure messages, and root cause

### 1. `src/tests/payfast-checkout-phase-2c.test.ts`
> Phase 2C: successful sandbox initiation > response includes signed checkoutUrl + form fields

Original failure:
```
AssertionError: expected [ Array(13) ] to not include 'merchant_key'
  - Array(13)
+ "merchant_key"
```

Root cause: STALE TEST. The test asserted `merchant_key` must never appear in the checkout response's form fields. This is incorrect: PayFast's own protocol requires `merchant_key` (alongside `merchant_id`) as a submitted form field so PayFast can identify the merchant account when the browser posts the checkout form. Only the merchant passphrase is a private signing secret that must never be transmitted. The live-checkout implementation (`payfast-live-checkout.ts`, the production twin of this sandbox path) documents this exact distinction in its own comment: "The merchant_key is required as a form field by PayFast itself, but the passphrase is NEVER surfaced." The sandbox implementation already behaved correctly and consistently with the live implementation; only the test's assumption was wrong.

### 2. `src/tests/payfast-phase-2c-no-regression.test.ts`
> Phase 2C: PayFast remains NOT live, Paystack untouched > helper strips merchant_key from the returned form fields

Original failure:
```
AssertionError: expected '/**\n * PayFast sandbox checkout init…' to match /k !== "merchant_key"/
```

Root cause: STALE TEST (same incorrect assumption as #1, expressed as a source-text regex check). The test expected to find a filter excluding `merchant_key` from the field list. No such filter exists, or should exist, in the source — see #1.

### 3. `src/tests/payfast-itn-phase-2b.test.ts`
> processPayfastItn — signature, IP, validate failures > rejects an ITN whose signature does not verify

Original failure:
```
AssertionError: expected 'credited' to be 'rejected'
```

Root cause: REAL PRODUCT DEFECT (signature-verification bypass). `processPayfastItn` verifies the ITN signature two ways: (a) reconstruct the signature from the parsed, ordered field list (`verifyPayfastSignature`), and (b) if that fails, fall back to `verifyPayfastSignatureFromRawBody`, which re-derives the signature directly from the raw POST body text to avoid PHP/JS re-encoding drift. The ITN is only rejected if **both** checks fail.

The test tampers with a valid ITN body by appending `&extra=tampered` after the `signature` field. Check (a) correctly fails, because the appended field changes the reconstructed field set. However, `verifyPayfastSignatureFromRawBody` located the `&signature=` marker via `rawBody.lastIndexOf("&signature=")` and used everything **before** that marker as the signed payload — but never verified that nothing meaningful followed the signature value. Since the tampered suffix (`&extra=tampered`) comes *after* `&signature=`, it was silently discarded by the fallback's own slicing logic, so the fallback recomputed the exact same (valid) signature and reported a match. The OR-like `!sigOkReconstructed && !sigOkRaw` rejection condition therefore did not trigger, and the tampered ITN was accepted and credited.

This is a genuine gap: any data appended after the `signature` field in a PayFast ITN POST body bypassed the raw-body fallback's tamper detection. In practice, `fieldsToRecord` uses "first occurrence wins" semantics, so an attacker cannot override an already-present field's value by duplicating its key later in the body. However, the raw-body fallback bypass is still a real defect in the tamper-detection guarantee documented by the fallback's own code comment ("Used as a fallback when the reconstructed-from-parsed-fields signature does not match" — implying it should still authenticate the same data, not silently accept appended data).

## Fix applied (production code — minimal, additive)

File: `supabase/functions/_shared/payments/payfast.ts`, function `verifyPayfastSignatureFromRawBody`.

Added a defensive check: after locating the `&signature=` marker, the function now verifies that the remainder of the raw body from that point on is *exactly* `&signature=<value>` with nothing appended after it. If anything follows the signature value, the function returns `false` instead of silently ignoring the trailing data. This closes the append-after-signature bypass while leaving the encoding-drift-tolerant behavior for genuinely untampered bodies completely unchanged.

No other production code was touched. PayFast checkout initiation, the primary (`verifyPayfastSignature`) signature check, replay/idempotency protection, wallet/ledger crediting, and all Paystack code are unmodified.

## Fix applied (test code)

- `src/tests/payfast-checkout-phase-2c.test.ts`: updated the stale assertion to expect `merchant_key` to be present (required by PayFast) while continuing to assert `passphrase` is never present.
- `src/tests/payfast-phase-2c-no-regression.test.ts`: replaced the stale "helper strips merchant_key" regex check with a correct pair of checks — the helper source must never contain a `["passphrase"` field tuple, and must build `formFields` from `signed.fields`. No behavioral/runtime code was changed by this test update, only the test's expectations.

## Commands run and results

```
npx vitest run src/tests/payfast-checkout-phase-2c.test.ts src/tests/payfast-itn-phase-2b.test.ts src/tests/payfast-phase-2c-no-regression.test.ts
→ 3 test files, 52 tests, all passing

npx vitest run src/tests
→ 500 test files, 7809 tests: 476 files / 7770 tests passed, 23 files / 37 tests failed, 2 skipped
→ grep across the full run for any failing file containing "payfast" (case-insensitive): zero matches
```

The 23 failing files / 37 failing tests in the full run are entirely unrelated to PayFast or Paystack (registry/company search partial-match, notification reminders/unsubscribe classification, batch isolation stages, screening/audit hardening, public-api counterparty lookups). These are pre-existing failures in unrelated areas of the codebase and are out of scope for this investigation; they were not modified, hidden, or otherwise touched by this branch.

Syntax of the changed production file was validated with `npx tsc --noEmit --skipLibCheck`, which reported only one pre-existing, unrelated error (`URLSearchParams` iteration target warning) that was confirmed via `git stash`/`git stash pop` to be present identically before this change.

## Whether production code changed

Yes — one small, additive, defensive check inside `verifyPayfastSignatureFromRawBody` (see above). No other production code changed.

## Whether test code changed

Yes — two test files updated to correct stale assertions (see above). No test was skipped or weakened to force a pass; both updated assertions are stricter or equally strict about the real security invariant (passphrase must never be returned) while correcting the false assumption about `merchant_key`.

## Recommendation

- Merge this fix independently of PR #28 (Paystack admin-only hardening), which this branch does not touch.
- Because this fix closes a real signature-tamper-detection bypass in the PayFast ITN webhook handler, a reviewer with payment/security context should review the diff in `payfast.ts` before merging, even though the change is small and the full regression suite (aside from the pre-existing, unrelated failures documented above) is green.
- No controlled live PayFast ITN test is necessary before merging; the fix is covered by the existing unit test that reproduced the bypass, which now passes.
