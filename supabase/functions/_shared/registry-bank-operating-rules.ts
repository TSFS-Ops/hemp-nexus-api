/**
 * Batch 28 — Bank Detail Capture, Multi-Account and Verification Operating Rules SSOT.
 *
 * Mirrored byte-identically at
 *   supabase/functions/_shared/registry-bank-operating-rules.ts
 * Parity pinned by:
 *   scripts/check-registry-bank-operating-rules-parity.mjs
 *
 * Encodes the client's decisions from
 *   docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx
 * for:
 *   - bank-detail submitter gate (authority + scope);
 *   - country-specific bank field requirements (ZA, NG, other);
 *   - multi-account rules and primary-account uniqueness;
 *   - third-party bank account escalation;
 *   - bank evidence requirements;
 *   - masked / unmasked access roles + AAL2 / reason / audit;
 *   - verification types and exact status labels;
 *   - manual verification before provider-live (compliance approval);
 *   - validity / expiry windows + re-verification triggers;
 *   - non-usable bank states and their effects;
 *   - payment-status API usability gate.
 *
 * Data + pure helpers only. No I/O, no React. Builds on Batches 1–27;
 * never weakens any accepted guardrail (Batch 13/13B/14/14B/15/16/17
 * bank guarantees, Batch 27 authority gates, Batch 22 shell).
 */

// ──────────────────── Submitter gate ────────────────────

export const BANK_SUBMIT_REQUIRED_AUTHORITY_SCOPE = "submit_bank_details" as const;
export const BANK_SUBMIT_ALSO_ACCEPTED_SCOPE = "bank_submit" as const;

export const BANK_SUBMIT_BLOCKED_USER_KINDS = [
  "unregistered",
  "claim_only",
  "third_party_without_mandate",
  "suspended_company_user",
] as const;
export type BankSubmitBlockedUserKind = (typeof BANK_SUBMIT_BLOCKED_USER_KINDS)[number];

export const BANK_SUBMIT_BLOCKING_AUTHORITY_STATES = [
  "expired",
  "disputed",
  "revoked",
  "suspended_disputed",
  "compliance_review",
] as const;
export type BankSubmitBlockingAuthorityState =
  (typeof BANK_SUBMIT_BLOCKING_AUTHORITY_STATES)[number];

/** Claim approval alone never unlocks bank submission. */
export const BANK_SUBMIT_CLAIM_APPROVAL_ALONE_UNLOCKS = false;

export interface BankSubmitGateInput {
  authenticated: boolean;
  email_verified: boolean;
  authority_active: boolean;
  authority_state: string | null;
  authority_scopes: readonly string[];
  authority_conditional: boolean;
  is_platform_admin: boolean;
  admin_assisted_evidence_present: boolean;
  admin_assisted_reason: string | null;
  is_claim_only: boolean;
  user_kind: BankSubmitBlockedUserKind | "registered_user";
  company_suspended: boolean;
}

export type BankSubmitGateResult =
  | { allowed: true; mode: "user" | "admin_assisted" | "draft_only" }
  | {
      allowed: false;
      reason:
        | "must_register"
        | "must_verify_email"
        | "claim_only_blocked"
        | "blocked_user_kind"
        | "company_suspended"
        | "authority_inactive"
        | "authority_state_blocking"
        | "authority_missing_bank_scope"
        | "admin_assisted_requires_evidence_and_reason";
    };

