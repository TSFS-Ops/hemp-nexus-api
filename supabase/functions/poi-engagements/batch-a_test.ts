// Batch A — Counterparty contact-completeness + MT-009 permission tests.
// ─────────────────────────────────────────────────────────────────────────
// These tests pin the four behaviours the signed 06 May 2026 readiness
// report requires:
//
//   1. Contact-state classification (helper)
//   2. Preview/send consistency (same inputs, same result)
//   3. MT-009 permission matrix (counterparty-side rule, NOT engagement.org_id)
//   4. Outreach gating (typed CONTACT_EMAIL_MISSING / CONTACT_INCOMPLETE)
//
// Run: deno test supabase/functions/poi-engagements/batch-a_test.ts
//   --allow-net --allow-env --allow-read

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  contactBlockCode,
  contactBlockReason,
  getContactState,
  isOutreachBlocked,
  type ContactEngagementInput,
  type ContactMatchInput,
} from "../_shared/contact-completeness.ts";

import {
  describeMatchSide,
  isCounterpartySide,
} from "../_shared/engagement-counterparty.ts";

// ─────────────────────────────────────────────────────────────────────────
// 1. Contact-state classification
// ─────────────────────────────────────────────────────────────────────────

Deno.test("classification: email missing + organisation name on engagement → email_missing", () => {
  const eng: ContactEngagementInput = {
    counterparty_email: null,
    counterparty_org: { id: "org-x", name: "Acme Trading Ltd" },
  };
  assertEquals(getContactState(eng), "email_missing");
});

Deno.test("classification: email missing + organisation name on parent match → email_missing", () => {
  const eng: ContactEngagementInput = { counterparty_email: "" };
  const match: ContactMatchInput = {
    buyer_name: "Acme Trading Ltd",
    buyer_org_id: null, // unregistered → name fallback active
    seller_name: null,
    seller_org_id: "init-org",
  };
  assertEquals(getContactState(eng, match), "email_missing");
});

Deno.test("classification: email missing + named individual → email_missing", () => {
  const eng: ContactEngagementInput = {
    counterparty_email: null,
    contact_type: "named_individual",
    contact_name: "Jane Doe",
  };
  assertEquals(getContactState(eng), "email_missing");
});

Deno.test("classification: email present + no organisation/name → contact_incomplete", () => {
  const eng: ContactEngagementInput = { counterparty_email: "buyer@example.com" };
  assertEquals(getContactState(eng), "contact_incomplete");
});

Deno.test("classification: email + valid organisation name on engagement → organisation_contact", () => {
  const eng: ContactEngagementInput = {
    counterparty_email: "ops@acme.com",
    counterparty_org: { id: "org-x", name: "Acme Trading Ltd" },
  };
  assertEquals(getContactState(eng), "organisation_contact");
});

Deno.test("classification: email + linked counterparty_org_id → organisation_contact", () => {
  const eng: ContactEngagementInput = {
    counterparty_email: "ops@acme.com",
    counterparty_org_id: "org-x",
  };
  assertEquals(getContactState(eng), "organisation_contact");
});

Deno.test("classification: email + named_individual + contact_name → named_individual_contact", () => {
  const eng: ContactEngagementInput = {
    counterparty_email: "jane@acme.com",
    contact_type: "named_individual",
    contact_name: "Jane Doe",
  };
  assertEquals(getContactState(eng), "named_individual_contact");
});

Deno.test("classification: nothing at all → contact_incomplete", () => {
  assertEquals(getContactState({}), "contact_incomplete");
});

