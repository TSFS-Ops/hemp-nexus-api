/**
 * Batch E Test 2 — required-items list regression guard
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Pins the contract that surfaced during the 14 May 2026 readiness review:
 * for an initiator looking at a contact-incomplete pending engagement, the
 * "items still required" callout MUST list ONLY the genuine outreach
 * blockers — Counterparty name and Counterparty email — and MUST NOT
 * re-introduce "Linked organisation" as a required item.
 *
 * "Linked organisation" is auto-resolving information (the engagement
 * auto-links once the counterparty signs up). It used to appear as a
 * required bullet, which confused initiators (the screen contradicted the
 * test guide). The fix removed that push() in PendingEngagementSection;
 * this test exists so the next refactor cannot silently re-add it.
 *
 * The test also verifies the surrounding signal that Daniel relies on:
 *   • the "Contact incomplete" chip is rendered
 *   • the amber "Outreach paused — contact incomplete" copy is present
 *   • no "Send outreach" button is rendered on the initiator surface
 *     (outreach is admin-side only and gated by getContactState)
 *
 * If this test fails, do NOT relax it. Restore the renderer so the list
 * shows exactly the two true blockers, or re-confirm the spec change with
 * the client first.
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  PendingEngagementSection,
  type PendingEngagementMatch,
  type PendingEngagementRow,
} from "@/components/match/PendingEngagementSection";

const baseMatch: PendingEngagementMatch = {
  // Both sides unregistered + both names blank simulates the
  // DEMO-BE-CONTACT-INCOMPLETE-001 fixture exactly.
  buyer_name: null,
  seller_name: null,
  buyer_org_id: null,
  seller_org_id: null,
};

const baseEngagement: PendingEngagementRow = {
  id: "eng-bex2-test2",
  engagement_status: "pending",
  counterparty_type: "known",
  counterparty_email: null,
  counterparty_org_id: null,
  contact_type: null,
  contact_name: null,
  created_at: new Date().toISOString(),
};

describe("Batch E Test 2 :: required-items list regression guard", () => {
  it("shows exactly Counterparty name + Counterparty email — never Linked organisation", () => {
    render(<PendingEngagementSection engagement={baseEngagement} match={baseMatch} isInitiator />);

    const callout = screen.getByRole("alert", { name: /missing counterparty information/i });
    expect(callout).toBeInTheDocument();

    // Heading must read "2 items still required" — not 3.
    expect(within(callout).getByText("2 items still required")).toBeInTheDocument();
    expect(within(callout).queryByText(/3 items still required/i)).toBeNull();
    expect(within(callout).queryByText(/1 item still required/i)).toBeNull();

    // Both genuine blockers present.
    expect(within(callout).getByText("Counterparty name")).toBeInTheDocument();
    expect(within(callout).getByText("Counterparty email")).toBeInTheDocument();

    // "Linked organisation" must NOT appear inside the required-items
    // callout. (It legitimately appears in the details grid above as the
    // "Awaiting signup" info row — that is checked separately below.)
    expect(within(callout).queryByText(/linked organisation/i)).toBeNull();

    // Sanity: the bullet list contains exactly two items.
    const bullets = within(callout).getAllByRole("listitem");
    expect(bullets).toHaveLength(2);
  });

  it("still surfaces Linked organisation as informational 'Awaiting signup' in the details grid", () => {
    render(<PendingEngagementSection engagement={baseEngagement} match={baseMatch} isInitiator />);
    // The dl row label exists outside the callout.
    expect(screen.getByText("Linked organisation")).toBeInTheDocument();
    expect(screen.getByText(/awaiting signup/i)).toBeInTheDocument();
  });

  it("shows the Contact incomplete chip and amber outreach-paused copy", () => {
    render(<PendingEngagementSection engagement={baseEngagement} match={baseMatch} isInitiator />);
    // Chip + amber banner copy. Both strings appear; we only need to
    // assert presence, not count or location.
    expect(screen.getAllByText(/contact incomplete/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/outreach paused — contact incomplete/i)).toBeInTheDocument();
  });

  it("does NOT render a Send outreach button on the initiator surface", () => {
    render(<PendingEngagementSection engagement={baseEngagement} match={baseMatch} isInitiator />);
    // Initiator UI must not expose any outreach action — outreach is
    // admin-side only and additionally gated by getContactState.
    expect(screen.queryByRole("button", { name: /send outreach/i })).toBeNull();
  });
});
