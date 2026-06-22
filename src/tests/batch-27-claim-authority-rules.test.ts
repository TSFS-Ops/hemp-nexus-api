// Batch 27 — Claim and authority operating rules tests.
import { describe, it, expect } from "vitest";
import {
  CLAIM_AUTHORITY_REQUIRES_VERIFIED_EMAIL,
  evaluateClaimGate,
  requiresVerifiedEmail,
  CLAIMANT_ROLE_DISPOSITION,
  claimantRoleDisposition,
  isClaimantRoleAllowedToStart,
  CLAIM_EVIDENCE_BY_LEGAL_FORM,
  requiredEvidenceForLegalForm,
  CLAIM_EVIDENCE_REFRESH_MONTHS,
  isEvidenceFresh,
  UNLISTED_CLAIMANT_REVIEW_STATE,
  UNLISTED_CLAIMANT_BLOCKED_CAPABILITIES,
  unlistedClaimantBlocks,
  CLAIM_CONFLICT_STATES,
  isClaimConflict,
  claimReviewerRoleFor,
  CLAIM_APPROVAL_UNLOCKS,
  CLAIM_APPROVAL_DOES_NOT_UNLOCK,
  claimApprovalUnlocks,
  claimApprovalBlocks,
  CLAIM_APPROVED_LIMITED_WORDING,
  AUTHORITY_SCOPES,
  isAuthorityScopeAllowed,
  AUTHORITY_TWO_PERSON_SCOPES,
  requiresTwoPersonApproval,
  AUTHORITY_COMPLIANCE_OWNER_REQUIRED_SCOPES,
  requiresComplianceOwner,
  AUTHORITY_FORBIDDEN_CAPABILITIES,
  AUTHORITY_DEFAULT_EXPIRY_MONTHS_GENERAL,
  AUTHORITY_DEFAULT_EXPIRY_MONTHS_BANK_OR_API,
  defaultExpiryMonthsForScope,
  AUTHORITY_BLOCKING_STATES,
  blocksSensitiveAction,
  evaluateAuthorityAction,
  AUTHORITY_FULL_IS_DEFAULT,
  AUTHORITY_FULL_REQUIRES_COMPLIANCE_OWNER,
  CLAIM_AUTHORITY_WORDING,
  CLAIM_AUTHORITY_AUDIT_EVENTS,
} from "@/lib/registry-claim-authority-rules";

describe("Batch 27 — registration/verification gate", () => {
  it("unauthenticated user can search and view public profile", () => {
    expect(evaluateClaimGate({ action: "search", authenticated: false, email_verified: false }))
      .toEqual({ allowed: true });
    expect(evaluateClaimGate({ action: "view_public_profile", authenticated: false, email_verified: false }))
      .toEqual({ allowed: true });
  });
  it("unauthenticated user cannot start claim", () => {
    expect(evaluateClaimGate({ action: "claim_start", authenticated: false, email_verified: false }))
      .toEqual({ allowed: false, reason: "must_register" });
  });
  it("unverified email cannot submit evidence", () => {
    expect(evaluateClaimGate({ action: "claim_evidence_submit", authenticated: true, email_verified: false }))
      .toEqual({ allowed: false, reason: "must_verify_email" });
  });
  it("verified user can start claim", () => {
    expect(evaluateClaimGate({ action: "claim_start", authenticated: true, email_verified: true }))
      .toEqual({ allowed: true });
  });
  it("requiresVerifiedEmail covers all six gated actions", () => {
    for (const a of CLAIM_AUTHORITY_REQUIRES_VERIFIED_EMAIL) {
      expect(requiresVerifiedEmail(a)).toBe(true);
    }
  });
});

describe("Batch 27 — claimant roles", () => {
  it("director/member/owner/proprietor allowed with evidence", () => {
    expect(claimantRoleDisposition("director_or_member_or_owner_or_proprietor"))
      .toBe("allowed_with_evidence");
  });
  it("authorised employee requires authority review", () => {
    expect(claimantRoleDisposition("authorised_employee"))
      .toBe("allowed_with_evidence_and_authority_review");
  });
  it("lawyer/accountant/adviser/consultant is enquiry-only until mandate approved", () => {
    expect(claimantRoleDisposition("lawyer_accountant_adviser_consultant"))
      .toBe("enquiry_only_until_mandate_approved");
  });
  it("bank/institution representative enquiry-only unless contract authorises", () => {
    expect(claimantRoleDisposition("bank_or_institution_representative"))
      .toBe("enquiry_only_unless_contract_authorises");
  });
  it("unrelated third party blocked", () => {
    expect(claimantRoleDisposition("unrelated_third_party")).toBe("blocked");
    expect(isClaimantRoleAllowedToStart("unrelated_third_party")).toBe(false);
  });
  it("platform_admin assisted cannot self-approve", () => {
    expect(claimantRoleDisposition("platform_admin_assisted"))
      .toBe("admin_assisted_no_self_approval");
  });
});

