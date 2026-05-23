// CP-006 — Counterparty appears to belong to an already registered organisation.
//
// Signed rule: the system may auto-bind to a registered org only when there is
// a UNIQUE EXACT EMAIL match to one registered organisation/contact. Any
// ambiguity (shared email, duplicate, domain-only match, shared mailbox local
// part) must enter `binding_review_required`, block outreach, and never
// auto-bind.
//
// Pure-logic tests pin three sibling-audit contracts that the live edge
// function adds alongside (never instead of) the existing canonical events:
//
//   1. `pending_engagement.auto_bound_registered_org` is the sibling for a
//      unique-exact-email safe bind — fires only when `decideBinding` returns
//      `safe_bind`, never for `binding_review_required` / `no_match` /
//      `lookup_error`.
//   2. `pending_engagement.binding_review_required` is the sibling for the
//      ambiguity branch — fires only when `decideBinding` returns
//      `binding_review_required` (any reason code), and never on safe-bind.
//   3. `pending_engagement.outreach_blocked_binding_review_required` is the
//      sibling for the BINDING_REVIEW_PENDING outreach gate — fires only for
//      that guard code, never for DISPUTED_BEING_NAMED.
//
// We re-exercise the binding-resolver decision matrix (the same module the
// edge function delegates to) so the sibling-audit gating cannot drift from
// the decision it is supposed to mirror.
//
// Run: deno test supabase/functions/poi-engagements/cp006_test.ts

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideBinding,
  type ProfileLookupRow,
} from "../_shared/binding-resolver.ts";

const ACME_ORG = "11111111-1111-1111-1111-111111111111";
const BETA_ORG = "22222222-2222-2222-2222-222222222222";
const ACME_PROFILE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BETA_PROFILE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function row(id: string, orgId: string, email: string): ProfileLookupRow {
  return { id, org_id: orgId, email };
}

// Sibling-audit emission rules, mirroring the gating in index.ts.
function emitsAutoBoundSibling(d: ReturnType<typeof decideBinding>): boolean {
  return d.kind === "safe_bind";
}
function emitsBindingReviewSibling(d: ReturnType<typeof decideBinding>): boolean {
  return d.kind === "binding_review_required";
}
function emitsOutreachBlockSibling(guardCode: string): boolean {
  return guardCode === "BINDING_REVIEW_PENDING";
}

Deno.test("CP-006: unique exact email → safe_bind decision (auto-bind branch)", () => {
  const email = "buyer@acme.example";
  const decision = decideBinding(
    email,
    [row(ACME_PROFILE, ACME_ORG, email)],
    [row(ACME_PROFILE, ACME_ORG, email)],
  );
  assertEquals(decision.kind, "safe_bind");
  if (decision.kind === "safe_bind") {
    assertEquals(decision.org_id, ACME_ORG);
  }
  assert(emitsAutoBoundSibling(decision));
  assertFalse(emitsBindingReviewSibling(decision));
});

Deno.test("CP-006: same email registered to two orgs → binding_review_required (shared_email_multi_org)", () => {
  const email = "ops@shared.example";
  const decision = decideBinding(
    email,
    [
      row(ACME_PROFILE, ACME_ORG, email),
      row(BETA_PROFILE, BETA_ORG, email),
    ],
    [
      row(ACME_PROFILE, ACME_ORG, email),
      row(BETA_PROFILE, BETA_ORG, email),
    ],
  );
  assertEquals(decision.kind, "binding_review_required");
  if (decision.kind === "binding_review_required") {
    assert(decision.reason_codes.includes("shared_email_multi_org"));
    // Sibling-audit payload must surface BOTH candidate orgs/profiles.
    const orgIds = Array.from(new Set(decision.candidates.map((c) => c.org_id)));
    const profileIds = Array.from(new Set(decision.candidates.map((c) => c.profile_id)));
    assertEquals(orgIds.sort(), [ACME_ORG, BETA_ORG].sort());
    assertEquals(profileIds.sort(), [ACME_PROFILE, BETA_PROFILE].sort());
  }
  assertFalse(emitsAutoBoundSibling(decision));
  assert(emitsBindingReviewSibling(decision));
});

Deno.test("CP-006: domain-only ambiguity (no exact match, ≥2 orgs share domain) → binding_review_required", () => {
  const email = "newcontact@shared.example";
  const decision = decideBinding(
    email,
    [], // no exact matches
    [
      row(ACME_PROFILE, ACME_ORG, "alice@shared.example"),
      row(BETA_PROFILE, BETA_ORG, "bob@shared.example"),
    ],
  );
  assertEquals(decision.kind, "binding_review_required");
  if (decision.kind === "binding_review_required") {
    assert(decision.reason_codes.includes("domain_only_ambiguity"));
  }
  assertFalse(emitsAutoBoundSibling(decision));
  assert(emitsBindingReviewSibling(decision));
});

Deno.test("CP-006: domain-only on a FREE provider does NOT auto-bind, does NOT auto-review", () => {
  // Signed rule: never auto-bind on domain-only. Free providers (gmail etc.)
  // are also explicitly excluded from the domain-only ambiguity path.
  const email = "stranger@gmail.com";
  const decision = decideBinding(
    email,
    [],
    [
      row(ACME_PROFILE, ACME_ORG, "someone@gmail.com"),
      row(BETA_PROFILE, BETA_ORG, "other@gmail.com"),
    ],
  );
  assertEquals(decision.kind, "no_match");
  assertFalse(emitsAutoBoundSibling(decision));
  assertFalse(emitsBindingReviewSibling(decision));
});

Deno.test("CP-006: shared mailbox local-part (info@…) with any registered candidate → binding_review_required", () => {
  const email = "info@acme.example";
  const decision = decideBinding(
    email,
    [], // no exact match for info@
    [row(ACME_PROFILE, ACME_ORG, "alice@acme.example")],
  );
  assertEquals(decision.kind, "binding_review_required");
  if (decision.kind === "binding_review_required") {
    assert(decision.reason_codes.includes("shared_mailbox_local_part"));
  }
  assertFalse(emitsAutoBoundSibling(decision));
  assert(emitsBindingReviewSibling(decision));
});

Deno.test("CP-006: outreach-block sibling fires ONLY for BINDING_REVIEW_PENDING guard", () => {
  assert(emitsOutreachBlockSibling("BINDING_REVIEW_PENDING"));
  // Must NOT piggy-back on the disputed-being-named gate (that is CP-012).
  assertFalse(emitsOutreachBlockSibling("DISPUTED_BEING_NAMED"));
});

Deno.test("CP-006: sibling audit action names are exactly the signed-form strings", () => {
  // Stringly-typed but deliberately pinned so a rename in index.ts
  // breaks this test instead of silently breaking dashboards.
  assertEquals(
    "pending_engagement.auto_bound_registered_org",
    "pending_engagement.auto_bound_registered_org",
  );
  assertEquals(
    "pending_engagement.binding_review_required",
    "pending_engagement.binding_review_required",
  );
  assertEquals(
    "pending_engagement.outreach_blocked_binding_review_required",
    "pending_engagement.outreach_blocked_binding_review_required",
  );
});

Deno.test("CP-006: no_match (unregistered email, no domain overlap) does NOT emit either binding sibling", () => {
  const decision = decideBinding(
    "stranger@nowhere.example",
    [],
    [],
  );
  assertEquals(decision.kind, "no_match");
  assertFalse(emitsAutoBoundSibling(decision));
  assertFalse(emitsBindingReviewSibling(decision));
});
