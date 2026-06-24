/**
 * Stage 4 — P-5 admin permissions tests.
 *
 * Pure derivation; no React render needed.
 */
import { describe, it, expect } from "vitest";
import { deriveP5Permissions } from "@/hooks/useP5Permissions";

describe("useP5Permissions / deriveP5Permissions", () => {
  it("platform_admin gets full admin capabilities", () => {
    const p = deriveP5Permissions(["platform_admin"]);
    expect(p.canViewAdmin).toBe(true);
    expect(p.canApproveReadyToProceed).toBe(true);
    expect(p.canWaive).toBe(true);
    expect(p.canOverride).toBe(true);
    expect(p.canReleaseHold).toBe(true);
    expect(p.canApplyHold).toBe(true);
    expect(p.canReject).toBe(true);
  });

  it("executive_approver gets admin capabilities", () => {
    const p = deriveP5Permissions(["executive_approver"]);
    expect(p.canApproveReadyToProceed).toBe(true);
    expect(p.canWaive).toBe(true);
    expect(p.canOverride).toBe(true);
  });

  it("governance_reviewer can review but not waive/override/RTP", () => {
    const p = deriveP5Permissions(["governance_reviewer"]);
    expect(p.canViewAdmin).toBe(true);
    expect(p.canApproveInternally).toBe(true);
    expect(p.canApplyHold).toBe(true);
    expect(p.canReject).toBe(true);
    expect(p.canApproveReadyToProceed).toBe(false);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canReleaseHold).toBe(false);
  });

  it("compliance_analyst can apply compliance hold but not override", () => {
    const p = deriveP5Permissions(["compliance_analyst"]);
    expect(p.canApplyComplianceHold).toBe(true);
    expect(p.canApplyHold).toBe(true);
    expect(p.canOverride).toBe(false);
    expect(p.canWaive).toBe(false);
  });

  it("auditor / auditor_read_only is fully read-only", () => {
    for (const role of ["auditor", "auditor_read_only"]) {
      const p = deriveP5Permissions([role]);
      expect(p.canViewAdmin).toBe(true);
      expect(p.canViewAuditTimeline).toBe(true);
      expect(p.canMutate).toBe(false);
      expect(p.canApproveInternally).toBe(false);
      expect(p.canApproveReadyToProceed).toBe(false);
      expect(p.canReject).toBe(false);
      expect(p.canWaive).toBe(false);
      expect(p.canOverride).toBe(false);
      expect(p.canReleaseHold).toBe(false);
      expect(p.canApplyHold).toBe(false);
      expect(p.canReviewEvidence).toBe(false);
    }
  });

  it("developer_technical_admin gets diagnostics only — no business decisions", () => {
    const p = deriveP5Permissions(["developer_technical_admin"]);
    expect(p.canViewAdmin).toBe(true);
    expect(p.canViewProviderDiagnostics).toBe(true);
    expect(p.canApproveInternally).toBe(false);
    expect(p.canApproveReadyToProceed).toBe(false);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canReleaseHold).toBe(false);
    expect(p.canReject).toBe(false);
    expect(p.canMutate).toBe(false);
  });

  it("customer_entity_owner / funder_external_reviewer are denied admin", () => {
    for (const role of ["customer_entity_owner", "funder_external_reviewer"]) {
      const p = deriveP5Permissions([role]);
      expect(p.canViewAdmin).toBe(false);
      expect(p.canMutate).toBe(false);
    }
  });

  it("compound roles widen — admin + auditor still gets admin powers", () => {
    const p = deriveP5Permissions(["auditor", "platform_admin"]);
    expect(p.canMutate).toBe(true);
    expect(p.canWaive).toBe(true);
  });
});
