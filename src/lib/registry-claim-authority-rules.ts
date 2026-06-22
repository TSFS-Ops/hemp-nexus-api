/**
 * Batch 27 — Claim and Authority Operating Rules SSOT.
 *
 * Mirrored byte-identically at
 *   supabase/functions/_shared/registry-claim-authority-rules.ts
 * with parity enforced by
 *   scripts/check-registry-claim-authority-rules-parity.mjs
 *
 * Encodes the client's decisions from
 *   docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx
 * for:
 *   - registration-before-claim gating;
 *   - claimant role classification & permissions;
 *   - evidence matrix by role and legal form;
 *   - unlisted-claimant handling;
 *   - multi-claim and conflict states;
 *   - claim approval effects (limited);
 *   - authority scopes;
 *   - authority states + expiry defaults;
 *   - authority review roles + two-person approval;
 *   - sensitive-scope blocks on expired/disputed/revoked authority;
 *   - exact labels and user-facing wording.
 *
 * Data + pure helpers only. No I/O, no React. This module never
 * weakens Batches 1–26 — it catalogues the gates so every surface
 * reasons from the same rules.
 */

// ──────────────────── Registration / verification gate ────────────────────

/** Actions that require registered + email-verified user. */
export const CLAIM_AUTHORITY_REQUIRES_VERIFIED_EMAIL = [
  "claim_start",
  "claim_evidence_submit",
  "authority_request",
  "bank_detail_submit",
  "data_dispute_open",
  "api_visibility_request",
] as const;
export type ClaimAuthorityVerifiedEmailAction =
  (typeof CLAIM_AUTHORITY_REQUIRES_VERIFIED_EMAIL)[number];

/** Searching is permitted without registration. */
export const CLAIM_AUTHORITY_PUBLIC_NO_AUTH_ACTIONS = [
  "search",
  "view_public_profile",
] as const;

export interface ClaimActionLinkage {
  user_id: string;
  org_id: string | null;
  ip: string | null;
  session_id: string | null;
  timestamp: string; // ISO
  audit_event: string;
}

export function requiresVerifiedEmail(
  action: string,
): action is ClaimAuthorityVerifiedEmailAction {
  return (
    CLAIM_AUTHORITY_REQUIRES_VERIFIED_EMAIL as readonly string[]
  ).includes(action);
}

export interface ClaimGateInput {
  action: string;
  authenticated: boolean;
  email_verified: boolean;
}
export type ClaimGateResult =
  | { allowed: true }
  | { allowed: false; reason: "must_register" | "must_verify_email" };

export function evaluateClaimGate(input: ClaimGateInput): ClaimGateResult {
  if (!requiresVerifiedEmail(input.action)) return { allowed: true };
  if (!input.authenticated) return { allowed: false, reason: "must_register" };
  if (!input.email_verified)
    return { allowed: false, reason: "must_verify_email" };
  return { allowed: true };
}

// ──────────────────────────── Claimant roles ──────────────────────────────

export const CLAIMANT_ROLES = [
  "director_or_member_or_owner_or_proprietor",
  "authorised_employee",
  "lawyer_accountant_adviser_consultant",
  "company_secretary_or_registered_agent",
  "bank_or_institution_representative",
  "unrelated_third_party",
  "platform_admin_assisted",
] as const;
export type ClaimantRole = (typeof CLAIMANT_ROLES)[number];

export type ClaimantRoleDisposition =
  | "allowed_with_evidence"
  | "allowed_with_evidence_and_authority_review"
  | "enquiry_only_until_mandate_approved"
  | "enquiry_only_unless_contract_authorises"
  | "blocked"
  | "admin_assisted_no_self_approval";

export const CLAIMANT_ROLE_DISPOSITION: Record<
  ClaimantRole,
  ClaimantRoleDisposition
