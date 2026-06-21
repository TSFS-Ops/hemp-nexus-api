/**
 * Batch 11 — Deno mirror of src/lib/registry-claim-workflow.ts
 * Pinned by scripts/check-registry-claim-workflow-parity.mjs
 */

export const REGISTRY_CLAIMANT_TYPES = [
  "listed_director",
  "listed_member",
  "listed_proprietor",
  "listed_officer",
  "company_secretary",
  "company_domain_email_holder",
  "employee_with_mandate",
  "lawyer_with_mandate",
  "accountant_with_mandate",
  "presenter_with_mandate",
  "consultant_with_mandate",
  "other_representative_with_mandate",
] as const;
export type RegistryClaimantType = (typeof REGISTRY_CLAIMANT_TYPES)[number];

export const REGISTRY_PROFESSIONAL_REPRESENTATIVE_TYPES: RegistryClaimantType[] = [
  "lawyer_with_mandate",
  "accountant_with_mandate",
  "presenter_with_mandate",
  "consultant_with_mandate",
  "other_representative_with_mandate",
];

export const REGISTRY_EVIDENCE_CATEGORIES = [
  "identity_proof",
  "company_registration_evidence",
  "director_member_officer_proof",
  "proprietor_proof",
  "company_domain_email_proof",
  "mandate_letter",
  "board_company_authorisation",
  "corporate_shareholder_control_evidence",
  "contact_control_proof",
  "declaration",
  "other_supporting_evidence",
] as const;
export type RegistryEvidenceCategory = (typeof REGISTRY_EVIDENCE_CATEGORIES)[number];

export const REGISTRY_EVIDENCE_STATES = [
  "uploaded",
  "metadata_only",
  "pending_review",
  "accepted",
  "rejected",
  "expired",
  "superseded",
  "withdrawn",
] as const;
export type RegistryEvidenceState = (typeof REGISTRY_EVIDENCE_STATES)[number];

export const REGISTRY_CLAIM_WORKFLOW_STATUSES = [
  "claim_interest_started",
  "account_required",
  "email_verification_required",
  "email_verified",
  "claim_started",
  "draft",
  "evidence_required",
  "claim_submitted",
  "under_review",
  "more_evidence_requested",
  "evidence_resubmitted",
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "withdrawn",
  "claim_conflict_detected",
  "claim_conflict_locked",
  "escalated",
] as const;
export type RegistryClaimWorkflowStatus =
  (typeof REGISTRY_CLAIM_WORKFLOW_STATUSES)[number];

export const REGISTRY_CLAIM_REVIEW_ACTIONS = [
  "start_review",
  "request_more_evidence",
  "accept_evidence_item",
  "reject_evidence_item",
  "approve_claim",
  "reject_claim",
  "escalate_claim",
  "cancel_claim",
  "expire_claim",
  "assign_reviewer",
  "add_internal_note",
] as const;
export type RegistryClaimReviewAction =
  (typeof REGISTRY_CLAIM_REVIEW_ACTIONS)[number];

export const REGISTRY_CLAIM_CONFLICT_OUTCOMES = [
  "one_claim_approved",
  "multiple_claims_approved_with_scoped_access",
  "all_claims_rejected",
  "escalated",
  "cancelled",
] as const;
export type RegistryClaimConflictOutcome =
  (typeof REGISTRY_CLAIM_CONFLICT_OUTCOMES)[number];

export const REGISTRY_CLAIM_EXPIRY_DAYS = {
  draft: 30,
  evidence_requested: 14,
  submitted_under_review: 30,
} as const;

export const REGISTRY_CLAIM_WORKFLOW_AUDIT_EVENT_NAMES = [
  "registry_claim_started",
  "registry_claim_drafted",
  "registry_claim_evidence_uploaded",
  "registry_claim_evidence_metadata_added",
  "registry_claim_evidence_reviewed",
  "registry_claim_submitted",
  "registry_claim_review_started",
  "registry_claim_more_evidence_requested",
  "registry_claim_evidence_resubmitted",
  "registry_claim_approved",
  "registry_claim_rejected",
  "registry_claim_cancelled",
  "registry_claim_withdrawn",
  "registry_claim_expired",
  "registry_claim_conflict_detected",
  "registry_claim_conflict_resolved",
  "registry_claim_escalated",
  "registry_claim_assigned",
  "registry_claim_note_added",
  "registry_claim_notification_logged",
] as const;
export type RegistryClaimWorkflowAuditEventName =
  (typeof REGISTRY_CLAIM_WORKFLOW_AUDIT_EVENT_NAMES)[number];

export const REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING =
  "Claim approved. This confirms that the claim record has passed review. It does not verify authority-to-act, company profile accuracy or bank details.";

