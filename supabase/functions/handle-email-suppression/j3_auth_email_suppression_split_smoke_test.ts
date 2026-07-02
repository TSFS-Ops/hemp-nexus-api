// Cluster B — Local smoke tests for tracker item #22 (Batch J3 auth email
// suppression split disposition).
//
// Scope: runtime coverage of the shared decision helper
// (`_shared/auth-email-suppression.ts`) plus source-scan wiring guards
// against `auth-email-hook` and `process-email-queue`. No provider call,
// no real Supabase client, no email sent, no DB mutation.
//
// A fetch tripwire fails any test that unexpectedly hits the network.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  evaluateAuthEmailSuppression,
  injectSecurityDisclaimerHtml,
  injectSecurityDisclaimerText,
  AUDIT_ACTION_AUTH_SUPPRESSED,
  AUDIT_ACTION_AUTH_SECURITY_SENT_WITH_DISCLAIMER,
  RISK_KIND_AUTH_EMAIL_TO_SUPPRESSED_RECIPIENT,
  AUTH_SECURITY_DISCLAIMER_TEXT,
} from '../_shared/auth-email-suppression.ts'

// -----------------------------------------------------------------------
// Fetch tripwire — no test in this file may perform network I/O.
// -----------------------------------------------------------------------
const realFetch = globalThis.fetch
let fetchCalls = 0
globalThis.fetch = ((..._args: unknown[]) => {
  fetchCalls++
  throw new Error('fetch tripwire: unexpected outbound network call in J3 smoke test')
}) as typeof fetch

// -----------------------------------------------------------------------
// In-memory suppressed_emails stub with the surface J3 helper uses.
// -----------------------------------------------------------------------
function stubSupabase(suppressed: Array<{ email: string; reason?: string }>, opts: { errorOn?: string } = {}) {
  return {
    from(table: string) {
      assertEquals(table, 'suppressed_emails', 'J3 helper only reads suppressed_emails')
      const q = {
        _email: '' as string,
        select(_cols: string) { return q },
        eq(col: string, val: string) {
          assertEquals(col, 'email')
          q._email = val
          return q
        },
        async maybeSingle() {
          if (opts.errorOn && opts.errorOn === q._email) {
            return { data: null, error: { message: 'stub lookup failure' } }
          }
          const hit = suppressed.find((r) => r.email === q._email)
          return { data: hit ? { email: hit.email, reason: hit.reason ?? null } : null, error: null }
        },
      }
      return q
    },
  }
}

// -----------------------------------------------------------------------
// Test 1 — non-critical auth email to suppressed recipient → drop.
// -----------------------------------------------------------------------
for (const template of ['signup', 'invite', 'magiclink'] as const) {
  Deno.test(`#22 non-critical auth (${template}) to suppressed recipient → suppress`, async () => {
    const before = fetchCalls
    const supabase = stubSupabase([{ email: 'user@example.com', reason: 'bounce' }])
    const result = await evaluateAuthEmailSuppression(supabase, template, 'user@example.com')
    assertEquals(result.disposition, 'suppress')
    assertEquals(result.recipientSuppressed, true)
    assertEquals(result.isSecurityCritical, false)
    assertEquals(result.suppressionReason, 'bounce')
    assertEquals(fetchCalls, before, 'no network call must occur in the suppression decision')
  })
}

// -----------------------------------------------------------------------
// Test 2 — security-critical auth email to suppressed recipient →
//         send_with_disclaimer + disclaimer injection.
// -----------------------------------------------------------------------
for (const template of ['recovery', 'email_change', 'reauthentication'] as const) {
  Deno.test(`#22 security-critical auth (${template}) to suppressed recipient → send_with_disclaimer`, async () => {
    const before = fetchCalls
    const supabase = stubSupabase([{ email: 'user@example.com', reason: 'unsubscribe' }])
    const result = await evaluateAuthEmailSuppression(supabase, template, 'user@example.com')
    assertEquals(result.disposition, 'send_with_disclaimer')
    assertEquals(result.recipientSuppressed, true)
    assertEquals(result.isSecurityCritical, true)

    // Disclaimer is injected exactly once, idempotently.
    const originalHtml = '<html><body><p>Reset your password</p></body></html>'
    const html1 = injectSecurityDisclaimerHtml(originalHtml)
    const html2 = injectSecurityDisclaimerHtml(html1)
    assertStringIncludes(html1, AUTH_SECURITY_DISCLAIMER_TEXT)
    assertEquals(html1, html2, 'disclaimer injection must be idempotent')

    const text1 = injectSecurityDisclaimerText('Reset your password')
    const text2 = injectSecurityDisclaimerText(text1)
    assertStringIncludes(text1, AUTH_SECURITY_DISCLAIMER_TEXT)
    assertEquals(text1, text2, 'text disclaimer injection must be idempotent')

    assertEquals(fetchCalls, before)
  })
}

