/**
 * Batch 12 — Authority-to-Act Request, Evidence and Approval SSOT (Deno mirror).
 * Mirror of src/lib/registry-authority-workflow.ts. Do not drift.
 */

export const REGISTRY_AUTHORITY_B12_STATES = [
  "not_started",
  "draft",
  "submitted",
  "evidence_required",
  "under_review",
  "more_evidence_requested",
  "evidence_resubmitted",
  "partially_approved",
  "approved",
  "rejected",
  "suspended",
  "revoked",
  "expired",
  "cancelled",
  "withdrawn",
  "disputed",
  "escalated",
] as const;
export type RegistryAuthorityB12State =
  (typeof REGISTRY_AUTHORITY_B12_STATES)[number];

export const REGISTRY_AUTHORITY_B12_FINAL_STATES: RegistryAuthorityB12State[] = [
  "approved",
  "partially_approved",
  "rejected",
  "revoked",
  "expired",
  "cancelled",
  "withdrawn",
];

export const REGISTRY_AUTHORITY_SCOPES = [
  "profile_correction_request",
  "profile_correction_approval_request",
  "bank_detail_submission",
  "bank_detail_update",
  "bank_detail_revocation_request",
  "company_user_management_request",
  "api_sharing_consent_request",
  "dispute_response",
  "document_upload",
  "authority_delegation_request",
] as const;
export type RegistryAuthorityScope = (typeof REGISTRY_AUTHORITY_SCOPES)[number];

export const REGISTRY_AUTHORITY_SENSITIVE_SCOPES: RegistryAuthorityScope[] = [
  "bank_detail_submission",
  "bank_detail_update",
  "bank_detail_revocation_request",
  "api_sharing_consent_request",
  "company_user_management_request",
  "authority_delegation_request",
];

export const REGISTRY_AUTHORITY_DELEGATION_SCOPE: RegistryAuthorityScope =
  "authority_delegation_request";

export const REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES = [
  "claimant_approved_claim_reference",
  "identity_proof",
  "company_mandate",
  "board_or_company_resolution",
  "director_member_proprietor_authorisation",
  "company_secretary_authorisation",
  "employment_proof",
  "professional_representative_mandate",
  "delegated_authority_letter",
  "bank_detail_authority_proof",
  "api_sharing_consent_proof",
  "dispute_response_authority_proof",
  "user_management_authority_proof",
  "declaration",
  "other_supporting_evidence",
] as const;
export type RegistryAuthorityEvidenceCategory =
  (typeof REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES)[number];

export const REGISTRY_AUTHORITY_EVIDENCE_STATES = [
  "uploaded",
  "metadata_only",
  "pending_review",
  "accepted",
  "rejected",
  "expired",
  "superseded",
  "withdrawn",
] as const;
export type RegistryAuthorityEvidenceState =
  (typeof REGISTRY_AUTHORITY_EVIDENCE_STATES)[number];

export const REGISTRY_AUTHORITY_SCOPE_DECISION_STATES = [
  "requested",
  "under_review",
  "more_evidence_requested",
  "approved",
  "rejected",
  "suspended",
  "revoked",
  "expired",
] as const;
export type RegistryAuthorityScopeDecisionState =
  (typeof REGISTRY_AUTHORITY_SCOPE_DECISION_STATES)[number];

export const REGISTRY_AUTHORITY_REVIEW_ACTIONS = [
  "start_review",
  "request_more_evidence",
  "accept_evidence_item",
  "reject_evidence_item",
  "approve_scope",
  "reject_scope",
  "partially_approve_request",
  "approve_full_request",
  "reject_request",
  "suspend_authority",
  "revoke_authority",
  "expire_authority",
  "mark_disputed",
  "resolve_dispute",
  "escalate",
  "assign_reviewer",
  "add_internal_note",
] as const;
export type RegistryAuthorityReviewAction =
  (typeof REGISTRY_AUTHORITY_REVIEW_ACTIONS)[number];

export const REGISTRY_AUTHORITY_ACTIVE_CHECK_RESULTS = [
  "allowed",
  "not_allowed",
  "scope_missing",
  "authority_expired",
  "authority_suspended",
  "authority_revoked",
  "authority_disputed",
  "claim_conflict_locked",
  "company_disabled",
  "company_archived",
] as const;
export type RegistryAuthorityActiveCheckResult =
  (typeof REGISTRY_AUTHORITY_ACTIVE_CHECK_RESULTS)[number];

export const REGISTRY_AUTHORITY_DISPUTE_OUTCOMES = [
  "authority_remains_active",
  "authority_partially_revoked",
  "authority_fully_revoked",
  "more_evidence_requested",
  "escalated",
] as const;
export type RegistryAuthorityDisputeOutcome =
  (typeof REGISTRY_AUTHORITY_DISPUTE_OUTCOMES)[number];

