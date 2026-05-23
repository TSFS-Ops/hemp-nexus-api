// DEC-005 / DEC-006 / DEC-010 Deno-side tests for the shared legal helpers.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PENDING_ENGAGEMENT_LABEL,
  DRAFT_POI_LABEL,
  ACCEPTED_POI_LABEL,
  assertPreAcceptanceSafe,
  assertPoiWordingSafe,
  getPoiLabel,
} from "./legal-wording.ts";
import { assertClaimSafe } from "./legal-claims.ts";

Deno.test("DEC-005 — signed Pending Engagement label", () => {
  assertEquals(
    PENDING_ENGAGEMENT_LABEL,
    "Pending Engagement — counterparty invited, awaiting confirmation.",
  );
});

Deno.test("DEC-006 — signed POI labels", () => {
  assertEquals(
    DRAFT_POI_LABEL,
    "Draft POI — initiator-generated intent record, awaiting counterparty confirmation.",
  );
  assertEquals(ACCEPTED_POI_LABEL, "Accepted POI — mutual intent recorded.");
  assertEquals(getPoiLabel({ accepted: false }).state, "draft");
  assertEquals(getPoiLabel({ accepted: true }).state, "accepted");
});

Deno.test("DEC-005 — assertPreAcceptanceSafe blocks 'binding'", () => {
  const r = assertPreAcceptanceSafe("This is binding now.");
  assertEquals(r.ok, false);
  assertEquals(r.blockedTerms.includes("binding"), true);
});

Deno.test("DEC-005 — assertPreAcceptanceSafe passes safe wording", () => {
  assertEquals(assertPreAcceptanceSafe("Pending counterparty confirmation.").ok, true);
});

Deno.test("DEC-006 — assertPoiWordingSafe allows post-acceptance mutual wording", () => {
  assertEquals(
    assertPoiWordingSafe("Accepted POI — mutual intent recorded.", { accepted: true }).ok,
    true,
  );
});

Deno.test("DEC-010 — assertClaimSafe blocks 'automated compliance' phrase", () => {
  const r = assertClaimSafe("Fully automated compliance for every deal.", {
    surface: "outreach_body",
  });
  assertEquals(r.ok, false);
});

Deno.test("DEC-010 — assertClaimSafe allows DEC-005-safe outreach body", () => {
  const r = assertClaimSafe(
    "You have been invited to review a proposed trade on Izenzo. This invitation does not confirm your acceptance.",
    { surface: "outreach_body" },
  );
  assertEquals(r.ok, true);
});
