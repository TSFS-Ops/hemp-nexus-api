import { describe, it, expect } from "vitest";
import {
  REGISTRY_AUTHORITY_B12_STATES,
  REGISTRY_AUTHORITY_SCOPES,
  REGISTRY_AUTHORITY_SENSITIVE_SCOPES,
  REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES,
  REGISTRY_AUTHORITY_EVIDENCE_STATES,
  REGISTRY_AUTHORITY_SCOPE_DECISION_STATES,
  REGISTRY_AUTHORITY_DEFAULT_EXPIRY_DAYS,
  REGISTRY_AUTHORITY_B12_AUDIT_EVENT_NAMES,
  REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT,
  REGISTRY_AUTHORITY_B12_PUBLIC_APPROVAL_NOTICE,
  getAuthorityRequirements,
  checkActiveAuthority,
  reduceAuthorityStatusFromScopeDecisions,
} from "@/lib/registry-authority-workflow";

describe("Batch 12 — Authority-to-Act SSOT", () => {
  it("exposes all required statuses", () => {
    for (const s of [
      "submitted","evidence_required","under_review","more_evidence_requested",
      "evidence_resubmitted","partially_approved","approved","rejected",
      "suspended","revoked","expired","cancelled","withdrawn","disputed","escalated",
    ]) {
      expect(REGISTRY_AUTHORITY_B12_STATES).toContain(s);
    }
  });

  it("includes all canonical scopes and sensitive subset", () => {
    expect(REGISTRY_AUTHORITY_SCOPES.length).toBe(10);
    expect(REGISTRY_AUTHORITY_SENSITIVE_SCOPES).toContain("bank_detail_submission");
    expect(REGISTRY_AUTHORITY_SENSITIVE_SCOPES).toContain("authority_delegation_request");
    expect(REGISTRY_AUTHORITY_SENSITIVE_SCOPES).not.toContain("profile_correction_request");
  });

  it("delegation scope has 30-day default expiry, low-risk 180, sensitive 90", () => {
    expect(REGISTRY_AUTHORITY_DEFAULT_EXPIRY_DAYS.authority_delegation_request).toBe(30);
    expect(REGISTRY_AUTHORITY_DEFAULT_EXPIRY_DAYS.profile_correction_request).toBe(180);
    expect(REGISTRY_AUTHORITY_DEFAULT_EXPIRY_DAYS.bank_detail_submission).toBe(90);
  });

  it("approval acknowledgement copy mentions no-verification of profile and bank", () => {
    expect(REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT).toMatch(/does not verify the company profile/);
    expect(REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT).toMatch(/confirm bank details/);
    expect(REGISTRY_AUTHORITY_B12_PUBLIC_APPROVAL_NOTICE).toMatch(/selected scopes only/);
  });

  it("audit event names contain Batch 12 set", () => {
    for (const ev of [
      "registry_authority_submitted",
      "registry_authority_scope_approved",
      "registry_authority_partially_approved",
      "registry_authority_approved",
      "registry_authority_revoked",
      "registry_authority_active_check_performed",
      "registry_authority_notification_logged",
    ]) {
      expect(REGISTRY_AUTHORITY_B12_AUDIT_EVENT_NAMES).toContain(ev);
    }
  });

  describe("requirements engine", () => {
    it("blocks submission when no approved claim", () => {
      const r = getAuthorityRequirements({
        countryCode: "ZA", approvedClaimType: null, claimantType: "listed_director",
        requestedScopes: ["profile_correction_request"], claimantListedInRegistryPeople: false,
        claimantIsProfessionalRepresentative: false, mandateEvidencePresent: false,
        presentEvidenceCategories: ["claimant_approved_claim_reference","declaration"],
        companyLifecycleState: "active", claimConflictActive: false,
      });
      expect(r.canSubmit).toBe(false);
      expect(r.requestBlockers).toContain("approved_claim_required");
    });

    it("sensitive scope requires identity proof and mandate", () => {
      const r = getAuthorityRequirements({
        countryCode: "ZA", approvedClaimType: "approved", claimantType: "listed_director",
        requestedScopes: ["bank_detail_submission"], claimantListedInRegistryPeople: true,
        claimantIsProfessionalRepresentative: false, mandateEvidencePresent: false,
        presentEvidenceCategories: ["claimant_approved_claim_reference","declaration"],
        companyLifecycleState: "active", claimConflictActive: false,
      });
      expect(r.canSubmit).toBe(false);
      expect(r.scopes[0].missingEvidence).toContain("identity_proof");
      expect(r.scopes[0].requiresComplianceReview).toBe(true);
    });

    it("delegation scope requires two-person approval", () => {
      const r = getAuthorityRequirements({
        countryCode: "ZA", approvedClaimType: "approved", claimantType: "listed_director",
        requestedScopes: ["authority_delegation_request"], claimantListedInRegistryPeople: true,
        claimantIsProfessionalRepresentative: false, mandateEvidencePresent: true,
        presentEvidenceCategories: [
          "claimant_approved_claim_reference","declaration","identity_proof",
          "company_mandate","delegated_authority_letter",
        ],
        companyLifecycleState: "active", claimConflictActive: false,
      });
      expect(r.requiresTwoPersonApproval).toBe(true);
      expect(r.canSubmit).toBe(true);
    });

    it("claim conflict blocks sensitive scope submission", () => {
      const r = getAuthorityRequirements({
        countryCode: "ZA", approvedClaimType: "approved", claimantType: "listed_director",
        requestedScopes: ["bank_detail_submission"], claimantListedInRegistryPeople: true,
        claimantIsProfessionalRepresentative: false, mandateEvidencePresent: true,
        presentEvidenceCategories: [
          "claimant_approved_claim_reference","declaration","identity_proof",
          "company_mandate","bank_detail_authority_proof",
        ],
        companyLifecycleState: "active", claimConflictActive: true,
      });
      expect(r.canSubmit).toBe(false);
      expect(r.scopes[0].blockers).toContain("claim_conflict_locked");
    });
  });

  describe("active authority check", () => {
    it("returns allowed for approved+unexpired scope", () => {
      expect(checkActiveAuthority({
        scope: "bank_detail_submission",
        scopeStatus: "approved",
        authorityStatus: "approved",
        expiryAt: new Date(Date.now() + 86400000).toISOString(),
        suspended: false, revoked: false, disputed: false,
        claimConflictActive: false, companyLifecycleState: "active",
      })).toBe("allowed");
    });
    it("returns authority_expired when past expiry", () => {
      expect(checkActiveAuthority({
        scope: "bank_detail_submission", scopeStatus: "approved", authorityStatus: "approved",
        expiryAt: new Date(Date.now() - 86400000).toISOString(),
        suspended: false, revoked: false, disputed: false,
        claimConflictActive: false, companyLifecycleState: "active",
      })).toBe("authority_expired");
    });
    it("returns authority_revoked/suspended/disputed", () => {
      const base = {
        scope: "bank_detail_submission" as const, scopeStatus: "approved" as const, authorityStatus: "approved" as const,
        expiryAt: new Date(Date.now() + 86400000).toISOString(),
        claimConflictActive: false, companyLifecycleState: "active",
      };
      expect(checkActiveAuthority({ ...base, suspended: false, revoked: true, disputed: false })).toBe("authority_revoked");
      expect(checkActiveAuthority({ ...base, suspended: true, revoked: false, disputed: false })).toBe("authority_suspended");
      expect(checkActiveAuthority({ ...base, suspended: false, revoked: false, disputed: true })).toBe("authority_disputed");
    });
    it("returns claim_conflict_locked / company_disabled / company_archived", () => {
      const base = {
        scope: "bank_detail_submission" as const, scopeStatus: "approved" as const, authorityStatus: "approved" as const,
        expiryAt: null, suspended: false, revoked: false, disputed: false,
      };
      expect(checkActiveAuthority({ ...base, claimConflictActive: true, companyLifecycleState: "active" })).toBe("claim_conflict_locked");
      expect(checkActiveAuthority({ ...base, claimConflictActive: false, companyLifecycleState: "disabled" })).toBe("company_disabled");
      expect(checkActiveAuthority({ ...base, claimConflictActive: false, companyLifecycleState: "archived" })).toBe("company_archived");
    });
    it("returns scope_missing when scope not approved", () => {
      expect(checkActiveAuthority({
        scope: "bank_detail_submission", scopeStatus: "not_present", authorityStatus: "not_present",
        expiryAt: null, suspended: false, revoked: false, disputed: false,
        claimConflictActive: false, companyLifecycleState: "active",
      })).toBe("scope_missing");
    });
  });

  describe("status reducer", () => {
    it("reduces to approved when all approved", () => {
      expect(reduceAuthorityStatusFromScopeDecisions([
        { decision: "approved" }, { decision: "approved" },
      ])).toBe("approved");
    });
    it("reduces to partially_approved when mixed approve/reject", () => {
      expect(reduceAuthorityStatusFromScopeDecisions([
        { decision: "approved" }, { decision: "rejected" },
      ])).toBe("partially_approved");
    });
    it("reduces to rejected when all rejected", () => {
      expect(reduceAuthorityStatusFromScopeDecisions([
        { decision: "rejected" }, { decision: "rejected" },
      ])).toBe("rejected");
    });
    it("reduces to more_evidence_requested when blockers remain", () => {
      expect(reduceAuthorityStatusFromScopeDecisions([
        { decision: "more_evidence_requested" }, { decision: "under_review" },
      ])).toBe("more_evidence_requested");
    });
  });

  it("evidence categories include claim ref + delegation letter + sensitive proofs", () => {
    expect(REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES).toContain("claimant_approved_claim_reference");
    expect(REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES).toContain("delegated_authority_letter");
    expect(REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES).toContain("bank_detail_authority_proof");
    expect(REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES).toContain("api_sharing_consent_proof");
    expect(REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES).toContain("user_management_authority_proof");
    expect(REGISTRY_AUTHORITY_EVIDENCE_STATES).toContain("metadata_only");
    expect(REGISTRY_AUTHORITY_SCOPE_DECISION_STATES).toContain("approved");
  });
});
