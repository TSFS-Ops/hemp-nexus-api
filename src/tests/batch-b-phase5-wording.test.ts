/**
 * Batch B Phase 5 — Wording Engine pin tests.
 *
 * These tests pin the Batch B contract for user-facing wording across the
 * engagement lifecycle. They guard against regressions where pre-acceptance
 * or late-acceptance states accidentally pick up mutual / binding / final
 * wording or are described as "auto-decline".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  getEngagementWording,
  getReconfirmationWindowElapsedWording,
  getRenewedEngagementCreatedWording,
  getInitiatorDeclinedLateAcceptanceWording,
} from "@/lib/engagement-wording";

const FORBIDDEN_PRE_ACCEPTANCE = [
  /\baccepted\b/i,
  /\bmutual/i,
  /\bbinding\b/i,
  /\bfinal/i,
  /\bsealed\b/i,
  /\bcompleted\b/i,
  /\bexecuted\b/i,
  /\bsettled\b/i,
];

function assertNoForbidden(text: string, allow: RegExp[] = []) {
  for (const re of FORBIDDEN_PRE_ACCEPTANCE) {
    if (allow.some((a) => a.source === re.source)) continue;
    expect(text, `should not contain ${re}: ${text}`).not.toMatch(re);
  }
}

describe("Batch B Phase 5 — engagement wording engine", () => {
  describe("pre-acceptance states never imply mutual/binding progress", () => {
    for (const status of ["pending", "notification_sent", "contacted"] as const) {
      it(`${status} wording is non-committal`, () => {
        const w = getEngagementWording({ status });
        expect(w.progressionAllowed).toBe(false);
        assertNoForbidden(w.badgeLabel + " " + w.headline + " " + w.description);
      });
    }
  });

  describe("late acceptance recorded — awaiting initiator reconfirmation", () => {
    const w = getEngagementWording({
      status: "late_acceptance_pending_initiator_reconfirmation",
    });
    it("uses the agreed late-acceptance copy", () => {
      expect(w.key).toBe("engagement.late_acceptance_pending_initiator_reconfirmation");
      expect(w.badgeLabel.toLowerCase()).toContain("late acceptance");
      expect(w.description.toLowerCase()).toContain("late acceptance");
      expect(w.description.toLowerCase()).toContain("awaiting initiator reconfirmation");
      expect(w.description).toMatch(/does not progress the POI or WaD workflow/i);
    });
    it("does not progress workflow", () => {
      expect(w.progressionAllowed).toBe(false);
    });
    it("never says auto-decline", () => {
      expect(w.description).not.toMatch(/auto[-\s]?decline/i);
    });
  });

  describe("expired with accepted_after_expiry but no reconfirmation", () => {
    const w = getEngagementWording({
      status: "expired",
      acceptedAfterExpiry: true,
    });
    it("describes the late acceptance as still recorded and the original engagement as expired", () => {
      expect(w.description.toLowerCase()).toContain("late acceptance");
      expect(w.description.toLowerCase()).toContain("original engagement remains expired");
    });
    it("never says reopened/live", () => {
      expect(w.description).not.toMatch(/reopen|live again/i);
    });
    it("does not progress workflow", () => {
      expect(w.progressionAllowed).toBe(false);
    });
  });

  describe("renewed child engagements", () => {
    it("renewed notification_sent never uses accepted/mutual/binding wording", () => {
      for (const status of ["notification_sent", "contacted"] as const) {
        const w = getEngagementWording({ status, isRenewedChild: true });
        expect(w.progressionAllowed).toBe(false);
        assertNoForbidden(w.badgeLabel + " " + w.headline + " " + w.description);
        expect(w.description.toLowerCase()).toContain("renewed engagement");
      }
    });

    it("renewed accepted may use accepted/mutual intent wording but never WaD/settled/final", () => {
      const w = getEngagementWording({ status: "accepted", isRenewedChild: true });
      expect(w.progressionAllowed).toBe(true);
      expect(w.badgeLabel.toLowerCase()).toContain("accepted");
      // But still must not imply WaD / settlement / execution / finality.
      expect(w.description).not.toMatch(/\b(?:sealed|settled|executed|finalised|finalized|wad)\b/i);
    });

    it("expired parent superseded by a renewed child is described as such", () => {
      const w = getEngagementWording({ status: "expired", hasRenewedChild: true });
      expect(w.key).toBe("engagement.expired.superseded_by_renewal");
      expect(w.description.toLowerCase()).toContain("renewed engagement");
      expect(w.description.toLowerCase()).toContain("original engagement remains expired");
      expect(w.progressionAllowed).toBe(false);
    });
  });

  describe("post-window helpers", () => {
    it("reconfirmation-window-elapsed wording is not an auto-decline", () => {
      const w = getReconfirmationWindowElapsedWording();
      expect(w.description).not.toMatch(/auto[-\s]?decline/i);
      expect(w.description.toLowerCase()).toContain("did not reconfirm");
      expect(w.description.toLowerCase()).toContain("late acceptance remains recorded");
    });

    it("renewed-engagement-created wording is non-committal", () => {
      const w = getRenewedEngagementCreatedWording();
      expect(w.progressionAllowed).toBe(false);
      assertNoForbidden(w.badgeLabel + " " + w.headline + " " + w.description);
      expect(w.description.toLowerCase()).toContain("renewed engagement");
    });

    it("initiator-declined wording explicitly attributes the decline", () => {
      const w = getInitiatorDeclinedLateAcceptanceWording();
      expect(w.description.toLowerCase()).toContain("initiator declined");
      expect(w.description).not.toMatch(/auto[-\s]?decline/i);
    });
  });

  describe("guard script integration", () => {
    it("the wording guard exists and the SSOT is wired", () => {
      const guard = readFileSync("scripts/check-engagement-wording.mjs", "utf8");
      expect(guard).toContain("auto[-\\s_]?decline");
      const eng = readFileSync("src/lib/engagement-wording.ts", "utf8");
      expect(eng).toContain("late_acceptance_pending_initiator_reconfirmation");
      expect(eng).toContain("accepted_after_expiry");
    });
  });

  describe("'auto-decline' phrase is absent from user-facing source", () => {
    it("does not appear in the wording engine", () => {
      const text = readFileSync("src/lib/engagement-wording.ts", "utf8");
      expect(text).not.toMatch(/auto[-\s_]?decline/i);
    });
    it("does not appear in the wired surfaces", () => {
      for (const f of [
        "src/components/match/PendingEngagementSection.tsx",
        "src/components/match/EngagementTracker.tsx",
        "src/components/match/AcceptEngagementCard.tsx",
        "src/components/match/UnknownCounterpartyStatus.tsx",
      ]) {
        const text = readFileSync(f, "utf8");
        expect(text, `${f} must not say 'auto-decline'`).not.toMatch(/auto[-\s_]?decline/i);
      }
    });
  });
});