> = {
  director_or_member_or_owner_or_proprietor: "allowed_with_evidence",
  authorised_employee: "allowed_with_evidence_and_authority_review",
  lawyer_accountant_adviser_consultant: "enquiry_only_until_mandate_approved",
  company_secretary_or_registered_agent: "allowed_with_evidence",
  bank_or_institution_representative:
    "enquiry_only_unless_contract_authorises",
  unrelated_third_party: "blocked",
  platform_admin_assisted: "admin_assisted_no_self_approval",
};

export function claimantRoleDisposition(
  role: ClaimantRole,
): ClaimantRoleDisposition {
  return CLAIMANT_ROLE_DISPOSITION[role];
}

export function isClaimantRoleAllowedToStart(role: ClaimantRole): boolean {
  return CLAIMANT_ROLE_DISPOSITION[role] !== "blocked";
}

// ───────────────────────── Legal forms + evidence matrix ──────────────────

export const REGISTRY_LEGAL_FORMS = [
  "sole_proprietor",
  "company",
  "close_corporation",
  "partnership",
  "other_legal_form",
] as const;
export type RegistryLegalForm = (typeof REGISTRY_LEGAL_FORMS)[number];

export const CLAIM_EVIDENCE_DOCUMENT_TYPES = [
  "id_or_identity_check",
  "business_registration_or_tax_document",
  "proof_of_trading_name",
  "proof_of_address",
  "signed_declaration",
  "registry_extract",
  "director_or_officer_proof",
  "board_resolution_or_mandate",
  "company_letterhead_authorisation",
  "claimant_id_or_role_proof",
  "ck_or_registry_extract",
  "member_proof",
  "member_resolution_or_mandate",
  "partnership_agreement_or_mandate",
  "tax_or_registration_proof",
  "official_formation_document",
  "authority_mandate",
] as const;
export type ClaimEvidenceDocumentType =
  (typeof CLAIM_EVIDENCE_DOCUMENT_TYPES)[number];

export const CLAIM_EVIDENCE_BY_LEGAL_FORM: Record<
  RegistryLegalForm,
  readonly ClaimEvidenceDocumentType[]
> = {
  sole_proprietor: [
    "id_or_identity_check",
    "business_registration_or_tax_document",
    "proof_of_trading_name",
    "proof_of_address",
    "signed_declaration",
  ],
  company: [
    "registry_extract",
    "director_or_officer_proof",
    "board_resolution_or_mandate",
    "company_letterhead_authorisation",
    "claimant_id_or_role_proof",
  ],
  close_corporation: [
    "ck_or_registry_extract",
    "member_proof",
    "member_resolution_or_mandate",
  ],
  partnership: [
    "partnership_agreement_or_mandate",
    "tax_or_registration_proof",
  ],
  other_legal_form: ["official_formation_document", "authority_mandate"],
};

export function requiredEvidenceForLegalForm(
  legalForm: RegistryLegalForm,
): readonly ClaimEvidenceDocumentType[] {
  return CLAIM_EVIDENCE_BY_LEGAL_FORM[legalForm];
}

export interface ClaimEvidenceRecord {
  document_type: ClaimEvidenceDocumentType;
  issuer: string;
  issued_at: string; // ISO
  expires_at: string | null;
  reviewer: string | null;
  status: "pending" | "approved" | "rejected" | "expired" | "refresh_required";
}

/** Evidence older than 12 months requires refresh unless an approved
 * reviewer exception is recorded. */
export const CLAIM_EVIDENCE_REFRESH_MONTHS = 12;

export interface EvidenceFreshnessInput {
  issued_at: string; // ISO
  now: string; // ISO
  approved_exception?: {
    reviewer: string;
    reason: string;
    approved_at: string;
  } | null;
}

export function isEvidenceFresh(input: EvidenceFreshnessInput): boolean {
  if (input.approved_exception) return true;
  const issued = Date.parse(input.issued_at);
  const now = Date.parse(input.now);
  if (Number.isNaN(issued) || Number.isNaN(now)) return false;
  const ageMs = now - issued;
  const limitMs = CLAIM_EVIDENCE_REFRESH_MONTHS * 30 * 24 * 60 * 60 * 1000;
  return ageMs <= limitMs;
}