export const REGISTRY_AUTHORITY_DEFAULT_EXPIRY_DAYS: Record<
  RegistryAuthorityScope,
  number
> = {
  profile_correction_request: 180,
  profile_correction_approval_request: 180,
  bank_detail_submission: 90,
  bank_detail_update: 90,
  bank_detail_revocation_request: 90,
  company_user_management_request: 90,
  api_sharing_consent_request: 90,
  dispute_response: 180,
  document_upload: 180,
  authority_delegation_request: 30,
};

export const REGISTRY_AUTHORITY_B12_AUDIT_EVENT_NAMES = [
  "registry_authority_started",
  "registry_authority_drafted",
  "registry_authority_evidence_uploaded",
  "registry_authority_evidence_metadata_added",
  "registry_authority_evidence_reviewed",
  "registry_authority_submitted",
  "registry_authority_review_started",
  "registry_authority_more_evidence_requested",
  "registry_authority_evidence_resubmitted",
  "registry_authority_scope_approved",
  "registry_authority_scope_rejected",
  "registry_authority_partially_approved",
  "registry_authority_approved",
  "registry_authority_rejected",
  "registry_authority_suspended",
  "registry_authority_revoked",
  "registry_authority_expired",
  "registry_authority_disputed",
  "registry_authority_dispute_resolved",
  "registry_authority_escalated",
  "registry_authority_assigned",
  "registry_authority_note_added",
  "registry_authority_active_check_performed",
  "registry_authority_notification_logged",
] as const;
export type RegistryAuthorityB12AuditEventName =
  (typeof REGISTRY_AUTHORITY_B12_AUDIT_EVENT_NAMES)[number];

export const REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT =
  "I understand that approving authority only grants the selected scope(s). It does not verify the company profile, confirm bank details, or make the company institutionally usable.";

export const REGISTRY_AUTHORITY_B12_PUBLIC_APPROVAL_NOTICE =
  "Authority approved for selected scopes only. This does not verify the company profile, confirm bank details, or make the company institutionally usable.";

export const REGISTRY_AUTHORITY_B12_PUBLIC_REJECTION_NOTICE =
  "Your authority request was not approved for the listed scope(s). Please review the reason provided and submit a new request only if you can provide the required evidence.";

export const REGISTRY_AUTHORITY_B12_PUBLIC_NEXT_STEP_BANK =
  "You may now submit bank details for review.";

export interface AuthorityRequirementsInput {
  companyLegalForm?: string | null;
  countryCode: string;
  approvedClaimType: string | null;
  claimantType: string;
  requestedScopes: RegistryAuthorityScope[];
  claimantListedInRegistryPeople: boolean;
  claimantIsProfessionalRepresentative: boolean;
  mandateEvidencePresent: boolean;
  presentEvidenceCategories: RegistryAuthorityEvidenceCategory[];
  companyLifecycleState: string;
  claimConflictActive: boolean;
}

export interface AuthorityScopeRequirements {
  scope: RegistryAuthorityScope;
  isSensitive: boolean;
  requiredEvidence: RegistryAuthorityEvidenceCategory[];
  optionalEvidence: RegistryAuthorityEvidenceCategory[];
  missingEvidence: RegistryAuthorityEvidenceCategory[];
  blockers: string[];
  requiresComplianceReview: boolean;
  requiresTwoPersonApproval: boolean;
  defaultExpiryDays: number;
}

export interface AuthorityRequirementsResult {
  scopes: AuthorityScopeRequirements[];
  canSubmit: boolean;
  canStartAdminReview: boolean;
  requiresComplianceReview: boolean;
  requiresTwoPersonApproval: boolean;
  requestBlockers: string[];
}

