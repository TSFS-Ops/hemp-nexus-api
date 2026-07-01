# Batch J3 — Auth email suppression split approach (tracker item #22)

**Status:** `BATCH_J3_AUTH_EMAIL_SUPPRESSION_SPLIT_APPROACH_DEPLOYED_PENDING_VERIFICATION`

## Client / product decision
- Security-critical account emails may still reach suppressed recipients
  **with a clear disclaimer** (password reset/recovery, email change,
  re-authentication, account security).
- Less-critical auth emails (signup, invite, magic-link) must remain
  **suppressed** when the recipient is on `suppressed_emails`.

## Pre-apply template mapping
Discovered auth template names in `auth-email-hook` and DLQ label set:

| Template            | Category            | Disposition when suppressed |
| ------------------- | ------------------- | --------------------------- |
| `recovery`          | security-critical   | `send_with_disclaimer`      |
| `email_change`      | security-critical   | `send_with_disclaimer`      |
| `reauthentication`  | security-critical   | `send_with_disclaimer`      |
| `signup`            | non-critical        | `suppress`                  |
| `invite`            | non-critical        | `suppress`                  |
| `magiclink`         | non-critical        | `suppress`                  |

Template names verified against `EMAIL_TEMPLATES` in
`supabase/functions/auth-email-hook/index.ts` and `AUTH_TEMPLATE_LABELS`
in `supabase/functions/process-email-queue/index.ts`.

## Files changed
- `supabase/functions/_shared/auth-email-suppression.ts` (new) —
  single source of truth for classification + evaluator + disclaimer.
- `supabase/functions/auth-email-hook/index.ts` — pre-enqueue suppression
  gate; disclaimer injected in the security-critical suppressed path;
  audit + risk observability for both branches.
- `supabase/functions/process-email-queue/index.ts` — defense-in-depth
  pre-provider gate; drops suppressed non-critical auth messages from
  the queue via `delete_email` (no DLQ, no provider call); injects
  disclaimer if the security-critical suppressed message slipped past
  the hook.
- `src/tests/batch-j3-auth-email-suppression-split.test.ts` (new) —
  static contract tests, source-scan only.
- `src/tests/batch-h-email-reliability.test.ts` — updated the deferred
  guard to point at the Batch J3 shared helper.

## Behaviour before / after

**Before:**
- `auth-email-hook` enqueued every auth email regardless of suppression.
- `process-email-queue` called `sendLovableEmail` regardless of
  suppression for auth queue messages.
- Suppressed recipients could receive signup/invite/magiclink emails
  from queue producers, and there was no disclaimer on account-security
  emails delivered to suppressed addresses.

**After:**
- Suppressed **non-critical** auth email: never enqueued (hook) or
  deleted from queue (worker); `email_send_log.status = 'suppressed'`;
  `audit_logs.action = email.auth_suppressed`;
  `admin_risk_items.kind = auth_email_to_suppressed_recipient`.
- Suppressed **security-critical** auth email: enqueued/sent with a
  short disclaimer prepended to html + text;
  `audit_logs.action = email.auth_security_sent_with_disclaimer`;
  `admin_risk_items.kind = auth_email_to_suppressed_recipient`
  (severity: `low`).
- Non-suppressed auth email: unchanged behaviour.
- Non-auth transactional email: unchanged — still handled by
  `send-transactional-email`.

## Disclaimer copy
> "This is an essential account-security email. You are receiving it
> even though this address is suppressed or unsubscribed because it
> relates to access or security for your Izenzo account."

Only injected on the `send_with_disclaimer` path. Idempotent — a second
pass does not double-add it.

## Tests / guards run
- `bunx vitest run src/tests/batch-j3-auth-email-suppression-split.test.ts` — **18 passed**.
- `bunx vitest run src/tests/batch-h-email-reliability.test.ts` — **21 passed** (Batch H #18/#47 assertions unchanged, deferred guard rewired to J3).

## Confirmation
- No real emails sent. All tests are static file-content scans; no
  provider imports were exercised at runtime.
- No `suppressed_emails` rows mutated. No `email_unsubscribe_tokens`
  rows mutated. Both files only read `suppressed_emails` via `SELECT`;
  static tests assert this negative.
- Batch H (#18 auth DLQ observability, #47 SEND_TIMEOUT_MS) preserved
  and verified by the Batch H suite.
- No changes to: payment, token ledger, refunds, WaD, POI, storage,
  legal holds, lifecycle, reconciliation, cron, RLS, grants, policies,
  or any pending verification items.
- `send-transactional-email` untouched — its Batch M suppression path
  continues to govern non-auth mail.

Deployed edge functions: `auth-email-hook`, `process-email-queue`.

**Final status:** `BATCH_J3_AUTH_EMAIL_SUPPRESSION_SPLIT_APPROACH_DEPLOYED_PENDING_VERIFICATION`
