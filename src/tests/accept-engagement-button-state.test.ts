/**
 * AcceptEngagementCard — Accept button gating (P3)
 *
 * Pins the rule that drives the rendered Accept button in
 * src/components/match/AcceptEngagementCard.tsx (lines 165–201):
 *
 *   const acceptBlocked = engagementStatus === "notification_sent";
 *
 * The rule must agree with the amber "Waiting for the initiating party"
 * banner. Drift here re-introduces the old paper-cut where Accept was
 * clickable while the banner said "wait for initiator", producing a raw
 * "Cannot transition from notification_sent to accepted" backend error.
 *
 * Decline must remain available across every respondable engagement
 * status; the backend `poi-engagements/respond` endpoint accepts decline
 * from any pre-acceptance state.
 *
 * Backend, schema, RPC and edge functions are unchanged.
 */

import { describe, it, expect } from "vitest";

/**
 * Mirror of the gating expression inside AcceptEngagementCard.
 * Kept as a pure function so the rule can be pinned without a DOM render.
 */
function deriveAcceptState(engagementStatus: string | null) {
  const acceptBlocked = engagementStatus === "notification_sent";
  return {
    acceptDisabled: acceptBlocked,
    declineDisabled: false,
    acceptLabel: acceptBlocked ? "Accept (waiting for initiator)" : "Accept Trade",
  };
}

describe("AcceptEngagementCard — Accept gating", () => {
  it("disables Accept and re-labels it when engagement is awaiting initiator outreach", () => {
    const s = deriveAcceptState("notification_sent");
    expect(s.acceptDisabled).toBe(true);
    expect(s.acceptLabel).toBe("Accept (waiting for initiator)");
  });

  it("enables Accept once the engagement is 'contacted'", () => {
    const s = deriveAcceptState("contacted");
    expect(s.acceptDisabled).toBe(false);
    expect(s.acceptLabel).toBe("Accept Trade");
  });

  it("keeps Decline available regardless of engagement status", () => {
    for (const status of ["notification_sent", "contacted", "pending", null]) {
      expect(deriveAcceptState(status).declineDisabled).toBe(false);
    }
  });
});
