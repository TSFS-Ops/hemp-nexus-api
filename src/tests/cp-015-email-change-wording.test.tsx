/**
 * CP-015 — Daniel-view proof: the email-change refusal wording is rendered
 * verbatim in the UI Daniel will see, not just in a 3.5s toast.
 *
 * Two layers are pinned:
 *   1. humaniseEngagementError() returns the FULL required sentence as the
 *      headline so the AddContactDialog's inline saveError block (and the
 *      toast) both show the wording Daniel was emailed.
 *   2. CancelForEmailChangeDialog renders the same wording as a visible
 *      alert in the dialog body so Daniel sees it even before submitting.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { humaniseEngagementError } from "@/lib/humanise-engagement-error";
import { CancelForEmailChangeDialog } from "@/components/admin/CancelForEmailChangeDialog";

const REQUIRED =
  "Counterparty email cannot be edited silently after a Pending Engagement has been created. The existing engagement will be cancelled and a new engagement must be created with the corrected email. The original record will remain in the audit trail.";

describe("CP-015 — humaniseEngagementError EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE", () => {
  it("returns the full Daniel-required wording as the headline", () => {
    const h = humaniseEngagementError({
      message: "EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE: outreach already started",
    });
    expect(h.headline).toBe(REQUIRED);
  });

  it("hint also points to the cancel-and-recreate path", () => {
    const h = humaniseEngagementError("EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE");
    expect(h.hint).toMatch(/cancel for email change/i);
    expect(h.hint).toMatch(/replacement engagement/i);
  });
});

describe("CP-015 — CancelForEmailChangeDialog visible wording", () => {
  it("renders the full required wording in the dialog body", () => {
    render(
      <CancelForEmailChangeDialog
        open
        engagement={{
          id: "4226aff0-246c-406b-9c4f-ae64c89cc9e7",
          match_id: "b50e94c8-a916-46c2-ac00-50eb9c109a88",
          counterparty_email: "daniel-cp015-old@test.izenzo.co.za",
          counterparty_org_name: "DEMO Daniel Counterparty Org",
        }}
        onClose={() => {}}
        onResolved={() => {}}
      />,
    );
    const alert = screen.getByTestId("cp015-email-change-required-wording");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent?.replace(/\s+/g, " ").trim()).toBe(REQUIRED);
  });
});