// ───────────────────────── Unlisted claimant handling ─────────────────────

export const UNLISTED_CLAIMANT_REVIEW_STATE = "unlisted_claimant_review";

/** Capabilities BLOCKED while a claimant sits in unlisted review. */
export const UNLISTED_CLAIMANT_BLOCKED_CAPABILITIES = [
  "edit_profile",
  "submit_bank_details",
  "consent_to_api_sharing",
  "progress_authority_sensitive_workflows",
] as const;
export type UnlistedClaimantBlockedCapability =
  (typeof UNLISTED_CLAIMANT_BLOCKED_CAPABILITIES)[number];

export function unlistedClaimantBlocks(
  capability: string,
): capability is UnlistedClaimantBlockedCapability {
  return (
    UNLISTED_CLAIMANT_BLOCKED_CAPABILITIES as readonly string[]
  ).includes(capability);
}

// ───────────────────────── Claim states + conflicts ───────────────────────

export const CLAIM_STATES = [
  "unclaimed",
  "claim_started",
  "claim_submitted",
  "evidence_required",
  "evidence_submitted",
  "under_review",
  "unlisted_claimant_review",
  "competing_claim",
  "authority_conflict",
  "revoked_authority",
  "disputed_claim",
  "claim_approved_limited",
  "rejected",
  "revoked",
  "expired",
  "cancelled",
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export const CLAIM_CONFLICT_STATES = [
  "competing_claim",
  "authority_conflict",
  "revoked_authority",
  "disputed_claim",
] as const;
export type ClaimConflictState = (typeof CLAIM_CONFLICT_STATES)[number];

export function isClaimConflict(state: ClaimState): state is ClaimConflictState {
  return (CLAIM_CONFLICT_STATES as readonly string[]).includes(state);
}

export const CLAIM_REVIEWER_ROLE_NORMAL = "data_governance_owner";
export const CLAIM_REVIEWER_ROLE_SENSITIVE = "compliance_owner";

export function claimReviewerRoleFor(
  state: ClaimState,
  isSensitive: boolean,
): string {
  if (isSensitive || isClaimConflict(state))
    return CLAIM_REVIEWER_ROLE_SENSITIVE;
  return CLAIM_REVIEWER_ROLE_NORMAL;
}

// ────────────────────────── Claim approval effects ────────────────────────

/** Capabilities unlocked by a limited claim approval. */
export const CLAIM_APPROVAL_UNLOCKS = [
  "edit_profile_limited_non_sensitive",
  "request_authority_to_act",
] as const;
export type ClaimApprovalUnlock = (typeof CLAIM_APPROVAL_UNLOCKS)[number];

/** Capabilities NOT unlocked by claim approval alone. */
export const CLAIM_APPROVAL_DOES_NOT_UNLOCK = [
  "submit_bank_details",
  "consent_to_api_sharing",
  "manage_users",
  "change_verification_results",
  "approve_own_authority",
  "delete_audit_history",
] as const;
export type ClaimApprovalForbidden =
  (typeof CLAIM_APPROVAL_DOES_NOT_UNLOCK)[number];

export function claimApprovalUnlocks(capability: string): boolean {
  return (CLAIM_APPROVAL_UNLOCKS as readonly string[]).includes(capability);
}

export function claimApprovalBlocks(capability: string): boolean {
  return (
    CLAIM_APPROVAL_DOES_NOT_UNLOCK as readonly string[]
  ).includes(capability);
}

/** Exact limited approval wording. Pinned by guard. */
export const CLAIM_APPROVED_LIMITED_WORDING =
  "Claim reviewed - claimant connection accepted. Authority, profile data and bank details are not verified by this claim approval.";

// ───────────────────────────── Authority scopes ───────────────────────────

export const AUTHORITY_SCOPES = [
  "edit_profile",
  "submit_bank_details",
  "manage_users",
  "consent_to_api_sharing",
  "dispute_handling",
  "approve_profile_corrections",
  "receive_institutional_notifications",
] as const;
export type AuthorityScope = (typeof AUTHORITY_SCOPES)[number];

export function isAuthorityScopeAllowed(scope: string): scope is AuthorityScope {
  return (AUTHORITY_SCOPES as readonly string[]).includes(scope);
}

/** Scopes that require two-person approval (platform_admin AND compliance_owner). */
export const AUTHORITY_TWO_PERSON_SCOPES = [
  "submit_bank_details",
  "consent_to_api_sharing",
  "manage_users",
] as const;
export type AuthorityTwoPersonScope =
  (typeof AUTHORITY_TWO_PERSON_SCOPES)[number];

export function requiresTwoPersonApproval(scope: AuthorityScope): boolean {
  return (AUTHORITY_TWO_PERSON_SCOPES as readonly string[]).includes(scope);
}

/** Scopes that require compliance_owner sign-off regardless. */
export const AUTHORITY_COMPLIANCE_OWNER_REQUIRED_SCOPES = [
  "submit_bank_details",
  "consent_to_api_sharing",
  "dispute_handling",
] as const;

export function requiresComplianceOwner(scope: AuthorityScope): boolean {
  return (
    AUTHORITY_COMPLIANCE_OWNER_REQUIRED_SCOPES as readonly string[]
  ).includes(scope);
}

/** Authority NEVER permits these capabilities. */
export const AUTHORITY_FORBIDDEN_CAPABILITIES = [
  "change_verification_results",
  "delete_audit_history",
  "override_disputes",
  "change_pricing",
  "approve_own_authority",
] as const;

// ───────────────────────── Authority states + expiry ──────────────────────

export const AUTHORITY_STATES = [
  "not_requested",
  "evidence_required",
  "submitted",
  "under_review",
  "pending_second_approval",
  "active",
  "suspended_disputed",
  "expired",
  "revoked",
  "rejected",
  "compliance_review",
] as const;
export type AuthorityState = (typeof AUTHORITY_STATES)[number];

/** Default expiry windows (months). */
export const AUTHORITY_DEFAULT_EXPIRY_MONTHS_GENERAL = 12;
export const AUTHORITY_DEFAULT_EXPIRY_MONTHS_BANK_OR_API = 6;

export function defaultExpiryMonthsForScope(scope: AuthorityScope): number {
  if (scope === "submit_bank_details" || scope === "consent_to_api_sharing")
    return AUTHORITY_DEFAULT_EXPIRY_MONTHS_BANK_OR_API;
  return AUTHORITY_DEFAULT_EXPIRY_MONTHS_GENERAL;
}

/** Sensitive actions blocked when authority is expired/disputed/revoked. */
export const AUTHORITY_SENSITIVE_ACTIONS = [
  "bank_detail_submit",
  "api_sharing_consent",
  "manage_users",
  "profile_publication_approval",
  "dispute_closure",
  "wad_or_settlement_sensitive_action",
] as const;
export type AuthoritySensitiveAction =
  (typeof AUTHORITY_SENSITIVE_ACTIONS)[number];

export const AUTHORITY_BLOCKING_STATES: readonly AuthorityState[] = [
  "expired",
  "revoked",
  "suspended_disputed",
  "compliance_review",
];

export function blocksSensitiveAction(state: AuthorityState): boolean {
  return AUTHORITY_BLOCKING_STATES.includes(state);
}

export interface AuthorityEvaluationInput {
  state: AuthorityState;
  scope: AuthorityScope;
  approvers: readonly string[]; // user IDs of approvers so far
  approver_roles: readonly string[]; // distinct roles among approvers
  subject_user_id: string;
  action_user_id: string; // who is invoking the action
}

export type AuthorityEvaluationResult =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "self_approval_blocked"
        | "scope_not_allowed"
        | "needs_second_approval"
        | "needs_compliance_owner"
        | "expired"
        | "revoked"
        | "suspended_disputed"
        | "not_active";
    };