export function evaluateBankSubmitGate(input: BankSubmitGateInput): BankSubmitGateResult {
  if (!input.authenticated) return { allowed: false, reason: "must_register" };
  if (!input.email_verified) return { allowed: false, reason: "must_verify_email" };
  if (input.company_suspended) return { allowed: false, reason: "company_suspended" };

  if (input.is_platform_admin) {
    if (!input.admin_assisted_evidence_present || !input.admin_assisted_reason) {
      return { allowed: false, reason: "admin_assisted_requires_evidence_and_reason" };
    }
    return { allowed: true, mode: "admin_assisted" };
  }

  if (input.is_claim_only) return { allowed: false, reason: "claim_only_blocked" };
  if (input.user_kind !== "registered_user") {
    return { allowed: false, reason: "blocked_user_kind" };
  }
  if (
    input.authority_state &&
    (BANK_SUBMIT_BLOCKING_AUTHORITY_STATES as readonly string[]).includes(input.authority_state)
  ) {
    return { allowed: false, reason: "authority_state_blocking" };
  }
  if (!input.authority_active) return { allowed: false, reason: "authority_inactive" };
  const hasScope =
    input.authority_scopes.includes(BANK_SUBMIT_REQUIRED_AUTHORITY_SCOPE) ||
    input.authority_scopes.includes(BANK_SUBMIT_ALSO_ACCEPTED_SCOPE);
  if (!hasScope) return { allowed: false, reason: "authority_missing_bank_scope" };

  // Conditional authority may only save a draft/pending record.
  if (input.authority_conditional) return { allowed: true, mode: "draft_only" };
  return { allowed: true, mode: "user" };
}

// ──────────────────── Country bank field requirements ────────────────────

export const BANK_FIELD_GROUPS = ["za", "ng", "other"] as const;
export type BankFieldGroup = (typeof BANK_FIELD_GROUPS)[number];

export const BANK_REQUIRED_FIELDS_ZA = [
  "bank_name",
  "account_holder",
  "account_number",
  "branch_code",
  "account_type",
  "currency",
  "proof_document",
] as const;
export const BANK_OPTIONAL_FIELDS_ZA = ["swift_bic"] as const;

export const BANK_REQUIRED_FIELDS_NG = [
  "bank_name",
  "account_holder",
  "account_number",
  "bank_code_or_nibss_identifier",
  "currency",
  "proof_document",
] as const;
/** Nigerian BVN is forbidden unless separately approved. */
export const BANK_FORBIDDEN_FIELD_NG_BVN = "bvn" as const;
export const BANK_NG_BVN_REQUIRES_SEPARATE_APPROVAL = true;

export const BANK_REQUIRED_FIELDS_OTHER = [
  "bank_name",
  "account_holder",
  "account_number_or_iban",
  "branch_or_sort_or_routing_code",
  "currency",
  "country",
  "proof_document",
] as const;
export const BANK_OPTIONAL_FIELDS_OTHER = ["swift_bic"] as const;

export function requiredBankFields(group: BankFieldGroup): readonly string[] {
  switch (group) {
    case "za":
      return BANK_REQUIRED_FIELDS_ZA;
    case "ng":
      return BANK_REQUIRED_FIELDS_NG;
    case "other":
      return BANK_REQUIRED_FIELDS_OTHER;
  }
}

export function detectBankFieldGroup(countryIso2: string | null | undefined): BankFieldGroup {
  const c = (countryIso2 ?? "").toUpperCase();
  if (c === "ZA") return "za";
  if (c === "NG") return "ng";
  return "other";
}

export interface BankFieldValidationInput {
  group: BankFieldGroup;
  fields: Record<string, unknown>;
  bvn_separately_approved?: boolean;
}
export type BankFieldValidationResult =
  | { ok: true }
  | { ok: false; missing: string[]; forbidden: string[] };

export function validateBankFields(input: BankFieldValidationInput): BankFieldValidationResult {
  const required = requiredBankFields(input.group);
  const missing = required.filter((f) => {
    const v = input.fields[f];
    return v === undefined || v === null || v === "";
  });
  const forbidden: string[] = [];
  if (input.group === "ng") {
    const bvn = input.fields[BANK_FORBIDDEN_FIELD_NG_BVN];
    const allowed = input.bvn_separately_approved === true;
    if (bvn !== undefined && bvn !== null && bvn !== "" && !allowed) {
      forbidden.push(BANK_FORBIDDEN_FIELD_NG_BVN);
    }
  }
  if (missing.length === 0 && forbidden.length === 0) return { ok: true };
  return { ok: false, missing: [...missing], forbidden };
}

