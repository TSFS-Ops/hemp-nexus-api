/**
 * Stage 5 — Customer / funder / API-client permission scoping.
 *
 * Asserts the Stage 4 `deriveP5Permissions` exposes the new Stage 5
 * customer/funder capabilities correctly without granting business
 * decision rights to disallowed roles.
 */
import { describe, it, expect } from "vitest";
import { deriveP5Permissions } from "@/hooks/useP5Permissions";

describe("P-5 Stage 5 customer/funder/api-client permissions", () => {
  it("customer_entity_owner sees their own readiness and can submit evidence", () => {
    const p = deriveP5Permissions(["customer_entity_owner"]);
    expect(p.canViewCustomerReadiness).toBe(true);
    expect(p.canSubmitCustomerEvidence).toBe(true);
    // Must NOT gain any admin/reviewer mutation rights.
    expect(p.canMutate).toBe(false);
    expect(p.canApproveReadyToProceed).toBe(false);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canReject).toBe(false);
    expect(p.canApplyHold).toBe(false);
    expect(p.canReleaseHold).toBe(false);
    expect(p.canViewAdmin).toBe(false);
    // Must not see funder pack.
    expect(p.canViewFunderEvidencePack).toBe(false);
  });

  it("funder_external_reviewer sees evidence pack but cannot mutate anything", () => {
    const p = deriveP5Permissions(["funder_external_reviewer"]);
    expect(p.canViewFunderEvidencePack).toBe(true);
    expect(p.canFunderMutate).toBe(false);
    expect(p.canMutate).toBe(false);
    expect(p.canApproveReadyToProceed).toBe(false);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canReject).toBe(false);
    expect(p.canSubmitCustomerEvidence).toBe(false);
    expect(p.canViewCustomerReadiness).toBe(false);
    expect(p.canViewAdmin).toBe(false);
  });

  it("developer_technical_admin does not gain business decision rights from Stage 5", () => {
    const p = deriveP5Permissions(["developer_technical_admin"]);
    expect(p.canViewAdmin).toBe(true); // diagnostics only
    expect(p.canMutate).toBe(false);
    expect(p.canApproveReadyToProceed).toBe(false);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canReject).toBe(false);
    expect(p.canApplyHold).toBe(false);
    expect(p.canReleaseHold).toBe(false);
    expect(p.canSubmitCustomerEvidence).toBe(false);
    expect(p.canFunderMutate).toBe(false);
  });

  it("auditor / auditor_read_only stays read-only across Stage 5", () => {
    for (const role of ["auditor", "auditor_read_only"]) {
      const p = deriveP5Permissions([role]);
      expect(p.canMutate).toBe(false);
      expect(p.canSubmitCustomerEvidence).toBe(false);
      expect(p.canFunderMutate).toBe(false);
      expect(p.canViewCustomerReadiness).toBe(false);
      expect(p.canViewFunderEvidencePack).toBe(false);
    }
  });

  it("platform_admin can preview both customer and funder surfaces", () => {
    const p = deriveP5Permissions(["platform_admin"]);
    expect(p.canViewCustomerReadiness).toBe(true);
    expect(p.canViewFunderEvidencePack).toBe(true);
    // But still not the customer-evidence submission affordance.
    expect(p.canSubmitCustomerEvidence).toBe(false);
  });

  it("anonymous / no roles sees nothing Stage-5", () => {
    const p = deriveP5Permissions([]);
    expect(p.canViewCustomerReadiness).toBe(false);
    expect(p.canViewFunderEvidencePack).toBe(false);
    expect(p.canSubmitCustomerEvidence).toBe(false);
    expect(p.canFunderMutate).toBe(false);
  });
});
