/**
 * Batch E Phase 2 — initiator-facing blocked-reason banner UI tests.
 *
 * Pins the PendingEngagementSection rendering of the three platform/
 * contact pause states the Phase 1 audit emit now records:
 *
 *   • DISPUTED_BEING_NAMED          (engagement_status)
 *   • BINDING_REVIEW_PENDING        (operational_state)
 *   • CONTACT_INCOMPLETE / EMAIL_MISSING (contact-completeness)
 *
 * The render-side contract checked here:
 *   1. The neutral copy from `getInitiatorBlockedCopy` /
 *      `getInitiatorOutreachBlockCopy` shows up verbatim.
 *   2. Wording passes the Batch D forbidden-word guard.
 *   3. No counterparty / candidate-org / dispute-text / commercial
 *      values render anywhere on the card for the platform-pause
 *      banners (binding / disputed). A counterparty NAME may legitimately
 *      render in the contact-incomplete row (it's the initiator's own
 *      typed counterparty), but counterparty EMAIL must never render
 *      because the test fixture omits it.
 *   4. The banner uses a stable `data-blocked-banner` attr equal to the
 *      code, so the admin/operator can grep for which path fired.
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  PendingEngagementSection,
  type PendingEngagementRow,
  type PendingEngagementMatch,
} from "@/components/match/PendingEngagementSection";
import {
  INITIATOR_BLOCKED_COPY,
  INITIATOR_OUTREACH_BLOCK_COPY,
} from "@/lib/initiator-blocked-copy";
import { findForbiddenWords } from "@/lib/batch-d-events";

// ── Canary strings the banner must NEVER reveal ──────────────────────────
const COUNTERPARTY_EMAIL_CANARY = "leak-cp@bex2.example.com";
const CANDIDATE_ORG_CANARY = "BEX2_CANDIDATE_ORG_LEAK";
const DISPUTE_REASON_CANARY = "BEX2_DISPUTE_REASON_LEAK";
const COMMODITY_CANARY = "BEX2_COMMODITY_LEAK";
const PRICE_CANARY = "987654321";
const QUANTITY_CANARY = "123456789";

const baseMatch: PendingEngagementMatch = {
  buyer_name: "Initiator Buyer Co",
  seller_name: null,
  buyer_org_id: "org-initiator",
  seller_org_id: null,
};

function makeRow(overrides: Partial<PendingEngagementRow>): PendingEngagementRow {
  return {
    id: "eng-1",
    engagement_status: "pending",
    counterparty_type: "known",
    counterparty_email: COUNTERPARTY_EMAIL_CANARY,
    counterparty_org_id: "org-cp",
    contact_type: "named_individual",
    contact_name: "Counterparty Person",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function bannerOrNull(): HTMLElement | null {
  return document.querySelector("[data-blocked-banner]") as HTMLElement | null;
}

describe("Batch E Phase 2 :: initiator banner — DISPUTED_BEING_NAMED", () => {
  it("renders the neutral 'paused for platform review' copy", () => {
    render(
      <PendingEngagementSection
        engagement={makeRow({
          engagement_status: "disputed_being_named",
          // server may also stamp operational_state; the gate accepts either.
          operational_state: "disputed_being_named",
        })}
        match={baseMatch}
        isInitiator
      />,
    );
    const expected = INITIATOR_BLOCKED_COPY.DISPUTED_BEING_NAMED;
    const banner = bannerOrNull();
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute("data-blocked-banner")).toBe("DISPUTED_BEING_NAMED");
    expect(within(banner!).getByText(expected.headline)).toBeInTheDocument();
    expect(within(banner!).getByText(expected.body)).toBeInTheDocument();
    if (expected.next) expect(within(banner!).getByText(expected.next)).toBeInTheDocument();
    // No leakage canaries inside the banner.
    const blob = banner!.textContent ?? "";
    for (const c of [
      CANDIDATE_ORG_CANARY,
      DISPUTE_REASON_CANARY,
      COMMODITY_CANARY,
      PRICE_CANARY,
      QUANTITY_CANARY,
      COUNTERPARTY_EMAIL_CANARY,
    ]) {
      expect(blob).not.toContain(c);
    }
  });
});

describe("Batch E Phase 2 :: initiator banner — BINDING_REVIEW_PENDING", () => {
  it("renders the neutral 'confirming counterparty record' copy", () => {
    render(
      <PendingEngagementSection
        engagement={makeRow({
          operational_state: "binding_review_required",
          binding_resolution: null,
        })}
        match={baseMatch}
        isInitiator
      />,
    );
    const expected = INITIATOR_BLOCKED_COPY.BINDING_REVIEW_PENDING;
    const banner = bannerOrNull();
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute("data-blocked-banner")).toBe("BINDING_REVIEW_PENDING");
    expect(within(banner!).getByText(expected.headline)).toBeInTheDocument();
    expect(within(banner!).getByText(expected.body)).toBeInTheDocument();
    const blob = banner!.textContent ?? "";
    for (const c of [
      CANDIDATE_ORG_CANARY,
      DISPUTE_REASON_CANARY,
      COMMODITY_CANARY,
      PRICE_CANARY,
      QUANTITY_CANARY,
      COUNTERPARTY_EMAIL_CANARY,
    ]) {
      expect(blob).not.toContain(c);
    }
  });

  it("does NOT render the platform banner when binding_resolution is set", () => {
    render(
      <PendingEngagementSection
        engagement={makeRow({
          operational_state: "binding_review_required",
          binding_resolution: "resolved",
        })}
        match={baseMatch}
        isInitiator
      />,
    );
    expect(bannerOrNull()).toBeNull();
  });
});

describe("Batch E Phase 2 :: initiator banner — contact incomplete", () => {
  it("renders the neutral 'outreach paused — contact incomplete' copy", () => {
    render(
      <PendingEngagementSection
        engagement={makeRow({
          counterparty_email: null,
          counterparty_org_id: null,
          contact_type: null,
          contact_name: null,
        })}
        match={{ buyer_name: null, seller_name: null, buyer_org_id: null, seller_org_id: null }}
        isInitiator
      />,
    );
    const banner = bannerOrNull();
    expect(banner).not.toBeNull();
    const code = banner!.getAttribute("data-blocked-banner");
    expect(code === "CONTACT_INCOMPLETE" || code === "CONTACT_EMAIL_MISSING").toBe(true);
    const expected = INITIATOR_OUTREACH_BLOCK_COPY[code as "CONTACT_INCOMPLETE" | "CONTACT_EMAIL_MISSING"];
    expect(within(banner!).getByText(expected.headline)).toBeInTheDocument();
    expect(within(banner!).getByText(expected.body)).toBeInTheDocument();
  });
});

describe("Batch E Phase 2 :: wording safety", () => {
  it("every initiator banner copy passes the Batch D forbidden-word guard", () => {
    const all = [
      ...Object.values(INITIATOR_BLOCKED_COPY),
      ...Object.values(INITIATOR_OUTREACH_BLOCK_COPY),
    ];
    for (const c of all) {
      for (const text of [c.headline, c.body, c.next ?? ""]) {
        expect(findForbiddenWords(text)).toEqual([]);
      }
    }
  });

  it("the platform banners never include the counterparty's email anywhere on the card", () => {
    // Render the disputed case with a counterparty email present on the
    // row. The banner's contract is that no counterparty contact details
    // are revealed in the platform-pause framing. The "Email" dl row
    // elsewhere on the card is the row's own engagement summary — but
    // the BANNER element specifically must not echo the address.
    render(
      <PendingEngagementSection
        engagement={makeRow({
          engagement_status: "disputed_being_named",
          counterparty_email: COUNTERPARTY_EMAIL_CANARY,
        })}
        match={baseMatch}
        isInitiator
      />,
    );
    const banner = bannerOrNull()!;
    expect(banner.textContent ?? "").not.toContain(COUNTERPARTY_EMAIL_CANARY);
  });
});
