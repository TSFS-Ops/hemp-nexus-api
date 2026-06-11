/**
 * Static guard test for the AI Outreach Drafter Phase 1 decision endpoint.
 *
 * Same Phase 1 contract as the generator: no dispatch references, no send
 * action, admin-only, illegal transitions return 409, audit trail covers
 * edit / approve / reject / access_denied.
 */
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

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

Deno.test("decision endpoint contains no dispatch references", () => {
  const lower = SOURCE.toLowerCase();
  for (const term of FORBIDDEN) {
    assert(!lower.includes(term), `Forbidden dispatch reference found: ${term}`);
  }
});

Deno.test("decision endpoint never invokes an email-shaped edge function", () => {
  const re = /functions\.invoke\(\s*["'`][^"'`]*email[^"'`]*["'`]/i;
  assert(!re.test(SOURCE), "Forbidden functions.invoke(...email...) call found");
});

Deno.test("decision endpoint supports edit / approve / reject only", () => {
  assertStringIncludes(SOURCE, '"edit"');
  assertStringIncludes(SOURCE, '"approve"');
  assertStringIncludes(SOURCE, '"reject"');
  // No send-style actions
  assert(!/\b['"]send['"]\s*[:,)\]]/.test(SOURCE), "send action must not exist");
  assert(!/\b['"]send_requested['"]/.test(SOURCE), "send_requested must not exist");
});

Deno.test("decision endpoint blocks illegal transitions with 409", () => {
  assertStringIncludes(SOURCE, "ILLEGAL_TRANSITION");
  assertStringIncludes(SOURCE, "409");
});

Deno.test("decision endpoint enforces admin gate and writes access_denied", () => {
  assertStringIncludes(SOURCE, 'rpc("is_admin"');
  assertStringIncludes(SOURCE, "engagement.outreach_draft.access_denied");
});

Deno.test("decision endpoint writes the Phase 1 audit vocabulary", () => {
  assertStringIncludes(SOURCE, "engagement.outreach_draft.edited");
  assertStringIncludes(SOURCE, "engagement.outreach_draft.approved");
  assertStringIncludes(SOURCE, "engagement.outreach_draft.rejected");
});

Deno.test("approved draft note explicitly states manual-send-only", () => {
  assertStringIncludes(SOURCE, "Approved — manual send required. No automated dispatch is wired.");
});
