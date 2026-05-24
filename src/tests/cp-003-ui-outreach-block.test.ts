/**
 * CP-003 UI enforcement regression (Daniel FAIL fix)
 * ──────────────────────────────────────────────────
 * Daniel's CP-003 test (DEMO-CP003-EMAIL-NO-NAME-001) failed because the
 * admin Pending Engagement row was rendering with:
 *   • badge: "Organisation-level contact" (wrong — should be Contact incomplete)
 *   • Send outreach button enabled
 *   • no missing-name warning copy
 *
 * Root cause: AdminPendingEngagementsPanel.getEngagementContactState was
 * passing buyer_org_id/seller_org_id as undefined to getContactState. With
 * both sides looking "unregistered", resolveOrgName picked the initiator's
 * own buyer_name as the counterparty org name, returning organisation_contact.
 *
 * These tests pin the contract: with the real *_org_id values forwarded,
 * the helper returns contact_incomplete and outreach is blocked.
 */
import { describe, it, expect } from "vitest";
import {
  getContactState,
  isOutreachBlocked,
  contactBlockCode,
} from "@/lib/contact-completeness";

// Mirrors the exact fixture shape produced by seed-cp003-controlled-prod
// (Match ID 512e6741-87ca-4035-b436-78863208ee13,
//  Engagement ID 2e240a43-dae7-4e68-b6b2-3928964bef4b).
const CP003_ENGAGEMENT = {
  counterparty_email: "daniel-cp003-unregistered-counterparty@test.izenzo.co.za",
  counterparty_org_id: null,
  contact_name: null,
  contact_type: null,
  counterparty_org: null,
} as const;

// Initiator is the buyer (real org). Seller side is the missing counterparty.
const CP003_MATCH_FIXED = {
  buyer_name: "DEMO Daniel Initiator Org",
  seller_name: null,
  buyer_org_id: "00000000-0000-0000-0000-0000000000aa", // real initiator org
  seller_org_id: null,
};

// The pre-fix shape the panel used to pass (both *_org_id as undefined).
const CP003_MATCH_BROKEN = {
  buyer_name: "DEMO Daniel Initiator Org",
  seller_name: null,
  buyer_org_id: undefined,
  seller_org_id: undefined,
};

describe("CP-003 — admin row contact-state classification", () => {
  it("classifies the CP-003 fixture as contact_incomplete when *_org_id is forwarded", () => {
    const state = getContactState(CP003_ENGAGEMENT, CP003_MATCH_FIXED);
    expect(state).toBe("contact_incomplete");
  });

  it("blocks outreach and returns CONTACT_INCOMPLETE code", () => {
    const state = getContactState(CP003_ENGAGEMENT, CP003_MATCH_FIXED);
    expect(isOutreachBlocked(state)).toBe(true);
    expect(contactBlockCode(state)).toBe("CONTACT_INCOMPLETE");
  });

  it("regression guard: the old broken call shape misclassified as organisation_contact", () => {
    // This pins the pre-existing bug so a future refactor that drops the
    // *_org_id forwarding will fail this test, not silently re-introduce
    // the Daniel-failing behaviour.
    const state = getContactState(CP003_ENGAGEMENT, CP003_MATCH_BROKEN);
    expect(state).toBe("organisation_contact");
    expect(isOutreachBlocked(state)).toBe(false);
  });

  it("CP-002 sibling (no email) still classified as contact_incomplete", () => {
    // Defensive: CP-002 (email entirely missing AND no name) must remain
    // contact_incomplete so its block path doesn't regress.
    const state = getContactState(
      { ...CP003_ENGAGEMENT, counterparty_email: null },
      CP003_MATCH_FIXED,
    );
    expect(state).toBe("contact_incomplete");
    expect(isOutreachBlocked(state)).toBe(true);
  });

  it("CP-006 sibling (linked / auto-bound) remains organisation_contact", () => {
    // Defensive: a counterparty that successfully linked to an org id must
    // still report organisation_contact and allow outreach.
    const state = getContactState(
      {
        counterparty_email: "linked@example.com",
        counterparty_org_id: "00000000-0000-0000-0000-0000000000bb",
        contact_name: null,
        contact_type: null,
        counterparty_org: { id: "00000000-0000-0000-0000-0000000000bb", name: "Linked Co" },
      },
      {
        buyer_name: "Buyer Co",
        seller_name: "Linked Co",
        buyer_org_id: "00000000-0000-0000-0000-0000000000aa",
        seller_org_id: "00000000-0000-0000-0000-0000000000bb",
      },
    );
    expect(state).toBe("organisation_contact");
    expect(isOutreachBlocked(state)).toBe(false);
  });
});