export function evaluateAuthorityAction(
  input: AuthorityEvaluationInput,
): AuthorityEvaluationResult {
  if (input.subject_user_id === input.action_user_id) {
    return { allowed: false, reason: "self_approval_blocked" };
  }
  if (!isAuthorityScopeAllowed(input.scope)) {
    return { allowed: false, reason: "scope_not_allowed" };
  }
  if (input.state === "expired") return { allowed: false, reason: "expired" };
  if (input.state === "revoked") return { allowed: false, reason: "revoked" };
  if (input.state === "suspended_disputed")
    return { allowed: false, reason: "suspended_disputed" };
  if (input.state !== "active")
    return { allowed: false, reason: "not_active" };
  if (
    requiresTwoPersonApproval(input.scope) &&
    new Set(input.approvers).size < 2
  ) {
    return { allowed: false, reason: "needs_second_approval" };
  }
  if (
    requiresComplianceOwner(input.scope) &&
    !input.approver_roles.includes("compliance_owner")
  ) {
    return { allowed: false, reason: "needs_compliance_owner" };
  }
  return { allowed: true };
}

/** Full authority is not a default state. */
export const AUTHORITY_FULL_REQUIRES_COMPLIANCE_OWNER = true;
export const AUTHORITY_FULL_IS_DEFAULT = false;

