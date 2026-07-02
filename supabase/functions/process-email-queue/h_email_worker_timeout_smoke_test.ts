// Cluster B — Local smoke tests for tracker item #47 (Batch H email worker
// send timeout) and confirmation that Batch H #18 DLQ observability wiring
// is preserved.
//
// Scope:
//   • Runtime coverage of the send-timeout race pattern used by
//     `process-email-queue` (SEND_TIMEOUT_MS, SendTimeoutError, marker
//     string, non-swallowed non-timeout errors, timer cleanup).
//   • Source-scan wiring guards proving the production edge function
//     uses the same pattern and preserves Batch H #18 DLQ observability
//     (email.dead_lettered audit + auth_email_dead_lettered risk item).
//
// No provider call, no real Supabase client, no email sent, no DB
// mutation. Fetch tripwire fails any test that unexpectedly hits the
// network.

import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

// -----------------------------------------------------------------------
// Fetch tripwire.
// -----------------------------------------------------------------------
const realFetch = globalThis.fetch
let fetchCalls = 0
globalThis.fetch = ((..._args: unknown[]) => {
  fetchCalls++
  throw new Error('fetch tripwire: unexpected outbound network call in H smoke test')
}) as typeof fetch

// -----------------------------------------------------------------------
// Recreate the exact race pattern from
// supabase/functions/process-email-queue/index.ts so we can exercise it
// at runtime without importing the edge function (which pulls in
// npm:@lovable.dev/email-js). A source-scan test below asserts the
// production file still uses this pattern verbatim.
// -----------------------------------------------------------------------
const SEND_TIMEOUT_MS = 20_000
const SEND_TIMEOUT_MARKER = 'send_timeout'

class SendTimeoutError extends Error {
  constructor() {
    super(SEND_TIMEOUT_MARKER)
    this.name = 'SendTimeoutError'
  }
}

function withSendTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SendTimeoutError()), ms) as unknown as number
  })
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  }) as Promise<T>
}

// -----------------------------------------------------------------------
// #47 — timeout marker constants are exactly what error_message will
// carry into email_send_log and infra-alerts Check 18.
// -----------------------------------------------------------------------
Deno.test('#47 SEND_TIMEOUT_MS is strictly less than pgmq visibility timeout (30s)', () => {
  assert(SEND_TIMEOUT_MS < 30_000, 'timeout must be < pgmq VT to prevent duplicate sends')
  assert(SEND_TIMEOUT_MS > 0)
})

Deno.test('#47 SendTimeoutError message equals send_timeout marker verbatim', () => {
  const err = new SendTimeoutError()
  assertEquals(err.message, SEND_TIMEOUT_MARKER)
  assertEquals(err.message, 'send_timeout')
})

// -----------------------------------------------------------------------
// #47 — runtime behaviour: hung provider send is bounded, does NOT hang
// the worker, and rejects with SendTimeoutError carrying 'send_timeout'.
// -----------------------------------------------------------------------
Deno.test('#47 hung provider send is bounded by withSendTimeout and rejects with send_timeout', async () => {
  const before = fetchCalls
  // Simulate a hung provider: a promise that never resolves.
  const hung = new Promise<string>(() => { /* never settles */ })
  const started = Date.now()
  const err = await assertRejects(
    () => withSendTimeout(hung, 25), // short deadline so the test is fast
    SendTimeoutError,
  )
  const elapsed = Date.now() - started
  assertEquals(err.message, 'send_timeout')
  assert(elapsed < 500, `worker must not hang past deadline, elapsed=${elapsed}ms`)
  assertEquals(fetchCalls, before, 'no real network call must occur')
})

// -----------------------------------------------------------------------
// #47 — a fast successful send resolves normally and cancels the timer,
// so a duplicate send cannot be triggered by a stale setTimeout.
// -----------------------------------------------------------------------
Deno.test('#47 fast provider send resolves and clears the timeout timer', async () => {
  const fast = Promise.resolve({ id: 'msg_1' })
  const result = await withSendTimeout(fast, 25)
  assertEquals((result as { id: string }).id, 'msg_1')
  // Wait longer than the (now-cancelled) timeout deadline and prove no
  // rejection surfaces.
  await new Promise((r) => setTimeout(r, 50))
})

// -----------------------------------------------------------------------
// #47 — a non-timeout provider error is NOT swallowed by the race and
// falls through to the caller's existing failed-insert path.
// -----------------------------------------------------------------------
Deno.test('#47 non-timeout provider error propagates unchanged (not marked send_timeout)', async () => {
  const failing = Promise.reject(new Error('rate_limited'))
  const err = await assertRejects(() => withSendTimeout(failing, 100), Error)
  assertEquals(err.message, 'rate_limited')
  assert(!(err instanceof SendTimeoutError))
})

// -----------------------------------------------------------------------
// Source-scan wiring guards — production edge function preserves the
// pattern above and the Batch H #18 DLQ observability contract.
// -----------------------------------------------------------------------
async function readSrc(rel: string): Promise<string> {
  const url = new URL(rel, import.meta.url)
  return await Deno.readTextFile(url)
}

Deno.test('#47 process-email-queue uses withSendTimeout(sendLovableEmail(...), SEND_TIMEOUT_MS)', async () => {
  const src = await readSrc('./index.ts')
  assertStringIncludes(src, 'const SEND_TIMEOUT_MS = 20_000')
  assertStringIncludes(src, "const SEND_TIMEOUT_MARKER = 'send_timeout'")
  assertStringIncludes(src, 'class SendTimeoutError')
  assertStringIncludes(src, 'super(SEND_TIMEOUT_MARKER)')
  assert(/withSendTimeout\(\s*sendLovableEmail\(/.test(src), 'sendLovableEmail must be wrapped by withSendTimeout')
  assert(/SEND_TIMEOUT_MS\s*\)/.test(src), 'withSendTimeout must be called with SEND_TIMEOUT_MS')
})

Deno.test('#18 process-email-queue preserves DLQ observability (audit + admin_risk_items)', async () => {
  const src = await readSrc('./index.ts')
  // email.dead_lettered audit row
  assertStringIncludes(src, "action: 'email.dead_lettered'")
  // Auth-critical DLQ risk marker
  assertStringIncludes(src, "kind: 'auth_email_dead_lettered'")
  // Idempotency guards
  assertStringIncludes(src, 'alreadyAudited')
  assertStringIncludes(src, 'alreadyRisked')
  // Recipient masking — no full address ever written to metadata
  assertStringIncludes(src, 'maskEmail(')
  assertStringIncludes(src, 'recipient_email_masked')
  // Existing DLQ path preserved (email_send_log + pgmq move_to_dlq rpc)
  assertStringIncludes(src, "status: 'dlq'")
  assertStringIncludes(src, "rpc('move_to_dlq'")
  // Observability failure is non-fatal
  assert(/try\s*\{[\s\S]*email\.dead_lettered[\s\S]*catch\s*\(obsErr\)/.test(src), 'DLQ observability must be try/catch wrapped')
})

Deno.test('#18 infra-alerts still exposes Auth Email Dead-Letter + Email Send Timeout windows', async () => {
  const src = await readSrc('../infra-alerts/index.ts')
  assertStringIncludes(src, 'Auth Email Dead-Letter (1 hr)')
  assertStringIncludes(src, 'Email Send Timeout (1 hr)')
  assertStringIncludes(src, "'send_timeout'")
})

Deno.test('H tripwire: no unexpected fetch calls occurred', () => {
  assertEquals(fetchCalls, 0, 'no fetch call should have occurred in the H suite')
  globalThis.fetch = realFetch
})
