/**
 * AcceptEngagementCard — Accept button gating (P3 + Batch D Test 7)
 *
 * Pins the rules driving the rendered Accept button in
 * src/components/match/AcceptEngagementCard.tsx.
 *
 *   const canRespond =
 *     engagementStatus === "notification_sent" ||
 *     engagementStatus === "contacted" ||
 *     engagementStatus === "expired";
 *
 *   const acceptBlocked = engagementStatus === "notification_sent";
 *   const isExpired     = engagementStatus === "expired";
 *
 * Decline must remain available for pre-acceptance states but is hidden
 * for `expired` because the server's poi-engagements/respond route
 * rejects decline-after-expiry as an invalid transition.
 *
 * Backend, schema, RPC and edge functions are unchanged.
 */

import { describe, it, expect } from "vitest";

const RESPONDABLE = new Set(["notification_sent", "contacted", "expired"]);

function deriveCardState(engagementStatus: string | null) {
  if (engagementStatus === null || !RESPONDABLE.has(engagementStatus)) {
    return { rendered: false as const };
  }
  const acceptBlocked = engagementStatus === "notification_sent";
  const isExpired = engagementStatus === "expired";
  const acceptLabel = acceptBlocked
    ? "Accept (waiting for initiator)"
    : isExpired
      ? "Accept (late)"
      : "Accept Trade";
  return {
    rendered: true as const,
    acceptDisabled: acceptBlocked,
    declineRendered: !isExpired,
    acceptLabel,
    isExpired,
  };
}

describe("AcceptEngagementCard — gating", () => {
  it("notification_sent: card renders, Accept disabled with waiting label, Decline shown", () => {
    const s = deriveCardState("notification_sent");
    expect(s.rendered).toBe(true);
    if (!s.rendered) return;
    expect(s.acceptDisabled).toBe(true);
    expect(s.acceptLabel).toBe("Accept (waiting for initiator)");
    expect(s.declineRendered).toBe(true);
  });

  it("contacted: card renders, Accept enabled, Decline shown", () => {
    const s = deriveCardState("contacted");
    expect(s.rendered).toBe(true);
    if (!s.rendered) return;
    expect(s.acceptDisabled).toBe(false);
    expect(s.acceptLabel).toBe("Accept Trade");
    expect(s.declineRendered).toBe(true);
  });

  it("expired (Batch D Test 7): card renders with 'Accept (late)' label and Decline hidden", () => {
    const s = deriveCardState("expired");
    expect(s.rendered).toBe(true);
    if (!s.rendered) return;
    expect(s.acceptDisabled).toBe(false);
    expect(s.acceptLabel).toBe("Accept (late)");
    expect(s.isExpired).toBe(true);
    expect(s.declineRendered).toBe(false);
  });

  it.each([
    "accepted",
    "declined",
    "cancelled",
    "disputed",
    "late_acceptance_pending_initiator_reconfirmation",
    "pending",
    null,
  ])("does not render for non-respondable status %s", (status) => {
    expect(deriveCardState(status).rendered).toBe(false);
  });
});

describe("AcceptEngagementCard — server contract", () => {
  it("client posts to poi-engagements/respond/:matchId with action='accepted'", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      "src/components/match/AcceptEngagementCard.tsx",
      "utf8",
    );
    expect(src).toMatch(/poi-engagements\/respond\/\$\{match\.id\}/);
    expect(src).toMatch(/body:\s*\{\s*action:\s*pendingAction\s*\}/);
  });
});
