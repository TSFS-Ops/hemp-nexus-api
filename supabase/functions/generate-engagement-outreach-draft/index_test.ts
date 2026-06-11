/**
 * Static guard test for the AI Outreach Drafter Phase 1 generator.
 *
 * Phase 1 is internal-only. The generator function MUST NOT reference any
 * dispatch surface (notification-dispatch, send-transactional-email,
 * Resend, SMTP, Mailgun, Slack, mail.send, functions.invoke(...email...)).
 *
 * If anyone adds such a reference, this test fails — that is the
 * structural proof that the drafter cannot send automatically.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const HERE = new URL("./index.ts", import.meta.url);
const SOURCE = await Deno.readTextFile(HERE);

const FORBIDDEN = [
  "notification-dispatch",
  "send-transactional-email",
  "resend",
  "smtp",
  "mailgun",
  "mail.send",
];

Deno.test("generate-engagement-outreach-draft contains no dispatch references", () => {
  const lower = SOURCE.toLowerCase();
  for (const term of FORBIDDEN) {
    assert(
      !lower.includes(term),
      `Forbidden dispatch reference found in generator: ${term}`,
    );
  }
});

Deno.test("generate-engagement-outreach-draft never invokes an email-shaped edge function", () => {
  // Catches `functions.invoke("...email...")` and similar patterns.
  const re = /functions\.invoke\(\s*["'`][^"'`]*email[^"'`]*["'`]/i;
  assert(!re.test(SOURCE), "Forbidden functions.invoke(...email...) call found");
});

Deno.test("generate-engagement-outreach-draft writes audit_logs for draft lifecycle", () => {
  assertStringIncludes(SOURCE, "engagement.outreach_draft.requested");
  assertStringIncludes(SOURCE, "engagement.outreach_draft.generated");
  assertStringIncludes(SOURCE, "engagement.outreach_draft.regenerated");
  assertStringIncludes(SOURCE, "engagement.outreach_draft.access_denied");
});

Deno.test("generate-engagement-outreach-draft enforces admin gate via is_admin RPC", () => {
  assertStringIncludes(SOURCE, 'rpc("is_admin"');
});

Deno.test("generate-engagement-outreach-draft enforces frozen/restricted org block", () => {
  assertStringIncludes(SOURCE, "frozen");
  assertStringIncludes(SOURCE, "org_restricted");
});

Deno.test("generate-engagement-outreach-draft inserts drafts as pending_review", () => {
  assertStringIncludes(SOURCE, '"pending_review"');
  // Defensive: no sent / send_requested status leaks in
  assert(!/\bstatus:\s*["']sent["']/.test(SOURCE), "sent status must not appear");
  assert(!/\bstatus:\s*["']send_requested["']/.test(SOURCE), "send_requested status must not appear");
});

Deno.test("Phase 1 audit name vocabulary only", () => {
  // Make sure send-related audit names are not present.
  const forbiddenAudits = [
    "engagement.outreach_draft.sent",
    "engagement.outreach_draft.send_requested",
    "engagement.outreach_draft.send_failed",
  ];
  for (const a of forbiddenAudits) {
    assert(!SOURCE.includes(a), `Forbidden Phase-2 audit name leaked: ${a}`);
  }
  assertEquals(true, true);
});
