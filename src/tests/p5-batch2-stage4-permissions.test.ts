import { describe, expect, it } from "vitest";
import { deriveP5B2Permissions } from "@/hooks/useP5Batch2Permissions";

describe("p5-batch2 stage 4 — permissions", () => {
  it("categorises platform_admin as platform_admin with full action set", () => {
    const p = deriveP5B2Permissions(["platform_admin"]);
    expect(p.category).toBe("platform_admin");
    expect(p.canViewAdminArea).toBe(true);
    expect(p.canViewDashboard).toBe(true);
    expect(p.canViewRecordDetail).toBe(true);
    expect(p.canViewEvidencePack).toBe(true);
    expect(p.canViewFinalitySnapshot).toBe(true);
    expect(p.canViewSensitiveAccessLog).toBe(true);
    expect(p.canViewReviewerInternalNotes).toBe(true);
    expect(p.canReviewEvidence).toBe(true);
    expect(p.canSetProviderState).toBe(true);
    expect(p.canWaiveEvidence).toBe(true);
    expect(p.canSnapshotFinalityPack).toBe(true);
    expect(p.canUnmaskSensitive).toBe(true);
  });

  it("categorises compliance_analyst as compliance_owner without waive/snapshot rights", () => {
    const p = deriveP5B2Permissions(["compliance_analyst"]);
    expect(p.category).toBe("compliance_owner");
    expect(p.canReviewEvidence).toBe(true);
    expect(p.canViewReviewerInternalNotes).toBe(true);
    expect(p.canWaiveEvidence).toBe(false);
    expect(p.canSnapshotFinalityPack).toBe(false);
    expect(p.canUnmaskSensitive).toBe(true);
  });

  it("categorises operator_case_manager as operator with no waive/snapshot/provider rights", () => {
    const p = deriveP5B2Permissions(["operator_case_manager"]);
    expect(p.category).toBe("operator");
    expect(p.canReviewEvidence).toBe(true);
    expect(p.canSetProviderState).toBe(false);
    expect(p.canWaiveEvidence).toBe(false);
    expect(p.canSnapshotFinalityPack).toBe(false);
    expect(p.canUnmaskSensitive).toBe(false);
    expect(p.canViewReviewerInternalNotes).toBe(false);
  });

  it("auditor is read-only", () => {
    const p = deriveP5B2Permissions(["auditor"]);
    expect(p.category).toBe("auditor");
    expect(p.canViewAdminArea).toBe(true);
    expect(p.canReviewEvidence).toBe(false);
    expect(p.canWaiveEvidence).toBe(false);
    expect(p.canSetProviderState).toBe(false);
    expect(p.canUnmaskSensitive).toBe(false);
    expect(p.canSnapshotFinalityPack).toBe(false);
  });

  it("non-privileged roles cannot access Stage 4 surfaces", () => {
    for (const role of ["customer_entity_owner", "funder_external_reviewer", "api_user", "counterparty"]) {
      const p = deriveP5B2Permissions([role]);
      expect(p.category).toBe("non_privileged");
      expect(p.canViewAdminArea).toBe(false);
      expect(p.canViewDashboard).toBe(false);
      expect(p.canViewRecordDetail).toBe(false);
      expect(p.canViewEvidencePack).toBe(false);
      expect(p.canViewFinalitySnapshot).toBe(false);
      expect(p.canReviewEvidence).toBe(false);
      expect(p.canWaiveEvidence).toBe(false);
      expect(p.canSnapshotFinalityPack).toBe(false);
      expect(p.canUnmaskSensitive).toBe(false);
    }
  });

  it("empty role set is non-privileged", () => {
    const p = deriveP5B2Permissions([]);
    expect(p.category).toBe("non_privileged");
    expect(p.canViewAdminArea).toBe(false);
  });

  it("funder and api_user roles never appear in any allow-list", () => {
    const denied = deriveP5B2Permissions(["funder", "api_customer", "funder_external_reviewer"]);
    expect(denied.canViewAdminArea).toBe(false);
    expect(denied.canReviewEvidence).toBe(false);
    expect(denied.canSnapshotFinalityPack).toBe(false);
  });
});