export const REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE =
  "Claim approval does not verify authority-to-act, company profile accuracy or bank details.";

export const REGISTRY_CLAIM_REJECTION_PUBLIC_WORDING =
  "Your claim was not approved. Please review the reason provided and submit a new claim only if you can provide the required evidence.";

export const REGISTRY_CLAIM_ADMIN_APPROVAL_ACK =
  "I understand that approving this claim does not verify authority-to-act, company profile accuracy or bank details.";

export interface ClaimEvidenceRequirementsInput {
  company_legal_form:
    | "sole_proprietor"
    | "private_company"
    | "close_corporation"
    | "corporate_shareholder"
    | "third_party_representative"
    | "other";
  country_code: string;
  claimant_type: RegistryClaimantType;
  claimant_in_registry_people: boolean;
  uses_company_domain_email: boolean;
  is_professional_representative: boolean;
  has_mandate_evidence: boolean;
  current_status: RegistryClaimWorkflowStatus;
  uploaded_categories: RegistryEvidenceCategory[];
}

export interface ClaimEvidenceRequirementsResult {
  required: RegistryEvidenceCategory[];
  optional: RegistryEvidenceCategory[];
  missing: RegistryEvidenceCategory[];
  blocking_reasons: string[];
  can_submit: boolean;
  can_start_admin_review: boolean;
  requires_compliance_review: boolean;
}

export function evaluateClaimEvidenceRequirements(
  input: ClaimEvidenceRequirementsInput,
): ClaimEvidenceRequirementsResult {
  const required: RegistryEvidenceCategory[] = ["declaration"];
  const optional: RegistryEvidenceCategory[] = ["other_supporting_evidence"];
  const blocking: string[] = [];

  switch (input.company_legal_form) {
    case "sole_proprietor":
      required.push("proprietor_proof", "company_registration_evidence");
      optional.push("contact_control_proof");
      if (input.is_professional_representative || !input.claimant_in_registry_people) {
        required.push("mandate_letter");
      }
      break;
    case "private_company":
      required.push("company_registration_evidence");
      if (input.claimant_in_registry_people) {
        required.push("director_member_officer_proof");
      } else {
        required.push("mandate_letter", "board_company_authorisation");
      }
      if (input.uses_company_domain_email) {
        optional.push("company_domain_email_proof");
      }
      break;
    case "close_corporation":
      required.push("company_registration_evidence");
      if (input.claimant_in_registry_people) {
        required.push("director_member_officer_proof");
      } else {
        required.push("mandate_letter");
      }
      optional.push("contact_control_proof");
      break;
    case "corporate_shareholder":
      required.push(
        "corporate_shareholder_control_evidence",
        "mandate_letter",
        "company_registration_evidence",
      );
      break;
    case "third_party_representative":
      required.push("mandate_letter", "identity_proof");
      optional.push("company_registration_evidence");
      if (!input.has_mandate_evidence) {
        blocking.push("mandate_evidence_missing");
      }
      break;
    default:
      required.push("company_registration_evidence");
  }

  if (input.is_professional_representative) {
    if (!required.includes("identity_proof")) required.push("identity_proof");
    if (!required.includes("mandate_letter")) required.push("mandate_letter");
  }

  const uploaded = new Set(input.uploaded_categories);
  const missing = required.filter((c) => !uploaded.has(c));

  const terminalish: RegistryClaimWorkflowStatus[] = [
    "approved",
    "rejected",
    "expired",
    "cancelled",
    "withdrawn",
    "claim_conflict_locked",
  ];
  if (terminalish.includes(input.current_status)) {
    blocking.push(`status_${input.current_status}_blocks_submission`);
  }

  const can_submit = missing.length === 0 && blocking.length === 0;
  const can_start_admin_review =
    can_submit ||
    input.current_status === "claim_submitted" ||
    input.current_status === "evidence_resubmitted";
  const requires_compliance_review =
    input.is_professional_representative ||
    input.company_legal_form === "corporate_shareholder";

  return {
    required: Array.from(new Set(required)),
    optional: Array.from(new Set(optional)),
    missing,
    blocking_reasons: blocking,
    can_submit,
    can_start_admin_review,
    requires_compliance_review,
  };
}

export const REGISTRY_CLAIM_WORKFLOW_TERMINAL_STATUSES: RegistryClaimWorkflowStatus[] = [
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "withdrawn",
];

export function isClaimWorkflowTerminal(s: RegistryClaimWorkflowStatus): boolean {
  return REGISTRY_CLAIM_WORKFLOW_TERMINAL_STATUSES.includes(s);
}

export const REGISTRY_CLAIM_APPROVAL_ROLES = ["platform_admin", "compliance_owner"] as const;
