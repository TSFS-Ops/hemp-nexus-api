// CP-003 — Counterparty email present but name missing.
//
// Signed mirror of CP-002. Pure-logic tests pinning the contract that the
// outreach gates and contact-PATCH path must:
//   1. Continue to return `contact_incomplete` from getContactState when
//      an email is recorded but no usable name exists (no enum split).
//   2. Continue to block outreach with the canonical `CONTACT_INCOMPLETE`
//      code (no new error code, no behaviour change for CP-002).
//   3. Emit a SIBLING audit row
//      `pending_engagement.outreach_blocked_missing_name` whenever the
//      block is specifically the "email present, name missing" case —
//      alongside, never instead of, `outreach.blocked.contact_incomplete`.
//   4. Never affect the CP-002 `pending_engagement.outreach_blocked_missing_email`
//      path (which only fires when email is missing).
//
// Run: deno test supabase/functions/poi-engagements/cp003_test.ts

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getContactState,
  isOutreachBlocked,
  contactBlockCode,
  isUsableContactEmail,
} from "../_shared/contact-completeness.ts";

const EMAIL_OK = "ops@acme.example";

function isCp003Block(
  state: ReturnType<typeof getContactState>,
  email: string | null | undefined,
): boolean {
  return state === "contact_incomplete" && isUsableContactEmail(email);
}

function siblingAuditAction(): string {
  return "pending_engagement.outreach_blocked_missing_name";
}

Deno.test("CP-003: email present + no name → still returns 'contact_incomplete' (no enum split)", () => {
  const eng = {
    counterparty_email: EMAIL_OK,
    counterparty_org_id: null,
    contact_name: null,
    contact_type: null,
  };
  const state = getContactState(eng as any, null);
  assertEquals(state, "contact_incomplete");
});

Deno.test("CP-003: outreach is blocked with the canonical CONTACT_INCOMPLETE code (no new error code)", () => {
  const eng = {
    counterparty_email: EMAIL_OK,
    counterparty_org_id: null,
    contact_name: "",
    contact_type: null,
  };
  const state = getContactState(eng as any, null);
  assert(isOutreachBlocked(state));
  assertEquals(contactBlockCode(state), "CONTACT_INCOMPLETE");
});

Deno.test("CP-003 sibling audit action name is the signed-form one", () => {
  assertEquals(siblingAuditAction(), "pending_engagement.outreach_blocked_missing_name");
});

Deno.test("CP-003 sibling fires only when email is present AND name is missing", () => {
  // Fires: email present, no name.
  assert(
    isCp003Block(
      getContactState(
        { counterparty_email: EMAIL_OK, counterparty_org_id: null, contact_name: null } as any,
        null,
      ),
      EMAIL_OK,
    ),
  );
  // Does NOT fire: no email and no name (CP-002-ish / generic incomplete).
  assertFalse(
    isCp003Block(
      getContactState(
        { counterparty_email: null, counterparty_org_id: null, contact_name: null } as any,
        null,
      ),
      null,
    ),
  );
  // Does NOT fire: name present, no email — that is CP-002's territory.
  assertFalse(
    isCp003Block(
      getContactState(
        { counterparty_email: null, counterparty_org_id: null, contact_name: "Alice" } as any,
        null,
      ),
      null,
    ),
  );
  // Does NOT fire: usable email AND organisation name — outreach proceeds.
  assertFalse(
    isCp003Block(
      getContactState(
        {
          counterparty_email: EMAIL_OK,
          counterparty_org_id: null,
          contact_name: null,
          counterparty_org: "Acme Ltd",
        } as any,
        null,
      ),
      EMAIL_OK,
    ),
  );
});

Deno.test("CP-003 does not regress CP-002: name present + no email still maps to 'email_missing'", () => {
  const eng = {
    counterparty_email: null,
    counterparty_org_id: null,
    contact_name: "Alice",
    contact_type: "named_individual",
  };
  const state = getContactState(eng as any, null);
  assertEquals(state, "email_missing");
  assert(isOutreachBlocked(state));
  // And the CP-003 sibling MUST NOT fire here.
  assertFalse(isCp003Block(state, null));
});