// ──────────────────── Multi-account rules ────────────────────

export const BANK_ACCOUNT_PURPOSE_LABELS = [
  "operating",
  "escrow",
  "export",
  "project",
  "subscription",
  "settlement",
] as const;
export type BankAccountPurposeLabel = (typeof BANK_ACCOUNT_PURPOSE_LABELS)[number];

export const BANK_V1_MAX_ACTIVE_ACCOUNTS = 3 as const;
export const BANK_V1_OVER_MAX_REQUIRES_ROLES = ["platform_admin", "compliance_owner"] as const;

export interface BankAccountSummary {
  id: string;
  status: string;
  is_primary: boolean;
  currency: string;
  payment_route: string | null;
  purpose: BankAccountPurposeLabel | null;
  is_third_party: boolean;
}

export type BankMultiAccountResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "exceeds_v1_max_active_without_dual_approval"
        | "purpose_required_for_additional_account"
        | "primary_account_conflict_currency_route";
    };

export function evaluateNewBankAccount(input: {
  existing_active: BankAccountSummary[];
  new_account: BankAccountSummary;
  dual_approval_present: boolean;
}): BankMultiAccountResult {
  const activeCount = input.existing_active.length;
  if (activeCount + 1 > BANK_V1_MAX_ACTIVE_ACCOUNTS && !input.dual_approval_present) {
    return { ok: false, reason: "exceeds_v1_max_active_without_dual_approval" };
  }
  if (activeCount >= 1 && !input.new_account.purpose) {
    return { ok: false, reason: "purpose_required_for_additional_account" };
  }
  if (input.new_account.is_primary) {
    const conflict = input.existing_active.some(
      (a) =>
        a.is_primary &&
        a.currency === input.new_account.currency &&
        (a.payment_route ?? null) === (input.new_account.payment_route ?? null),
    );
    if (conflict) return { ok: false, reason: "primary_account_conflict_currency_route" };
  }
  return { ok: true };
}

// ──────────────────── Third-party accounts ────────────────────

export const BANK_THIRD_PARTY_DEFAULT_STATE = "third_party_account_pending_review" as const;
export const BANK_THIRD_PARTY_BLOCKED_STATE = "third_party_account_blocked" as const;

export const BANK_THIRD_PARTY_REQUIRED_EVIDENCE = [
  "third_party_mandate",
  "contract_or_payment_instruction",
  "beneficial_owner_or_relationship_explanation",
  "board_or_member_resolution_where_applicable",
  "compliance_owner_approval",
] as const;

export const BANK_THIRD_PARTY_API_RAW_BLOCKED_BY_DEFAULT = true;
export const BANK_THIRD_PARTY_API_REQUIRES_TWO_PERSON = true;

export function evaluateThirdPartyAccount(input: {
  evidence_present: readonly string[];
  compliance_owner_approved: boolean;
}): { usable: boolean; reason?: string } {
  const missing = BANK_THIRD_PARTY_REQUIRED_EVIDENCE.filter(
    (e) => !input.evidence_present.includes(e),
  );
  if (missing.length > 0 || !input.compliance_owner_approved) {
    return { usable: false, reason: "third_party_account_blocked_pending_evidence_or_approval" };
  }
  return { usable: true };
}

// ──────────────────── Evidence requirements ────────────────────

export const BANK_BASE_REQUIRED_EVIDENCE = [
  "recent_bank_confirmation_letter_or_statement",
  "account_holder_proof",
  "company_mandate_or_board_resolution_where_authority_not_obvious",
  "submitter_authority_evidence",
  "account_purpose",
  "currency_or_payment_route",
  "consent_declaration",
] as const;

export const BANK_EVIDENCE_METADATA_FIELDS = [
  "document_type",
  "issuer",
  "date",
  "expiry",
  "reviewer",
  "review_status",
  "evidence_reference",
] as const;

