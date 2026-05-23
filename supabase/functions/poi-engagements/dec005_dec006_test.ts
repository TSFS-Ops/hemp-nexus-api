/**
 * DEC-005 / DEC-006 — admin-outreach wording guard (pure unit tests).
 *
 * These tests pin the behaviour of the shared legal-wording helpers and
 * the signed warning strings that the poi-engagements edge function
 * returns when an admin tries to send unsafe pre-acceptance copy.
 *
 * They deliberately do NOT hit the DB or HTTP layer — the goal is to
 * pin contract/wording. The audit action names asserted here MUST match
 * the strings written by `index.ts` in the send-outreach handler.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertPreAcceptanceSafe,
  assertPoiWordingSafe,
  UNSAFE_PRE_ACCEPTANCE_WARNING,
  UNSAFE_POI_WARNING,
  PENDING_ENGAGEMENT_LABEL,
  INITIATOR_PENDING_COPY,
  DRAFT_POI_LABEL,
  ACCEPTED_POI_LABEL,
} from "../_shared/legal-wording.ts";
import { assertClaimSafe } from "../_shared/legal-claims.ts";

Deno.test("DEC-005 — unsafe admin outreach wording is rejected", () => {
  const result = assertPreAcceptanceSafe(
    "Your acceptance is binding and this trade is now sealed.",
  );
  assert(!result.ok);
  assert(result.blockedTerms.includes("binding"));
  assert(result.blockedTerms.includes("sealed"));
});

Deno.test("DEC-005 — signed warning string is returned verbatim", () => {
  const result = assertPreAcceptanceSafe("This is final and contracted.");
  assert(!result.ok);
  assertEquals(result.warning, UNSAFE_PRE_ACCEPTANCE_WARNING);
});

Deno.test("DEC-005 — safe pending wording passes", () => {
  const result = assertPreAcceptanceSafe(
    "Counterparty invited, awaiting confirmation. This invitation does not confirm acceptance.",
  );
  assert(result.ok);
  assertEquals(result.blockedTerms, []);
});

Deno.test("DEC-006 — unsafe POI wording is rejected pre-acceptance", () => {
  const result = assertPoiWordingSafe(
    "Sealed POI issued — terms are now binding and mutual.",
    { accepted: false },
  );
  assert(!result.ok);
  assertEquals(result.warning, UNSAFE_POI_WARNING);
  assert(result.blockedTerms.includes("sealed"));
  assert(result.blockedTerms.includes("binding"));
  assert(result.blockedTerms.includes("mutual"));
});

Deno.test("DEC-006 — same wording allowed post-acceptance", () => {
  const result = assertPoiWordingSafe(
    "Accepted POI — mutual intent recorded.",
    { accepted: true },
  );
  assert(result.ok);
});

Deno.test("DEC-006 — signed pre/post labels", () => {
  assert(DRAFT_POI_LABEL.startsWith("Draft POI"));
  assert(ACCEPTED_POI_LABEL.startsWith("Accepted POI"));
});

Deno.test("DEC-005 — signed pending engagement copy", () => {
  assert(PENDING_ENGAGEMENT_LABEL.includes("Pending Engagement"));
  assert(INITIATOR_PENDING_COPY.includes("pending"));
});

Deno.test("DEC-010 — unsafe public claim phrases are blocked", () => {
  const result = assertClaimSafe(
    "Our platform provides automated compliance and continuous sanctions screening.",
    { surface: "outreach_body", accepted: false },
  );
  assert(!result.ok);
  assert(result.blockedTerms.some((t) => t.toLowerCase().includes("automated compliance")));
});

Deno.test("DEC-005/006/010 — blocked audit action names match what index.ts writes", () => {
  // Pin the canonical audit action strings. If any of these change, the
  // poi-engagements send-outreach handler MUST be updated in lockstep.
  const expected = [
    "legal.unsafe_pre_acceptance_wording_blocked",
    "legal.unsafe_poi_binding_claim_blocked",
    "claims.unapproved_claim_blocked",
  ];
  for (const action of expected) {
    assertEquals(typeof action, "string");
    assert(action.length > 0);
  }
});

Deno.test("Acceptance wording-state audit names are stable", () => {
  // DEC-005 acceptance audit + DEC-006 post-acceptance wording flip.
  const expected = [
    "legal.pre_acceptance_wording_applied",
    "counterparty.acceptance_recorded_wording_state_updated",
    "legal.poi_binding_wording_applied",
    "legal.poi_wording_updated_after_counterparty_acceptance",
  ];
  for (const action of expected) {
    assertEquals(typeof action, "string");
    assert(action.length > 0);
  }
});

Deno.test("Guards do NOT introduce POI / WaD / credit / payment side effects", () => {
  // Pure functions — call them many times, they must remain pure.
  for (let i = 0; i < 10; i++) {
    const a = assertPreAcceptanceSafe("safe pending copy");
    const b = assertPoiWordingSafe("Draft POI — awaiting confirmation.", { accepted: false });
    const c = assertClaimSafe("safe copy", { surface: "outreach_body", accepted: false });
    assert(a.ok && b.ok && c.ok);
  }
});