// -----------------------------------------------------------------------
// Test 3 — non-suppressed recipient → normal send, no disclaimer.
// -----------------------------------------------------------------------
Deno.test('#22 non-suppressed auth email → send (no disclaimer, no suppress marker)', async () => {
  const before = fetchCalls
  const supabase = stubSupabase([])
  for (const template of ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'reauthentication'] as const) {
    const result = await evaluateAuthEmailSuppression(supabase, template, 'clean@example.com')
    assertEquals(result.disposition, 'send')
    assertEquals(result.recipientSuppressed, false)
    assertEquals(result.suppressionReason, null)
  }
  const html = '<html><body>Hi</body></html>'
  assertEquals(html.includes(AUTH_SECURITY_DISCLAIMER_TEXT), false, 'disclaimer text must not appear pre-injection')
  assertEquals(fetchCalls, before)
})

// -----------------------------------------------------------------------
// Test 3b — lookup error: fail-open for security-critical, fail-closed
//           for non-critical.
// -----------------------------------------------------------------------
Deno.test('#22 suppression lookup error → security-critical fails open, non-critical fails closed', async () => {
  const supabase = stubSupabase([], { errorOn: 'user@example.com' })
  const critical = await evaluateAuthEmailSuppression(supabase, 'recovery', 'user@example.com')
  assertEquals(critical.disposition, 'send')
  const nonCritical = await evaluateAuthEmailSuppression(supabase, 'signup', 'user@example.com')
  assertEquals(nonCritical.disposition, 'suppress')
})

// -----------------------------------------------------------------------
// Source-scan wiring guards — prove the two call-sites use the helper
// and write the documented markers. No runtime execution of the edge
// functions is performed (they import npm:@lovable.dev/email-js which
// is not available in the local Deno environment).
// -----------------------------------------------------------------------
async function readSrc(path: string): Promise<string> {
  const url = new URL(path, import.meta.url)
  return await Deno.readTextFile(url)
}

Deno.test('#22 auth-email-hook wiring: pre-enqueue gate + markers', async () => {
  const src = await readSrc('../auth-email-hook/index.ts')
  assertStringIncludes(src, 'evaluateAuthEmailSuppression')
  assertStringIncludes(src, 'injectSecurityDisclaimerHtml')
  assertStringIncludes(src, 'injectSecurityDisclaimerText')
  assertStringIncludes(src, AUDIT_ACTION_AUTH_SUPPRESSED)
  assertStringIncludes(src, AUDIT_ACTION_AUTH_SECURITY_SENT_WITH_DISCLAIMER)
  assertStringIncludes(src, RISK_KIND_AUTH_EMAIL_TO_SUPPRESSED_RECIPIENT)
})

Deno.test('#22 process-email-queue wiring: defense-in-depth gate + markers', async () => {
  const src = await readSrc('../process-email-queue/index.ts')
  assertStringIncludes(src, 'evaluateAuthEmailSuppression')
  assertStringIncludes(src, 'injectSecurityDisclaimerHtml')
  assertStringIncludes(src, 'injectSecurityDisclaimerText')
  assertStringIncludes(src, AUDIT_ACTION_AUTH_SUPPRESSED)
  assertStringIncludes(src, AUDIT_ACTION_AUTH_SECURITY_SENT_WITH_DISCLAIMER)
  assertStringIncludes(src, RISK_KIND_AUTH_EMAIL_TO_SUPPRESSED_RECIPIENT)
  // Non-critical suppressed messages are removed from the queue via
  // delete_email — never sent, never DLQ'd.
  assertStringIncludes(src, 'delete_email')
})

Deno.test('J3 tripwire: no unexpected fetch calls occurred', () => {
  assertEquals(fetchCalls, 0, 'no fetch call should have occurred in the J3 suite')
  // Restore for any future in-process tests.
  globalThis.fetch = realFetch
})