function reqsForScope(
  scope: RegistryAuthorityScope,
  input: AuthorityRequirementsInput,
): AuthorityScopeRequirements {
  const isSensitive = REGISTRY_AUTHORITY_SENSITIVE_SCOPES.includes(scope);
  const isDelegation = scope === REGISTRY_AUTHORITY_DELEGATION_SCOPE;
  const isProfRep = input.claimantIsProfessionalRepresentative;
  const required: RegistryAuthorityEvidenceCategory[] = [
    "claimant_approved_claim_reference",
    "declaration",
  ];
  const optional: RegistryAuthorityEvidenceCategory[] = [
    "other_supporting_evidence",
  ];

  if (isSensitive) {
    required.push("identity_proof");
    if (scope.startsWith("bank_detail_")) {
      required.push("bank_detail_authority_proof");
    }
    if (scope === "api_sharing_consent_request") {
      required.push("api_sharing_consent_proof");
    }
    if (scope === "company_user_management_request") {
      required.push("user_management_authority_proof");
    }
    if (input.companyLegalForm === "company") {
      required.push("company_mandate");
    } else {
      required.push("director_member_proprietor_authorisation");
    }
  }

  if (isDelegation) {
    if (!required.includes("identity_proof")) required.push("identity_proof");
    required.push("delegated_authority_letter");
    if (!required.includes("company_mandate")) required.push("company_mandate");
  }

  if (isProfRep) {
    required.push("professional_representative_mandate");
    if (!required.includes("identity_proof")) required.push("identity_proof");
  }

  const present = new Set(input.presentEvidenceCategories);
  const missing = required.filter((c) => !present.has(c));

  const blockers: string[] = [];
  if (input.claimConflictActive && isSensitive) {
    blockers.push("claim_conflict_locked");
  }
  if (["disabled", "archived"].includes(input.companyLifecycleState)) {
    blockers.push("company_not_actionable");
  }
  if (!input.approvedClaimType) blockers.push("approved_claim_required");
  if (missing.length) blockers.push("missing_required_evidence");

  const requiresComplianceReview =
    isSensitive || isDelegation || (isProfRep && isSensitive);
  const requiresTwoPersonApproval = isDelegation;

  return {
    scope,
    isSensitive,
    requiredEvidence: required,
    optionalEvidence: optional,
    missingEvidence: missing,
    blockers,
    requiresComplianceReview,
    requiresTwoPersonApproval,
    defaultExpiryDays: REGISTRY_AUTHORITY_DEFAULT_EXPIRY_DAYS[scope],
  };
}

export function getAuthorityRequirements(
  input: AuthorityRequirementsInput,
): AuthorityRequirementsResult {
  const scopes = input.requestedScopes.map((s) => reqsForScope(s, input));
  const requestBlockers: string[] = [];
  if (!input.requestedScopes.length) requestBlockers.push("scope_required");
  if (!input.approvedClaimType) requestBlockers.push("approved_claim_required");

  const canSubmit =
    requestBlockers.length === 0 &&
    scopes.every((s) => s.blockers.length === 0);
  const canStartAdminReview = canSubmit;
  const requiresComplianceReview = scopes.some(
    (s) => s.requiresComplianceReview,
  );
  const requiresTwoPersonApproval = scopes.some(
    (s) => s.requiresTwoPersonApproval,
  );

  return {
    scopes,
    canSubmit,
    canStartAdminReview,
    requiresComplianceReview,
    requiresTwoPersonApproval,
    requestBlockers,
  };
}

export interface ActiveAuthorityCheckInput {
  scope: RegistryAuthorityScope;
  scopeStatus: RegistryAuthorityScopeDecisionState | "not_present";
  authorityStatus: RegistryAuthorityB12State | "not_present";
  expiryAt: string | null;
  suspended: boolean;
  revoked: boolean;
  disputed: boolean;
  claimConflictActive: boolean;
  companyLifecycleState: string;
  now?: Date;
}

export function checkActiveAuthority(
  input: ActiveAuthorityCheckInput,
): RegistryAuthorityActiveCheckResult {
  const now = input.now ?? new Date();
  if (input.companyLifecycleState === "archived") return "company_archived";
  if (input.companyLifecycleState === "disabled") return "company_disabled";
  if (input.claimConflictActive) return "claim_conflict_locked";
  if (input.scopeStatus === "not_present" || input.scopeStatus !== "approved") {
    return "scope_missing";
  }
  if (input.revoked) return "authority_revoked";
  if (input.suspended) return "authority_suspended";
  if (input.disputed) return "authority_disputed";
  if (input.expiryAt && new Date(input.expiryAt).getTime() < now.getTime()) {
    return "authority_expired";
  }
  return "allowed";
}

export function reduceAuthorityStatusFromScopeDecisions(
  decisions: { decision: RegistryAuthorityScopeDecisionState }[],
): RegistryAuthorityB12State {
  if (!decisions.length) return "under_review";
  const ds = decisions.map((d) => d.decision);
  const allApproved = ds.every((d) => d === "approved");
  const allRejected = ds.every((d) => d === "rejected");
  const anyApproved = ds.some((d) => d === "approved");
  const anyMore = ds.some((d) => d === "more_evidence_requested");
  if (allApproved) return "approved";
  if (allRejected) return "rejected";
  if (anyApproved && (ds.some((d) => d === "rejected") || anyMore)) {
    return "partially_approved";
  }
  if (anyMore) return "more_evidence_requested";
  return "under_review";
}
