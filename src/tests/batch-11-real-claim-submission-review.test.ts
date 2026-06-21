/**
 * Batch 11 — Real claim submission, evidence upload and review.
 * SSOT/engine/wording tests. Live RLS + edge-function flows are covered by
 * the e2e batch-11 suite; this file pins the static invariants.
 */
import { describe, it, expect } from "vitest";
import {
  REGISTRY_CLAIMANT_TYPES,
  REGISTRY_PROFESSIONAL_REPRESENTATIVE_TYPES,
  REGISTRY_EVIDENCE_CATEGORIES,
  REGISTRY_EVIDENCE_STATES,
  REGISTRY_CLAIM_WORKFLOW_STATUSES,
  REGISTRY_CLAIM_REVIEW_ACTIONS,
  REGISTRY_CLAIM_CONFLICT_OUTCOMES,
  REGISTRY_CLAIM_WORKFLOW_AUDIT_EVENT_NAMES,
  REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING,
  REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE,
  REGISTRY_CLAIM_REJECTION_PUBLIC_WORDING,
  REGISTRY_CLAIM_ADMIN_APPROVAL_ACK,
  REGISTRY_CLAIM_EXPIRY_DAYS,
  isClaimWorkflowTerminal,
  evaluateClaimEvidenceRequirements,
} from "@/lib/registry-claim-workflow";

describe("Batch 11 — SSOT", () => {
  it("claimant types include all 12", () => {
    expect(REGISTRY_CLAIMANT_TYPES.length).toBe(12);
    expect(REGISTRY_CLAIMANT_TYPES).toContain("listed_director");
    expect(REGISTRY_CLAIMANT_TYPES).toContain("company_secretary");
  });
  it("professional rep set is subset of claimant types", () => {
    for (const t of REGISTRY_PROFESSIONAL_REPRESENTATIVE_TYPES) {
      expect(REGISTRY_CLAIMANT_TYPES).toContain(t);
    }
  });
  it("evidence categories include declaration", () => {
    expect(REGISTRY_EVIDENCE_CATEGORIES).toContain("declaration");
    expect(REGISTRY_EVIDENCE_CATEGORIES).toContain("mandate_letter");
  });
  it("evidence states include the 8 required values", () => {
    expect(REGISTRY_EVIDENCE_STATES).toEqual([
      "uploaded","metadata_only","pending_review","accepted","rejected","expired","superseded","withdrawn",
    ]);
  });
  it("workflow statuses include all 19 required", () => {
    expect(REGISTRY_CLAIM_WORKFLOW_STATUSES.length).toBe(19);
    expect(REGISTRY_CLAIM_WORKFLOW_STATUSES).toContain("claim_conflict_locked");
    expect(REGISTRY_CLAIM_WORKFLOW_STATUSES).toContain("escalated");
  });
  it("review actions include 11 actions", () => {
    expect(REGISTRY_CLAIM_REVIEW_ACTIONS.length).toBe(11);
  });
  it("conflict outcomes include 5 outcomes", () => {
    expect(REGISTRY_CLAIM_CONFLICT_OUTCOMES.length).toBe(5);
  });
  it("audit names include 20 events", () => {
    expect(REGISTRY_CLAIM_WORKFLOW_AUDIT_EVENT_NAMES.length).toBe(20);
  });
  it("expiry defaults match policy", () => {
    expect(REGISTRY_CLAIM_EXPIRY_DAYS.draft).toBe(30);
    expect(REGISTRY_CLAIM_EXPIRY_DAYS.evidence_requested).toBe(14);
    expect(REGISTRY_CLAIM_EXPIRY_DAYS.submitted_under_review).toBe(30);
  });
});

describe("Batch 11 — Wording invariants", () => {
  it("approval public wording explicitly disclaims verification", () => {
    expect(REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING).toMatch(/does not verify/i);
    expect(REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING).toMatch(/authority-to-act/i);
    expect(REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING).toMatch(/bank details/i);
  });
  it("non-verification disclosure is a single sentence", () => {
    expect(REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE.endsWith(".")).toBe(true);
  });
  it("rejection wording asks for review before resubmission", () => {
    expect(REGISTRY_CLAIM_REJECTION_PUBLIC_WORDING).toMatch(/not approved/);
  });
  it("admin acknowledgement is mandatory and non-verifying", () => {
    expect(REGISTRY_CLAIM_ADMIN_APPROVAL_ACK).toMatch(/does not verify/);
  });
});

