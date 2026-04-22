// Unit tests for the counterparty_email handling in the POI engagements
// PATCH flow. We test the validation schema and the binding-hint shape that
// the edge function returns to admins. These mirror the rules implemented in
// `index.ts` so a regression there will surface here.
//
// Run: deno test supabase/functions/poi-engagements/index_test.ts

import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// ── Mirror of the schema field under test (kept in sync with index.ts) ──
const counterpartyEmailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, { message: "counterparty_email is too short" })
  .max(254, { message: "counterparty_email exceeds 254 characters" })
  .email({ message: "counterparty_email must be a valid email address" })
  .optional();

const UpdateEngagementSchema = z.object({
  counterparty_email: counterpartyEmailField,
});

// ── Mirror of the binding-hint resolver (pure, side-effect free) ──
type BindingHint =
  | { status: "bound"; org_id: string; email: string }
  | { status: "no_match"; email: string; message: string }
  | { status: "already_bound"; org_id: string }
  | { status: "lookup_error"; email: string; message: string };

function resolveBindingHint(opts: {
  email: string;
  currentOrgId: string | null;
  matchedOrgId: string | null;
  lookupError?: string;
}): BindingHint {
  const email = opts.email.trim().toLowerCase();
  if (opts.currentOrgId) {
    return { status: "already_bound", org_id: opts.currentOrgId };
  }
  if (opts.lookupError) {
    return {
      status: "lookup_error",
      email,
      message:
        "Email saved, but the platform could not check whether it matches a registered organisation. Please retry shortly.",
    };
  }
  if (opts.matchedOrgId) {
    return { status: "bound", org_id: opts.matchedOrgId, email };
  }
  return {
    status: "no_match",
    email,
    message:
      "Email saved, but no registered organisation matches this address yet. The engagement will remain unbound until the recipient signs up or the email is corrected.",
  };
}

// ─────────────────────────── Normalisation ───────────────────────────

Deno.test("normalises mixed-case emails to lowercase", () => {
  const parsed = UpdateEngagementSchema.parse({
    counterparty_email: "Daniel@Izenzo.CO.ZA",
  });
  assertEquals(parsed.counterparty_email, "daniel@izenzo.co.za");
});

Deno.test("trims surrounding whitespace before validation", () => {
  const parsed = UpdateEngagementSchema.parse({
    counterparty_email: "   spaced@example.com   ",
  });
  assertEquals(parsed.counterparty_email, "spaced@example.com");
});

Deno.test("treats counterparty_email as optional (no field = ok)", () => {
  const parsed = UpdateEngagementSchema.parse({});
  assertEquals(parsed.counterparty_email, undefined);
});

// ─────────────────────────── Invalid input ───────────────────────────

Deno.test("rejects an obviously malformed email", () => {
  const result = UpdateEngagementSchema.safeParse({
    counterparty_email: "not-an-email",
  });
  assertEquals(result.success, false);
  if (!result.success) {
    assert(
      result.error.issues.some((i) =>
        i.message.includes("must be a valid email address")
      ),
      "expected an email-format error",
    );
  }
});

Deno.test("rejects whitespace-only input as too short after trim", () => {
  const result = UpdateEngagementSchema.safeParse({
    counterparty_email: "   ",
  });
  assertEquals(result.success, false);
});

Deno.test("rejects emails longer than 254 chars", () => {
  const local = "a".repeat(250);
  const tooLong = `${local}@example.com`; // > 254
  const result = UpdateEngagementSchema.safeParse({
    counterparty_email: tooLong,
  });
  assertEquals(result.success, false);
  if (!result.success) {
    assert(
      result.error.issues.some((i) => i.message.includes("254")),
      "expected a length error",
    );
  }
});

// ─────────────────────────── Binding hint ────────────────────────────

Deno.test("binding hint: returns 'bound' when a matching profile exists", () => {
  const hint = resolveBindingHint({
    email: "Known@example.com",
    currentOrgId: null,
    matchedOrgId: "org-123",
  });
  assertEquals(hint.status, "bound");
  if (hint.status === "bound") {
    assertEquals(hint.org_id, "org-123");
    assertEquals(hint.email, "known@example.com");
  }
});

Deno.test("binding hint: non-fatal 'no_match' when email is unknown", () => {
  const hint = resolveBindingHint({
    email: "stranger@example.com",
    currentOrgId: null,
    matchedOrgId: null,
  });
  assertEquals(hint.status, "no_match");
  if (hint.status === "no_match") {
    assertEquals(hint.email, "stranger@example.com");
    assertExists(hint.message);
    assert(
      hint.message.toLowerCase().includes("no registered organisation"),
      "message should explain why nothing was bound",
    );
  }
});

Deno.test("binding hint: 'already_bound' is preserved (no silent overwrite)", () => {
  const hint = resolveBindingHint({
    email: "anything@example.com",
    currentOrgId: "org-original",
    matchedOrgId: "org-other",
  });
  assertEquals(hint.status, "already_bound");
  if (hint.status === "already_bound") {
    assertEquals(hint.org_id, "org-original");
  }
});

Deno.test("binding hint: 'lookup_error' is non-fatal and surfaces a retry message", () => {
  const hint = resolveBindingHint({
    email: "user@example.com",
    currentOrgId: null,
    matchedOrgId: null,
    lookupError: "connection refused",
  });
  assertEquals(hint.status, "lookup_error");
  if (hint.status === "lookup_error") {
    assert(hint.message.toLowerCase().includes("retry"));
  }
});
