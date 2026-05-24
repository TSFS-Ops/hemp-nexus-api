/**
 * CP-015 — Match-page email-change history evidence.
 *
 * Pins the exact wording, IDs, statuses and side-effect note that must
 * render on /desk/match/:matchId when the match has a Pending
 * Engagement that was cancelled-for-email-change and replaced.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  MatchEmailChangeHistoryPanel,
  CP015_USER_FACING_MESSAGE,
  CP015_OLD_LINK_INACTIVE_MESSAGE,
  CP015_BLOCKED_SIDE_EFFECTS_NOTE,
  CP015_DIRECT_EDIT_BLOCKED_NOTE,
} from "@/components/match/MatchEmailChangeHistoryPanel";

const MATCH_ID = "b50e94c8-a916-46c2-ac00-50eb9c109a88";
const OLD_ID = "4226aff0-246c-406b-9c4f-ae64c89cc9e7";
const NEW_ID = "848a2ec1-e89c-4781-9f22-1713b86a6630";
const OLD_EMAIL = "daniel-cp015-original@test.izenzo.co.za";
const NEW_EMAIL = "daniel-cp015-corrected@test.izenzo.co.za";

const oldRow = {
  id: OLD_ID,
  match_id: MATCH_ID,
  engagement_status: "cancelled_email_change",
  operational_state: "cancelled_for_email_change",
  counterparty_email: OLD_EMAIL,
  renewed_from_engagement_id: null,
  created_at: "2026-05-24T15:10:00.000Z",
};

const newRow = {
  id: NEW_ID,
  match_id: MATCH_ID,
  engagement_status: "pending",
  operational_state: null,
  counterparty_email: NEW_EMAIL,
  renewed_from_engagement_id: OLD_ID,
  created_at: "2026-05-24T15:13:00.000Z",
};

describe("CP-015 — MatchEmailChangeHistoryPanel (/desk/match/:matchId)", () => {
  it("renders nothing when no cancelled-for-email-change row exists", () => {
    const { container } = render(
      <MatchEmailChangeHistoryPanel
        current={{ id: NEW_ID, engagement_status: "pending" } as any}
        history={[]}
      />,
    );
    expect(container.textContent ?? "").toBe("");
  });

  it("renders the full CP-015 evidence when current=new and history contains old", () => {
    render(
      <MatchEmailChangeHistoryPanel
        current={newRow as any}
        latestHistorical={null}
        history={[oldRow as any]}
      />,
    );

    expect(screen.getByTestId("cp015-email-change-history-panel")).toBeInTheDocument();
    expect(screen.getByTestId("cp015-user-facing-message")).toHaveTextContent(
      CP015_USER_FACING_MESSAGE,
    );

    // Old engagement block
    const oldBlock = screen.getByTestId("cp015-old-engagement-block");
    expect(oldBlock).toHaveAttribute("data-engagement-id", OLD_ID);
    expect(screen.getByTestId("cp015-old-engagement-id")).toHaveTextContent(OLD_ID);
    expect(screen.getByTestId("cp015-old-email")).toHaveTextContent(OLD_EMAIL);
    expect(screen.getByTestId("cp015-old-status-badge")).toHaveTextContent(
      "Status: cancelled_email_change",
    );
    expect(screen.getByTestId("cp015-old-operational-state-badge")).toHaveTextContent(
      "Operational state: cancelled_for_email_change",
    );

    // New engagement block
    const newBlock = screen.getByTestId("cp015-new-engagement-block");
    expect(newBlock).toHaveAttribute("data-engagement-id", NEW_ID);
    expect(screen.getByTestId("cp015-new-engagement-id")).toHaveTextContent(NEW_ID);
    expect(screen.getByTestId("cp015-new-email")).toHaveTextContent(NEW_EMAIL);
    expect(screen.getByTestId("cp015-new-status-badge")).toHaveTextContent(
      "Status: pending",
    );

    // Inactive-link + direct-edit-blocked + side-effects notes
    expect(screen.getByTestId("cp015-old-link-inactive").textContent ?? "").toContain(
      CP015_OLD_LINK_INACTIVE_MESSAGE,
    );
    expect(screen.getByTestId("cp015-direct-edit-blocked")).toHaveTextContent(
      CP015_DIRECT_EDIT_BLOCKED_NOTE,
    );
    expect(screen.getByTestId("cp015-blocked-side-effects")).toHaveTextContent(
      CP015_BLOCKED_SIDE_EFFECTS_NOTE,
    );
  });

  it("falls back to current as replacement when no row links via renewed_from_engagement_id", () => {
    const newRowUnlinked = { ...newRow, renewed_from_engagement_id: null };
    render(
      <MatchEmailChangeHistoryPanel
        current={newRowUnlinked as any}
        history={[oldRow as any]}
      />,
    );
    expect(screen.getByTestId("cp015-new-engagement-id")).toHaveTextContent(NEW_ID);
    expect(screen.getByTestId("cp015-new-email")).toHaveTextContent(NEW_EMAIL);
  });

  it("renders the 'no replacement yet' state when only the cancelled row exists", () => {
    render(
      <MatchEmailChangeHistoryPanel
        current={null}
        history={[oldRow as any]}
      />,
    );
    expect(screen.getByTestId("cp015-new-engagement-missing")).toBeInTheDocument();
  });
});