describe("Batch 11 — Evidence requirements engine", () => {
  const base = {
    country_code: "ZA",
    claimant_in_registry_people: false,
    uses_company_domain_email: false,
    is_professional_representative: false,
    has_mandate_evidence: false,
    current_status: "claim_started" as const,
    uploaded_categories: [],
  };

  it("sole proprietor requires proprietor + registration + declaration", () => {
    const r = evaluateClaimEvidenceRequirements({
      ...base, company_legal_form: "sole_proprietor", claimant_type: "listed_proprietor",
      claimant_in_registry_people: true,
    });
    expect(r.required).toContain("proprietor_proof");
    expect(r.required).toContain("company_registration_evidence");
    expect(r.required).toContain("declaration");
    expect(r.can_submit).toBe(false);
  });

  it("private company with listed director requires director proof", () => {
    const r = evaluateClaimEvidenceRequirements({
      ...base, company_legal_form: "private_company", claimant_type: "listed_director",
      claimant_in_registry_people: true,
    });
    expect(r.required).toContain("director_member_officer_proof");
    expect(r.required).not.toContain("board_company_authorisation");
  });

  it("private company with unlisted claimant requires mandate + board authorisation", () => {
    const r = evaluateClaimEvidenceRequirements({
      ...base, company_legal_form: "private_company", claimant_type: "employee_with_mandate",
    });
    expect(r.required).toContain("mandate_letter");
    expect(r.required).toContain("board_company_authorisation");
  });

  it("third-party representative blocks without mandate evidence", () => {
    const r = evaluateClaimEvidenceRequirements({
      ...base, company_legal_form: "third_party_representative", claimant_type: "lawyer_with_mandate",
      is_professional_representative: true,
    });
    expect(r.blocking_reasons).toContain("mandate_evidence_missing");
    expect(r.can_submit).toBe(false);
  });

  it("can_submit becomes true when all required are uploaded", () => {
    const r = evaluateClaimEvidenceRequirements({
      ...base, company_legal_form: "private_company", claimant_type: "listed_director",
      claimant_in_registry_people: true,
      uploaded_categories: ["company_registration_evidence", "director_member_officer_proof", "declaration"],
    });
    expect(r.missing).toEqual([]);
    expect(r.can_submit).toBe(true);
  });

  it("terminal status blocks submission", () => {
    const r = evaluateClaimEvidenceRequirements({
      ...base, company_legal_form: "private_company", claimant_type: "listed_director",
      claimant_in_registry_people: true,
      uploaded_categories: ["company_registration_evidence", "director_member_officer_proof", "declaration"],
      current_status: "approved",
    });
    expect(r.can_submit).toBe(false);
    expect(r.blocking_reasons.some((b) => b.includes("approved"))).toBe(true);
  });

  it("corporate shareholder requires compliance review", () => {
    const r = evaluateClaimEvidenceRequirements({
      ...base, company_legal_form: "corporate_shareholder", claimant_type: "other_representative_with_mandate",
    });
    expect(r.requires_compliance_review).toBe(true);
    expect(r.required).toContain("corporate_shareholder_control_evidence");
  });

  it("professional rep always needs identity proof + mandate", () => {
    const r = evaluateClaimEvidenceRequirements({
      ...base, company_legal_form: "private_company", claimant_type: "accountant_with_mandate",
      is_professional_representative: true,
    });
    expect(r.required).toContain("identity_proof");
    expect(r.required).toContain("mandate_letter");
  });
});

describe("Batch 11 — Terminal states", () => {
  it("approved/rejected/expired/cancelled/withdrawn are terminal", () => {
    for (const s of ["approved","rejected","expired","cancelled","withdrawn"] as const) {
      expect(isClaimWorkflowTerminal(s)).toBe(true);
    }
  });
  it("under_review is not terminal", () => {
    expect(isClaimWorkflowTerminal("under_review")).toBe(false);
  });
});