describe("Batch 27 — evidence matrix", () => {
  it("varies by legal form", () => {
    expect(requiredEvidenceForLegalForm("sole_proprietor"))
      .not.toEqual(requiredEvidenceForLegalForm("company"));
    expect(requiredEvidenceForLegalForm("close_corporation"))
      .toContain("ck_or_registry_extract");
    expect(requiredEvidenceForLegalForm("partnership"))
      .toContain("partnership_agreement_or_mandate");
    expect(requiredEvidenceForLegalForm("other_legal_form"))
      .toContain("official_formation_document");
  });
  it("12-month refresh rule with approved exception override", () => {
    expect(CLAIM_EVIDENCE_REFRESH_MONTHS).toBe(12);
    const old = new Date(Date.UTC(2024, 0, 1)).toISOString();
    const now = new Date(Date.UTC(2026, 0, 1)).toISOString();
    expect(isEvidenceFresh({ issued_at: old, now })).toBe(false);
    expect(isEvidenceFresh({
      issued_at: old, now,
      approved_exception: { reviewer: "u", reason: "ok", approved_at: now },
    })).toBe(true);
    const recent = new Date(Date.UTC(2025, 6, 1)).toISOString();
    expect(isEvidenceFresh({ issued_at: recent, now })).toBe(true);
  });
});

describe("Batch 27 — unlisted claimant", () => {
  it("review state pinned", () => {
    expect(UNLISTED_CLAIMANT_REVIEW_STATE).toBe("unlisted_claimant_review");
  });
  it("blocks sensitive capabilities", () => {
    for (const c of UNLISTED_CLAIMANT_BLOCKED_CAPABILITIES) {
      expect(unlistedClaimantBlocks(c)).toBe(true);
    }
    expect(unlistedClaimantBlocks("view_public_profile")).toBe(false);
  });
});

describe("Batch 27 — multi-claim / conflicts", () => {
  it("conflict states are recognised", () => {
    for (const s of CLAIM_CONFLICT_STATES) expect(isClaimConflict(s)).toBe(true);
  });
  it("compliance_owner reviews conflicts", () => {
    expect(claimReviewerRoleFor("competing_claim", false)).toBe("compliance_owner");
    expect(claimReviewerRoleFor("claim_submitted", false)).toBe("data_governance_owner");
    expect(claimReviewerRoleFor("claim_submitted", true)).toBe("compliance_owner");
  });
});

describe("Batch 27 — claim approval is limited", () => {
  it("unlocks only limited profile edit + authority request", () => {
    expect(CLAIM_APPROVAL_UNLOCKS).toEqual([
      "edit_profile_limited_non_sensitive",
      "request_authority_to_act",
    ]);
    expect(claimApprovalUnlocks("request_authority_to_act")).toBe(true);
  });
  it("does NOT unlock bank/API/manage_users", () => {
    for (const c of ["submit_bank_details", "consent_to_api_sharing", "manage_users"]) {
      expect(claimApprovalBlocks(c)).toBe(true);
      expect(claimApprovalUnlocks(c)).toBe(false);
    }
    expect(CLAIM_APPROVAL_DOES_NOT_UNLOCK).toContain("approve_own_authority");
  });
  it("limited approval wording matches accepted Batch 19A wording", () => {
    expect(CLAIM_APPROVED_LIMITED_WORDING).toMatch(/Claim reviewed/);
    expect(CLAIM_APPROVED_LIMITED_WORDING).toMatch(/not verified/);
  });
});

describe("Batch 27 — authority scopes and approvals", () => {
  it("scope allow-list is closed", () => {
    expect(AUTHORITY_SCOPES.length).toBe(7);
    expect(isAuthorityScopeAllowed("submit_bank_details")).toBe(true);
    expect(isAuthorityScopeAllowed("delete_audit_history")).toBe(false);
  });
  it("two-person approval required for bank/api/manage_users", () => {
    expect(AUTHORITY_TWO_PERSON_SCOPES).toEqual([
      "submit_bank_details",
      "consent_to_api_sharing",
      "manage_users",
    ]);
    expect(requiresTwoPersonApproval("submit_bank_details")).toBe(true);
    expect(requiresTwoPersonApproval("edit_profile")).toBe(false);
  });
  it("compliance_owner required for bank/api/disputes", () => {
    for (const s of AUTHORITY_COMPLIANCE_OWNER_REQUIRED_SCOPES) {
      expect(requiresComplianceOwner(s)).toBe(true);
    }
  });
  it("default expiry 12 months general, 6 months bank/api", () => {
    expect(AUTHORITY_DEFAULT_EXPIRY_MONTHS_GENERAL).toBe(12);
    expect(AUTHORITY_DEFAULT_EXPIRY_MONTHS_BANK_OR_API).toBe(6);
    expect(defaultExpiryMonthsForScope("edit_profile")).toBe(12);
    expect(defaultExpiryMonthsForScope("submit_bank_details")).toBe(6);
    expect(defaultExpiryMonthsForScope("consent_to_api_sharing")).toBe(6);
  });
  it("full authority is not default and requires compliance owner", () => {
    expect(AUTHORITY_FULL_IS_DEFAULT).toBe(false);
    expect(AUTHORITY_FULL_REQUIRES_COMPLIANCE_OWNER).toBe(true);
  });
  it("authority never grants forbidden capabilities", () => {
    expect(AUTHORITY_FORBIDDEN_CAPABILITIES).toContain("change_verification_results");
    expect(AUTHORITY_FORBIDDEN_CAPABILITIES).toContain("override_disputes");
    expect(AUTHORITY_FORBIDDEN_CAPABILITIES).toContain("approve_own_authority");
  });
});