// ───────────────────────── Wording / UI labels ────────────────────────────

export const CLAIM_AUTHORITY_WORDING = {
  claim_cta: "Claim this company",
  claim_approval_limited: CLAIM_APPROVED_LIMITED_WORDING,
  unlisted_claimant_notice:
    "Your name is not in our imported records yet. We will review your evidence of authority before unlocking sensitive actions.",
  authority_scope_disclaimer:
    "Authority-to-act is scoped and temporary. It does not change verification results, override disputes, delete audit history or approve itself.",
  authority_expired_notice:
    "Your authority has expired. Sensitive actions are paused until a renewal request is approved with fresh evidence.",
  authority_revoked_notice:
    "Your authority has been revoked. Sensitive actions are no longer permitted.",
  authority_disputed_notice:
    "This authority is under dispute. Sensitive actions are suspended until compliance review is complete.",
  two_person_required_notice:
    "This authority requires sign-off from a platform administrator and a compliance owner before it becomes active.",
  self_approval_blocked_notice:
    "You cannot approve your own authority. A second approver from compliance is required.",
} as const;

// ───────────────────────────── Audit events ───────────────────────────────

export const CLAIM_AUTHORITY_AUDIT_EVENTS = [
  "registry_claim_gate_evaluated",
  "registry_claim_started",
  "registry_claim_evidence_submitted",
  "registry_claim_unlisted_review_opened",
  "registry_claim_conflict_detected",
  "registry_claim_approved_limited",
  "registry_claim_rejected",
  "registry_authority_requested",
  "registry_authority_second_approval_requested",
  "registry_authority_activated",
  "registry_authority_self_approval_blocked",
  "registry_authority_scope_blocked",
  "registry_authority_suspended_disputed",
  "registry_authority_expired",
  "registry_authority_revoked",
  "registry_authority_sensitive_action_blocked",
] as const;
export type ClaimAuthorityAuditEvent =
  (typeof CLAIM_AUTHORITY_AUDIT_EVENTS)[number];

// ─────────────────────────── Parity fingerprint ───────────────────────────

/**
 * Bump this when the SSOT changes. The parity guard hashes the whole
 * file but reviewers can grep this string in PRs.
 */
export const REGISTRY_CLAIM_AUTHORITY_PARITY_FINGERPRINT =
  "batch-27-claim-authority-rules-v1";
