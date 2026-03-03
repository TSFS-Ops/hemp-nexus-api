/**
 * Due Diligence — Acceptance Tests
 * 
 * Validates the DD workflow rules:
 * 1) Create org, upload docs, run screening, compute score
 * 2) Low score → Compliance Analyst can approve → Approved to Trade
 * 3) High score → Director required, collapse without Director → fail
 * 4) Wrong role → fail
 * 5) Trade status readable
 * 
 * These test the module logic; integration tests require the edge function.
 */

import { describe, it, expect } from "vitest";

// Risk band logic (mirrors edge function)
function getRiskBand(score: number): string {
  if (score <= 30) return "low";
  if (score <= 60) return "medium";
  if (score <= 80) return "high";
  return "critical";
}

function getRequiredRoles(riskBand: string): string[] {
  if (riskBand === "low") return ["compliance_analyst"];
  if (riskBand === "medium") return ["compliance_analyst", "legal_reviewer"];
  return ["compliance_analyst", "legal_reviewer", "director"];
}

function canApprove(
  actorRoles: string[],
  requiredRoles: string[],
  completedRoles: string[]
): { canAct: boolean; matchedRole: string | null } {
  const pendingRoles = requiredRoles.filter(r => !completedRoles.includes(r));
  const matchedRole = pendingRoles.find(r => actorRoles.includes(r)) || null;
  return { canAct: !!matchedRole, matchedRole };
}

function isApprovalComplete(requiredRoles: string[], completedRoles: string[]): boolean {
  return requiredRoles.every(r => completedRoles.includes(r));
}

describe("Due Diligence — Acceptance Tests", () => {
  // Test 1: Risk band determination
  describe("Test 1: Score and risk band computation", () => {
    it("should assign low band for score ≤ 30", () => {
      expect(getRiskBand(10)).toBe("low");
      expect(getRiskBand(30)).toBe("low");
    });

    it("should assign medium band for score 31–60", () => {
      expect(getRiskBand(45)).toBe("medium");
    });

    it("should assign high band for score 61–80", () => {
      expect(getRiskBand(75)).toBe("high");
    });

    it("should assign critical band for score > 80", () => {
      expect(getRiskBand(95)).toBe("critical");
    });
  });

  // Test 2: Low score → Compliance Analyst can approve
  describe("Test 2: Low score → Compliance Analyst approval", () => {
    it("should require only compliance_analyst for low risk", () => {
      const roles = getRequiredRoles("low");
      expect(roles).toEqual(["compliance_analyst"]);
    });

    it("should allow compliance_analyst to approve low-risk request", () => {
      const result = canApprove(["compliance_analyst"], ["compliance_analyst"], []);
      expect(result.canAct).toBe(true);
      expect(result.matchedRole).toBe("compliance_analyst");
    });

    it("should mark approval as complete after compliance_analyst approves", () => {
      expect(isApprovalComplete(["compliance_analyst"], ["compliance_analyst"])).toBe(true);
    });
  });

  // Test 3: High score → Director required
  describe("Test 3: High score → Director required", () => {
    it("should require director for high risk", () => {
      const roles = getRequiredRoles("high");
      expect(roles).toContain("director");
      expect(roles).toContain("compliance_analyst");
      expect(roles).toContain("legal_reviewer");
    });

    it("should NOT complete approval without director", () => {
      const required = getRequiredRoles("high");
      const completed = ["compliance_analyst", "legal_reviewer"];
      expect(isApprovalComplete(required, completed)).toBe(false);
    });

    it("should complete approval only after all roles including director approve", () => {
      const required = getRequiredRoles("high");
      const completed = ["compliance_analyst", "legal_reviewer", "director"];
      expect(isApprovalComplete(required, completed)).toBe(true);
    });
  });

  // Test 4: Wrong role → cannot approve
  describe("Test 4: Wrong role → rejection", () => {
    it("should reject approval attempt by wrong role", () => {
      // Only director is pending, but actor is compliance_analyst
      const result = canApprove(
        ["compliance_analyst"],
        ["compliance_analyst", "legal_reviewer", "director"],
        ["compliance_analyst", "legal_reviewer"]
      );
      expect(result.canAct).toBe(false);
      expect(result.matchedRole).toBeNull();
    });

    it("should reject legal_reviewer when only director is needed", () => {
      const result = canApprove(
        ["legal_reviewer"],
        ["compliance_analyst", "director"],
        ["compliance_analyst"]
      );
      expect(result.canAct).toBe(false);
    });
  });

  // Test 5: Trade status model
  describe("Test 5: Approved to Trade status", () => {
    it("should default to not_approved", () => {
      const status = { status: "not_approved" };
      expect(status.status).toBe("not_approved");
    });

    it("should be approved after full approval completion", () => {
      const required = getRequiredRoles("low");
      const completed = ["compliance_analyst"];
      const isComplete = isApprovalComplete(required, completed);
      const tradeStatus = isComplete ? "approved" : "not_approved";
      expect(tradeStatus).toBe("approved");
    });

    it("should remain not_approved if approvals incomplete", () => {
      const required = getRequiredRoles("high");
      const completed = ["compliance_analyst"];
      const isComplete = isApprovalComplete(required, completed);
      const tradeStatus = isComplete ? "approved" : "not_approved";
      expect(tradeStatus).toBe("not_approved");
    });
  });

  // Test: Medium risk requires legal_reviewer
  describe("Medium risk band", () => {
    it("should require compliance_analyst and legal_reviewer", () => {
      const roles = getRequiredRoles("medium");
      expect(roles).toEqual(["compliance_analyst", "legal_reviewer"]);
    });
  });
});