/** Statuses that require evidence review to have been completed before entry. */
export const BANK_REQUIRES_EVIDENCE_REVIEW_BEFORE = [
  "manually_checked",
  "verified",
  "provider_verified",
  "bank_confirmed",
  "institution_confirmed",
  "manual_bank_check_complete",
] as const;

export function isBankStatusGatedByEvidenceReview(status: string): boolean {
  return (BANK_REQUIRES_EVIDENCE_REVIEW_BEFORE as readonly string[]).includes(status);
}

// ──────────────────── Masked / unmasked access ────────────────────

export const BANK_MASKED_VIEW_ROLES = [
  "company_authorised_bank_user",
  "platform_admin",
  "compliance_owner",
  "finance_operations",
  "approved_institutional_api_client_with_bank_status_scope",
] as const;

export const BANK_UNMASKED_VIEW_ROLES = [
  "compliance_owner",
  "authorised_finance_operations",
  "authorised_platform_admin",
  "company_authorised_bank_submit_user_viewing_own_account",
] as const;

export const BANK_UNMASKED_REQUIRES_AAL2 = true;
export const BANK_UNMASKED_REQUIRES_REASON = true;
export const BANK_UNMASKED_REQUIRES_AUDIT_EVENT = true;
export const BANK_PUBLIC_USERS_NEVER_SEE_BANK = true;
export const BANK_API_RAW_BLOCKED_BY_DEFAULT = true;

export interface BankUnmaskRequestInput {
  actor_role: string;
  aal2: boolean;
  reason_code: string | null;
  is_viewing_own_account: boolean;
}
export type BankUnmaskRequestResult =
  | { allowed: true; must_audit: true }
  | {
      allowed: false;
      reason: "role_not_permitted" | "aal2_required" | "reason_required";
    };

export function evaluateUnmaskRequest(input: BankUnmaskRequestInput): BankUnmaskRequestResult {
  const roleOk = (BANK_UNMASKED_VIEW_ROLES as readonly string[]).includes(input.actor_role);
  if (!roleOk) return { allowed: false, reason: "role_not_permitted" };
  if (!input.aal2) return { allowed: false, reason: "aal2_required" };
  if (!input.reason_code) return { allowed: false, reason: "reason_required" };
  return { allowed: true, must_audit: true };
}

// ──────────────────── Verification types & status labels ────────────────────

export const BANK_APPROVED_VERIFICATION_TYPES = [
  "provider_confirmed",
  "bank_confirmed",
  "institution_confirmed",
  "compliance_approved_manual_verification",
] as const;
export type BankApprovedVerificationType =
  (typeof BANK_APPROVED_VERIFICATION_TYPES)[number];

export const BANK_DETAIL_STATUS_LABELS = [
  "submitted",
  "company_confirmed",
  "manually_checked",
  "provider_verified",
  "bank_confirmed",
  "institution_confirmed",
  "manual_bank_check_complete",
] as const;
export type BankDetailStatusLabel = (typeof BANK_DETAIL_STATUS_LABELS)[number];

/** Company-confirmed is NEVER verified. Manual_checked is NEVER provider-verified. */
export const BANK_COMPANY_CONFIRMED_IS_VERIFIED = false;
export const BANK_MANUAL_CHECKED_IS_PROVIDER_VERIFIED = false;

export function isBankStatusVerified(status: string): boolean {
  // Only the approved bank verification gates count as "verified".
  return (
    status === "provider_verified" ||
    status === "bank_confirmed" ||
    status === "institution_confirmed" ||
    status === "manual_bank_check_complete"
  );
}

// ──────────────────── Manual verification before provider live ────────────────────

export const BANK_MANUAL_VERIFICATION_LABEL_API = "manual_bank_check_complete" as const;
export const BANK_MANUAL_VERIFICATION_DEMO_COPY =
  "Manual evidence reviewed - no live provider check performed." as const;
export const BANK_MANUAL_VERIFICATION_REQUIRES_COMPLIANCE_OWNER = true;
export const BANK_MANUAL_VERIFICATION_REQUIRES_PLATFORM_ADMIN_DECISION = true;