describe("Batch 27 — authority evaluation", () => {
  const base = {
    scope: "edit_profile" as const,
    approvers: ["approver-1"],
    approver_roles: ["platform_admin"],
    subject_user_id: "subject",
    action_user_id: "approver-1",
  };
  it("blocks self-approval", () => {
    expect(evaluateAuthorityAction({
      ...base, state: "active", subject_user_id: "u", action_user_id: "u",
    })).toEqual({ allowed: false, reason: "self_approval_blocked" });
  });
  it("blocks expired / revoked / suspended", () => {
    for (const s of ["expired", "revoked", "suspended_disputed"] as const) {
      const r = evaluateAuthorityAction({ ...base, state: s });
      expect(r.allowed).toBe(false);
    }
    for (const s of AUTHORITY_BLOCKING_STATES) {
      expect(blocksSensitiveAction(s)).toBe(true);
    }
    expect(blocksSensitiveAction("active")).toBe(false);
  });
  it("allows active general authority with single approver", () => {
    expect(evaluateAuthorityAction({ ...base, state: "active" }))
      .toEqual({ allowed: true });
  });
  it("requires second approver for bank_submit", () => {
    expect(evaluateAuthorityAction({
      ...base, state: "active", scope: "submit_bank_details",
      approvers: ["a"], approver_roles: ["platform_admin"],
    })).toEqual({ allowed: false, reason: "needs_second_approval" });
  });
  it("requires compliance_owner for bank_submit even with two approvers", () => {
    expect(evaluateAuthorityAction({
      ...base, state: "active", scope: "submit_bank_details",
      approvers: ["a", "b"], approver_roles: ["platform_admin", "data_governance_owner"],
    })).toEqual({ allowed: false, reason: "needs_compliance_owner" });
  });
  it("allows bank_submit with two distinct approvers including compliance_owner", () => {
    expect(evaluateAuthorityAction({
      ...base, state: "active", scope: "submit_bank_details",
      approvers: ["a", "b"], approver_roles: ["platform_admin", "compliance_owner"],
    })).toEqual({ allowed: true });
  });
  it("rejects unknown scope", () => {
    expect(evaluateAuthorityAction({
      ...base, state: "active", scope: "delete_audit_history" as any,
    })).toEqual({ allowed: false, reason: "scope_not_allowed" });
  });
});

describe("Batch 27 — wording and audit", () => {
  it("ships disclaimers verbatim", () => {
    expect(CLAIM_AUTHORITY_WORDING.claim_approval_limited)
      .toBe(CLAIM_APPROVED_LIMITED_WORDING);
    expect(CLAIM_AUTHORITY_WORDING.authority_scope_disclaimer)
      .toMatch(/scoped and temporary/);
    expect(CLAIM_AUTHORITY_WORDING.self_approval_blocked_notice)
      .toMatch(/cannot approve your own authority/);
  });
  it("audit catalogue covers gate, conflict, approval, scope, expiry", () => {
    expect(CLAIM_AUTHORITY_AUDIT_EVENTS).toContain("registry_claim_gate_evaluated");
    expect(CLAIM_AUTHORITY_AUDIT_EVENTS).toContain("registry_authority_self_approval_blocked");
    expect(CLAIM_AUTHORITY_AUDIT_EVENTS).toContain("registry_authority_sensitive_action_blocked");
  });
});

describe("Batch 27 — disposition map is exhaustive", () => {
  it("every claimant role has a disposition", () => {
    for (const role of Object.keys(CLAIMANT_ROLE_DISPOSITION)) {
      expect(typeof CLAIMANT_ROLE_DISPOSITION[role as keyof typeof CLAIMANT_ROLE_DISPOSITION])
        .toBe("string");
    }
  });
  it("evidence map covers every legal form", () => {
    for (const form of Object.keys(CLAIM_EVIDENCE_BY_LEGAL_FORM)) {
      expect(requiredEvidenceForLegalForm(form as any).length).toBeGreaterThan(0);
    }
  });
});
