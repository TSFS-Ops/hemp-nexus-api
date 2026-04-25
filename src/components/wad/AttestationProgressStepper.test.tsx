/**
 * Accessibility-focused tests for AttestationProgressStepper.
 *
 * The visual layout is exercised by the parent WadModule snapshot tests;
 * here we lock down the semantics that screen-reader users depend on:
 *   - the steps are exposed as an ordered list
 *   - each step is focusable and carries a single consolidated aria-label
 *   - the "current" actionable step is marked with aria-current="step"
 *   - the progress bar and decorative chrome are aria-hidden so they don't
 *     double-announce the textual summary
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AttestationProgressStepper } from "./AttestationProgressStepper";
import type {
  ConsequenceState,
  WadRecord,
  WadAttestation,
} from "@/lib/modules/consequence";

function makeWad(overrides: Partial<WadRecord> = {}): WadRecord {
  return {
    id: "wad-1",
    poi_id: "poi-1",
    status: "awaiting_attestations",
    evidence_bundle: null,
    seal_hash: null,
    sealed_at: null,
    created_at: "2025-01-01T00:00:00Z",
    buyer_org_id: "org-buyer",
    seller_org_id: "org-seller",
    revoked_reason: null,
    attestations: [],
    ...overrides,
  };
}

function makeBuyerAttestation(): WadAttestation {
  return {
    id: "att-buyer-1",
    wad_id: "wad-1",
    user_id: "user-buyer",
    org_id: "org-buyer",
    role: "buyer_signatory",
    attested_name: "Jane Buyer",
    attested_at: "2025-04-01T10:00:00Z",
    attestation_text: "I confirm",
  };
}

function makeConsequence(
  overrides: Partial<ConsequenceState> = {},
): ConsequenceState {
  return {
    uiStatus: "awaiting_attestations",
    statusLabel: "Awaiting attestations",
    wad: null,
    canCreate: false,
    createBlockedReasons: [],
    canAttest: true,
    hasAttested: false,
    allAttested: false,
    canSeal: false,
    canDownloadCertificate: false,
    canRevoke: false,
    isTerminal: false,
    attestations: { buyerAttested: false, sellerAttested: false, total: 0 },
    ...overrides,
  };
}

describe("AttestationProgressStepper a11y", () => {
  it("exposes the signatory steps as an ordered list", () => {
    render(
      <AttestationProgressStepper
        wad={makeWad()}
        consequenceState={makeConsequence()}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId="org-buyer"
      />,
    );

    const list = screen.getByRole("list", { name: /signatory attestations/i });
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
  });

  it("gives each step a single consolidated, position-aware aria-label", () => {
    render(
      <AttestationProgressStepper
        wad={makeWad({ attestations: [makeBuyerAttestation()] })}
        consequenceState={makeConsequence({
          hasAttested: true,
          canAttest: false,
          attestations: {
            buyerAttested: true,
            sellerAttested: false,
            total: 1,
          },
        })}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId="org-buyer"
      />,
    );

    const list = screen.getByRole("list", { name: /signatory attestations/i });
    const items = within(list).getAllByRole("listitem");

    const buyerLabel = items[0].getAttribute("aria-label") || "";
    expect(buyerLabel).toMatch(/^Step 1 of 2 /);
    expect(buyerLabel).toMatch(/Buyer signatory/);
    expect(buyerLabel).toMatch(/\(you\)/);
    expect(buyerLabel).toMatch(/for Acme Buyer/);
    expect(buyerLabel).toMatch(/attested by Jane Buyer/);

    const sellerLabel = items[1].getAttribute("aria-label") || "";
    expect(sellerLabel).toMatch(/^Step 2 of 2 /);
    expect(sellerLabel).toMatch(/awaiting attestation$/);
  });

  it("marks the viewer's own pending step as aria-current=\"step\"", () => {
    render(
      <AttestationProgressStepper
        wad={makeWad({ attestations: [makeBuyerAttestation()] })}
        consequenceState={makeConsequence()}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId="org-seller"
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0].getAttribute("aria-current")).toBeNull();
    expect(items[1].getAttribute("aria-current")).toBe("step");
  });

  it("makes each step focusable via tabIndex=0", () => {
    render(
      <AttestationProgressStepper
        wad={makeWad()}
        consequenceState={makeConsequence()}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId={null}
      />,
    );

    for (const item of screen.getAllByRole("listitem")) {
      expect(item.getAttribute("tabindex")).toBe("0");
    }
  });

  it("does not expose the progress bar to screen readers (avoids double-announce)", () => {
    render(
      <AttestationProgressStepper
        wad={makeWad()}
        consequenceState={makeConsequence()}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId="org-buyer"
      />,
    );

    // The numeric "0 of 2 signatories attested" sentence is the single
    // textual source of truth — there must be NO progressbar role to
    // re-announce the same fact.
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(
      screen.getByText(/0 of 2 signatories attested/i),
    ).toBeInTheDocument();
  });

  it("announces the next action via a single live region", () => {
    render(
      <AttestationProgressStepper
        wad={makeWad()}
        consequenceState={makeConsequence({ canAttest: true })}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId="org-buyer"
      />,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toMatch(/^Next: Attest now\./);
  });
});