export const BANK_MANUAL_VERIFICATION_REQUIRED_EVIDENCE = [
  "bank_letter_or_statement",
  "authority_evidence",
  "account_holder_match",
  "reviewer_checklist",
  "expiry_date",
] as const;

export function evaluateManualVerification(input: {
  evidence_present: readonly string[];
  compliance_owner_approved: boolean;
  platform_admin_decision_recorded: boolean;
}):
  | { allowed: true; api_label: typeof BANK_MANUAL_VERIFICATION_LABEL_API }
  | { allowed: false; reason: "missing_evidence" | "needs_compliance_owner" | "needs_platform_admin_decision" } {
  const missing = BANK_MANUAL_VERIFICATION_REQUIRED_EVIDENCE.filter(
    (e) => !input.evidence_present.includes(e),
  );
  if (missing.length > 0) return { allowed: false, reason: "missing_evidence" };
  if (!input.compliance_owner_approved) return { allowed: false, reason: "needs_compliance_owner" };
  if (!input.platform_admin_decision_recorded) {
    return { allowed: false, reason: "needs_platform_admin_decision" };
  }
  return { allowed: true, api_label: BANK_MANUAL_VERIFICATION_LABEL_API };
}

// ──────────────────── Validity / expiry ────────────────────

export const BANK_MANUAL_VERIFICATION_VALIDITY_DAYS = 90 as const;
export const BANK_PROVIDER_OR_BANK_OR_INSTITUTION_VALIDITY_DAYS = 180 as const;

export function bankVerificationValidityDays(type: BankApprovedVerificationType): number {
  if (type === "compliance_approved_manual_verification") {
    return BANK_MANUAL_VERIFICATION_VALIDITY_DAYS;
  }
  return BANK_PROVIDER_OR_BANK_OR_INSTITUTION_VALIDITY_DAYS;
}

export const BANK_IMMEDIATE_EXPIRY_TRIGGERS = [
  "dispute",
  "account_change",
  "company_authority_revocation",
  "adverse_bank_notification",
  "failed_payment",
  "material_correction_request",
] as const;
export type BankImmediateExpiryTrigger = (typeof BANK_IMMEDIATE_EXPIRY_TRIGGERS)[number];

export const BANK_RE_VERIFICATION_TRIGGERS = [
  "expiry_reached",
  ...BANK_IMMEDIATE_EXPIRY_TRIGGERS,
] as const;

// ──────────────────── Non-usable bank states ────────────────────

export const BANK_NON_USABLE_STATES = [
  "pending",
  "disputed",
  "revoked",
  "expired",
  "failed",
] as const;
export type BankNonUsableState = (typeof BANK_NON_USABLE_STATES)[number];

export const BANK_NON_USABLE_UI_WORDING: Record<BankNonUsableState, string> = {
  pending: "Bank details submitted - review pending",
  disputed: "Bank details under dispute",
  revoked: "Bank details revoked",
  expired: "Verification expired - re-verification required",
  failed: "Verification failed",
};

export const BANK_NON_USABLE_API_RESPONSE: Record<BankNonUsableState, string> = {
  pending: "not_usable_pending",
  disputed: "not_usable_disputed",
  revoked: "not_usable_revoked",
  expired: "re_verification_required",
  failed: "failed_not_usable",
};

// ──────────────────── Payment-status API usability gate ────────────────────

export interface PaymentStatusGateInput {
  bank_status: string;
  is_expired: boolean;
  is_disputed: boolean;
  is_revoked: boolean;
  is_pending: boolean;
  required_evidence_present: boolean;
  manual_compliance_approved_if_manual: boolean;
  authority_active_with_bank_or_api_consent: boolean;
  business_decision_allows_api_payment_status: boolean;
}
export type PaymentStatusGateResult =
  | { usable: true }
  | {
      usable: false;
      reason:
        | "status_not_approved_verification"
        | "manual_requires_compliance_approval"
        | "expired"
        | "disputed"
        | "revoked"
        | "pending"
        | "missing_evidence"
        | "authority_inactive_or_missing_consent"
        | "business_decision_blocks_api_payment_status";
    };

