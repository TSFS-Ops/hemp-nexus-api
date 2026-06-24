/**
 * P-5 Batch 1 — Final Embarrassment-Prevention Audit (permission leak).
 *
 * Pure role-matrix check across `deriveP5Permissions`. Asserts that:
 *   - funder is strictly read-only
 *   - developer/technical admin gets diagnostics only
 *   - auditor cannot mutate
 *   - customer cannot see admin surfaces
 *   - reviewers cannot waive/override/release-hold
 *   - operator_case_manager cannot approve final readiness
 *   - API client (no app_role) has no admin access
 */
import { describe, expect, it } from "vitest";
import { deriveP5Permissions } from "@/hooks/useP5Permissions";

const ROLES = {
  platform_admin: ["platform_admin"],
  executive_approver: ["executive_approver"],
  compliance_admin: ["compliance_admin"],
  compliance_reviewer: ["compliance_reviewer"],
  governance_reviewer: ["governance_reviewer"],
  operator_case_manager: ["operator_case_manager"],
  developer_technical_admin: ["developer_technical_admin"],
  customer_entity_owner: ["customer_entity_owner"],
  funder_external_reviewer: ["funder_external_reviewer"],
  auditor_read_only: ["auditor_read_only"],
  api_client: [], // no app role
} as const;

describe("Permission matrix — funder + read-only roles", () => {
  it("funder is strictly read-only on P-5", () => {
    const p = deriveP5Permissions(ROLES.funder_external_reviewer);
    expect(p.canFunderMutate).toBe(false);
    expect(p.canMutate).toBe(false);
    expect(p.canApproveInternally).toBe(false);
    expect(p.canApproveReadyToProceed).toBe(false);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canApplyHold).toBe(false);
    expect(p.canReleaseHold).toBe(false);
    expect(p.canReject).toBe(false);
    expect(p.canViewAdmin).toBe(false);
  });

  it("auditor_read_only cannot mutate anything", () => {
    const p = deriveP5Permissions(ROLES.auditor_read_only);
    expect(p.canMutate).toBe(false);
    expect(p.canViewAdmin).toBe(true); // read-only timeline + diagnostics
    expect(p.canApproveInternally).toBe(false);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canApplyHold).toBe(false);
    expect(p.canReject).toBe(false);
  });

  it("customer_entity_owner has no admin access", () => {
    const p = deriveP5Permissions(ROLES.customer_entity_owner);
    expect(p.canViewAdmin).toBe(false);
    expect(p.canViewAuditTimeline).toBe(false);
    expect(p.canMutate).toBe(false);
    expect(p.canViewCustomerReadiness).toBe(true);
    expect(p.canSubmitCustomerEvidence).toBe(true);
  });

  it("API client (no app role) has no admin and no customer/funder views", () => {
    const p = deriveP5Permissions(ROLES.api_client);
    expect(p.canViewAdmin).toBe(false);
    expect(p.canViewCustomerReadiness).toBe(false);
    expect(p.canViewFunderEvidencePack).toBe(false);
    expect(p.canMutate).toBe(false);
  });
});

describe("Permission matrix — developer / reviewer / operator constraints", () => {
  it("developer_technical_admin has diagnostics, no business decisions", () => {
    const p = deriveP5Permissions(ROLES.developer_technical_admin);
    expect(p.canViewAdmin).toBe(true);
    expect(p.canViewProviderDiagnostics).toBe(true);
    expect(p.canApproveInternally).toBe(false);
    expect(p.canApproveReadyToProceed).toBe(false);
    expect(p.canReject).toBe(false);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canApplyHold).toBe(false);
    expect(p.canReleaseHold).toBe(false);
    expect(p.canMutate).toBe(false);
  });

  it("compliance_reviewer cannot waive/override/release-hold", () => {
    const p = deriveP5Permissions(ROLES.compliance_reviewer);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canReleaseHold).toBe(false);
    expect(p.canApproveReadyToProceed).toBe(false);
    expect(p.canApproveInternally).toBe(true);
  });

  it("governance_reviewer cannot release compliance hold or waive/override", () => {
    const p = deriveP5Permissions(ROLES.governance_reviewer);
    expect(p.canReleaseHold).toBe(false);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canApproveReadyToProceed).toBe(false);
  });

  it("operator_case_manager cannot approve final readiness or waive/override", () => {
    const p = deriveP5Permissions(ROLES.operator_case_manager);
    expect(p.canApproveReadyToProceed).toBe(false);
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canReleaseHold).toBe(false);
  });
});

describe("Permission matrix — admin + executive affordances", () => {
  it("platform_admin has full P-5 admin affordances", () => {
    const p = deriveP5Permissions(ROLES.platform_admin);
    expect(p.canApproveReadyToProceed).toBe(true);
    expect(p.canWaive).toBe(true);
    expect(p.canOverride).toBe(true);
    expect(p.canReleaseHold).toBe(true);
    expect(p.canReopen).toBe(true);
    expect(p.canArchive).toBe(true);
  });

  it("executive_approver has full admin affordances", () => {
    const p = deriveP5Permissions(ROLES.executive_approver);
    expect(p.canApproveReadyToProceed).toBe(true);
    expect(p.canWaive).toBe(true);
    expect(p.canOverride).toBe(true);
    expect(p.canReleaseHold).toBe(true);
  });

  it("compliance_admin can apply compliance hold and review", () => {
    const p = deriveP5Permissions(ROLES.compliance_admin);
    expect(p.canApplyComplianceHold).toBe(true);
    expect(p.canApproveInternally).toBe(true);
    // Compliance admin is not a P-5 super-admin; cannot waive/override/RTP.
    expect(p.canWaive).toBe(false);
    expect(p.canOverride).toBe(false);
    expect(p.canApproveReadyToProceed).toBe(false);
  });
});