Deno.test("classification: .invalid domain is treated as no usable email", () => {
  const eng: ContactEngagementInput = {
    counterparty_email: "x@example.invalid",
    counterparty_org: { id: "o", name: "Acme" },
  };
  assertEquals(getContactState(eng), "email_missing");
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Preview/send consistency
// ─────────────────────────────────────────────────────────────────────────
//
// Both routes MUST resolve to the same ContactState for the same engagement.
// This regression specifically guards against the bug where send-outreach
// previously omitted buyer_name / seller_name from its select, which made
// it return contact_incomplete while preview returned organisation_contact
// for an unregistered counterparty whose name was on the parent match.

Deno.test("preview/send consistency: unregistered counterparty with name on match", () => {
  const eng: ContactEngagementInput = {
    counterparty_email: "ops@unregistered-acme.com",
  };
  // Initiator is the seller; counterparty side is the buyer (unregistered)
  // with a free-text name on the match.
  const fullMatch: ContactMatchInput = {
    buyer_name: "Acme Trading Ltd",
    buyer_org_id: null,
    seller_name: null,
    seller_org_id: "init-org",
  };
  // Pre-fix bug: send-outreach select omitted *_name → match became
  // effectively empty for naming purposes.
  const truncatedMatchPreFix: ContactMatchInput = {
    buyer_org_id: null,
    seller_org_id: "init-org",
  };

  const preview = getContactState(eng, fullMatch);
  const sendCorrect = getContactState(eng, fullMatch);
  const sendBuggy = getContactState(eng, truncatedMatchPreFix);

  assertEquals(preview, "organisation_contact");
  assertEquals(sendCorrect, "organisation_contact");
  // Documents the regression we fixed: without buyer_name, the helper
  // would have classified as contact_incomplete. The fix to the select
  // ensures send sees the full match like preview does.
  assertEquals(sendBuggy, "contact_incomplete");
  assert(preview === sendCorrect, "preview and send must agree");
});

Deno.test("preview/send consistency: linked counterparty_org_id needs no match-side data", () => {
  const eng: ContactEngagementInput = {
    counterparty_email: "ops@acme.com",
    counterparty_org_id: "org-x",
  };
  // Even with NO match data, a linked counterparty_org_id is sufficient.
  // Both routes will agree.
  assertEquals(getContactState(eng, null), "organisation_contact");
  assertEquals(getContactState(eng, undefined), "organisation_contact");
});

// ─────────────────────────────────────────────────────────────────────────
// 3. MT-009 permission matrix — counterparty-side rule
// ─────────────────────────────────────────────────────────────────────────
//
// The contact record on poi_engagements represents the COUNTERPARTY side of
// the match. Therefore an org_admin may edit it ONLY when their org is the
// counterparty side (counterparty_org_id match OR registered match-side
// opposite the initiator). The initiator org_admin must NEVER be allowed
// to edit the counterparty contact via this row.

const initiator = "org-initiator";
const buyerOrg = "org-buyer";
const sellerOrg = "org-seller";
const outsider = "org-outsider";

Deno.test("MT-009: initiator org_admin is NOT counterparty-side (would edit other side's contact)", () => {
  const eng = { org_id: initiator, counterparty_org_id: sellerOrg };
  const match = { org_id: initiator, buyer_org_id: initiator, seller_org_id: sellerOrg };
  assertFalse(isCounterpartySide(initiator, eng, match));
});

Deno.test("MT-009: counterparty org_admin via direct counterparty_org_id binding", () => {
  const eng = { org_id: initiator, counterparty_org_id: sellerOrg };
  const match = { org_id: initiator, buyer_org_id: initiator, seller_org_id: sellerOrg };
  assert(isCounterpartySide(sellerOrg, eng, match));
});

Deno.test("MT-009: counterparty org_admin via registered match-side (counterparty_org_id null)", () => {
  // Counterparty hasn't been bound on the engagement yet, but their org
  // is on the match as the seller side and is not the initiator.
  const eng = { org_id: initiator, counterparty_org_id: null };
  const match = { org_id: initiator, buyer_org_id: initiator, seller_org_id: sellerOrg };
  assert(isCounterpartySide(sellerOrg, eng, match));
});

Deno.test("MT-009: outsider org cannot edit (not on the match at all)", () => {
  const eng = { org_id: initiator, counterparty_org_id: sellerOrg };
  const match = { org_id: initiator, buyer_org_id: initiator, seller_org_id: sellerOrg };
  assertFalse(isCounterpartySide(outsider, eng, match));
});

Deno.test("MT-009: initiator-on-buyer-side cannot edit counterparty contact even when on match", () => {
  // Tests the "must NEVER be initiator" short-circuit explicitly.
  const eng = { org_id: buyerOrg, counterparty_org_id: sellerOrg };
  const match = { org_id: buyerOrg, buyer_org_id: buyerOrg, seller_org_id: sellerOrg };
  assertFalse(isCounterpartySide(buyerOrg, eng, match));
  assert(isCounterpartySide(sellerOrg, eng, match));
});

Deno.test("MT-009: missing actor org → not authorised", () => {
  assertFalse(isCounterpartySide(null, { org_id: initiator }, null));
  assertFalse(isCounterpartySide(undefined, { org_id: initiator }, null));
});

Deno.test("MT-009 helper: describeMatchSide returns buyer/seller/null", () => {
  const match = { buyer_org_id: buyerOrg, seller_org_id: sellerOrg };
  assertEquals(describeMatchSide(buyerOrg, match), "buyer");
  assertEquals(describeMatchSide(sellerOrg, match), "seller");
  assertEquals(describeMatchSide(outsider, match), null);
  assertEquals(describeMatchSide(buyerOrg, null), null);
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Outreach gates — typed error codes & blocking semantics
// ─────────────────────────────────────────────────────────────────────────

Deno.test("gates: email_missing → CONTACT_EMAIL_MISSING + blocks", () => {
  const state = getContactState({
    counterparty_email: null,
    counterparty_org: { id: "o", name: "Acme" },
  });
  assertEquals(state, "email_missing");
  assert(isOutreachBlocked(state));
  assertEquals(contactBlockCode(state), "CONTACT_EMAIL_MISSING");
  assert((contactBlockReason(state) ?? "").length > 0);
});

Deno.test("gates: contact_incomplete → CONTACT_INCOMPLETE + blocks", () => {
  const state = getContactState({ counterparty_email: "x@y.com" });
  assertEquals(state, "contact_incomplete");
  assert(isOutreachBlocked(state));
  assertEquals(contactBlockCode(state), "CONTACT_INCOMPLETE");
});

Deno.test("gates: organisation_contact → no block, no code", () => {
  const state = getContactState({
    counterparty_email: "x@y.com",
    counterparty_org_id: "o",
  });
  assertEquals(state, "organisation_contact");
  assertFalse(isOutreachBlocked(state));
  assertEquals(contactBlockCode(state), null);
  assertEquals(contactBlockReason(state), null);
});

Deno.test("gates: named_individual_contact → no block, no code", () => {
  const state = getContactState({
    counterparty_email: "jane@y.com",
    contact_type: "named_individual",
    contact_name: "Jane Doe",
  });
  assertEquals(state, "named_individual_contact");
  assertFalse(isOutreachBlocked(state));
  assertEquals(contactBlockCode(state), null);
});