export function evaluatePaymentStatusGate(input: PaymentStatusGateInput): PaymentStatusGateResult {
  if (!isBankStatusVerified(input.bank_status)) {
    return { usable: false, reason: "status_not_approved_verification" };
  }
  if (input.bank_status === "manual_bank_check_complete" && !input.manual_compliance_approved_if_manual) {
    return { usable: false, reason: "manual_requires_compliance_approval" };
  }
  if (input.is_expired) return { usable: false, reason: "expired" };
  if (input.is_disputed) return { usable: false, reason: "disputed" };
  if (input.is_revoked) return { usable: false, reason: "revoked" };
  if (input.is_pending) return { usable: false, reason: "pending" };
  if (!input.required_evidence_present) return { usable: false, reason: "missing_evidence" };
  if (!input.authority_active_with_bank_or_api_consent) {
    return { usable: false, reason: "authority_inactive_or_missing_consent" };
  }
  if (!input.business_decision_allows_api_payment_status) {
    return { usable: false, reason: "business_decision_blocks_api_payment_status" };
  }
  return { usable: true };
}

/** Default safe fields returned by the payment-status API. Never raw bank details. */
export const PAYMENT_STATUS_API_SAFE_FIELDS = [
  "payment_status",
  "verification_type",
  "last_verified_date",
  "expiry_date",
  "dispute_state",
  "usable",
  "masked_account_identifier",
  "bank_country",
  "currency",
] as const;

export const PAYMENT_STATUS_API_RAW_BANK_BLOCKED_BY_DEFAULT = true;

// ──────────────────── User-facing wording ────────────────────

export const BANK_OPERATING_WORDING = {
  authority_required:
    "Submitting bank details requires an active authority with a bank-submit scope.",
  claim_only_not_enough:
    "Claim approval alone does not unlock bank-detail submission.",
  expired_authority_blocked:
    "Bank-detail submission is blocked - authority is expired, disputed or revoked.",
  company_confirmed_not_verified:
    "Company-confirmed bank details are not verified bank details.",
  manual_not_provider:
    "Manual review is not a live provider check.",
  third_party_escalation:
    "Third-party bank accounts require mandate, contract, ownership/relationship explanation and compliance owner approval.",
  unmask_requires_aal2_and_reason:
    "Unmasked bank access requires AAL2, a reason code and an audit event.",
} as const;

// ──────────────────── Audit event names ────────────────────

export const BANK_OPERATING_AUDIT_EVENTS = [
  "registry_bank_submit_gate_evaluated",
  "registry_bank_submit_blocked",
  "registry_bank_account_created",
  "registry_bank_account_purpose_assigned",
  "registry_bank_primary_account_set",
  "registry_bank_third_party_pending_review",
  "registry_bank_third_party_blocked",
  "registry_bank_third_party_approved",
  "registry_bank_evidence_submitted",
  "registry_bank_evidence_review_completed",
  "registry_bank_manual_verification_recorded",
  "registry_bank_manual_verification_blocked",
  "registry_bank_provider_verification_recorded",
  "registry_bank_status_changed",
  "registry_bank_status_disputed",
  "registry_bank_status_revoked",
  "registry_bank_status_expired",
  "registry_bank_status_failed",
  "registry_bank_verification_re_verification_triggered",
  "registry_bank_unmask_access_requested",
  "registry_bank_unmask_access_granted",
  "registry_bank_unmask_access_denied",
  "registry_bank_unmask_access_viewed",
  "registry_bank_payment_status_gate_evaluated",
  "registry_bank_payment_status_blocked",
] as const;
export type BankOperatingAuditEvent = (typeof BANK_OPERATING_AUDIT_EVENTS)[number];

// ──────────────────── Parity fingerprint ────────────────────

export const REGISTRY_BANK_OPERATING_PARITY_FINGERPRINT =
  "batch-28-bank-operating-rules-v1" as const;
