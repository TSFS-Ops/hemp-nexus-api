/**
 * Batch 16 — Company Portal Guided Journey SSOT.
 *
 * Single source of truth for user-facing labels, next-step engine, blocked
 * states, acknowledgement copy and timeline labels for the company portal.
 *
 * Safety rules:
 *  - Never use "Verified" / "verified" wording for non-final or expired
 *    bank-verification states. Final unexpired Batch 14 `verified` is the
 *    only state that may carry the verified wording.
 *  - Never reference raw bank fields, raw provider payloads, internal
 *    risk scores or admin-only notes from this file.
 *  - All copy is guarded by check-batch-16-portal-* scripts.
 */

// =====================================================================
// CLAIM
// =====================================================================
export type PortalClaimStatus =
  | "not_started"
  | "in_progress"
  | "evidence_requested"
  | "under_review"
  | "approved"
  | "rejected"
  | "conflicted";

export const PORTAL_CLAIM_LABEL: Record<PortalClaimStatus, string> = {
  not_started: "Claim not started",
  in_progress: "Claim in progress",
  evidence_requested: "More evidence needed",
  under_review: "Claim under review",
  approved: "Claim approved",
  rejected: "Claim rejected",
  conflicted: "Claim conflicted",
};

// =====================================================================
// AUTHORITY-TO-ACT
// =====================================================================
export type PortalAuthorityStatus =
  | "not_requested"
  | "in_progress"
  | "evidence_requested"
  | "under_review"
  | "approved"
  | "rejected"
  | "expired"
  | "revoked";

export const PORTAL_AUTHORITY_LABEL: Record<PortalAuthorityStatus, string> = {
  not_requested: "Authority not requested",
  in_progress: "Authority in progress",
  evidence_requested: "More evidence needed",
  under_review: "Authority under review",
  approved: "Authority approved",
  rejected: "Authority rejected",
  expired: "Authority expired",
  revoked: "Authority revoked",
};

// =====================================================================
// BANK DETAILS
// =====================================================================
export type PortalBankDetailStatus =
  | "not_submitted"
  | "submitted"
  | "evidence_requested"
  | "under_review"
  | "captured_unverified"
  | "rejected"
  | "revocation_requested"
  | "revoked";

export const PORTAL_BANK_DETAIL_LABEL: Record<PortalBankDetailStatus, string> = {
  not_submitted: "Bank details not submitted",
  submitted: "Bank details submitted",
  evidence_requested: "More evidence needed",
  under_review: "Bank details under review",
  captured_unverified: "Bank details captured but not verified",
  rejected: "Bank details rejected",
  revocation_requested: "Revocation requested",
  revoked: "Bank details revoked",
};

// =====================================================================
// BANK VERIFICATION (Batch 14 lineage)
// =====================================================================
export type PortalVerificationStatus =
  | "not_available"
  | "requested"
  | "in_progress"
  | "failed"
  | "expired"
  | "disputed"
  | "revoked"
  | "manual_verified" // Izenzo manual review — NEVER "Verified" wording
  | "verified"; // final unexpired Batch 14 only

export const PORTAL_VERIFICATION_LABEL: Record<PortalVerificationStatus, string> = {
  not_available: "Verification not available",
  requested: "Verification requested",
  in_progress: "Verification in progress",
  failed: "Verification failed",
  expired: "Verification expired",
  disputed: "Verification disputed",
  revoked: "Verification revoked",
  manual_verified: "Manually verified under Izenzo review process",
  verified: "Verified",
};

/**
 * Strict safety helper: returns the user-safe label, downgrading any
 * non-final or expired status to its own safe wording (never "Verified").
 * Disputed / revoked / expired ALWAYS lose the verified wording.
 */
export function safeVerificationLabel(
  status: PortalVerificationStatus,
  opts: { expiresAt?: string | null; disputed?: boolean; revoked?: boolean } = {},
): string {
  if (opts.revoked) return PORTAL_VERIFICATION_LABEL.revoked;
  if (opts.disputed) return PORTAL_VERIFICATION_LABEL.disputed;
  if (opts.expiresAt && new Date(opts.expiresAt).getTime() < Date.now()) {
    return PORTAL_VERIFICATION_LABEL.expired;
  }
  return PORTAL_VERIFICATION_LABEL[status];
}

/** Test helper: list of statuses that must NEVER render as "Verified". */
export const PORTAL_VERIFICATION_NON_VERIFIED: PortalVerificationStatus[] = [
  "not_available",
  "requested",
  "in_progress",
  "failed",
  "expired",
  "disputed",
  "revoked",
  "manual_verified",
];

// =====================================================================
// NEXT-STEP ENGINE
// =====================================================================
export type PortalNextStep =
  | "start_claim"
  | "complete_claim_evidence"
  | "wait_for_claim_review"
  | "respond_to_evidence_request"
  | "request_authority"
  | "complete_authority_evidence"
  | "wait_for_authority_review"
  | "submit_bank_details"
  | "respond_to_bank_detail_evidence"
  | "wait_for_bank_detail_review"
  | "request_verification"
  | "wait_for_verification_review"
  | "request_correction"
  | "respond_to_correction"
  | "resolve_dispute"
  | "request_revocation"
  | "none";

export const PORTAL_NEXT_STEP_LABEL: Record<PortalNextStep, string> = {
  start_claim: "Start your claim",
  complete_claim_evidence: "Upload claim evidence",
  wait_for_claim_review: "Waiting for claim review",
  respond_to_evidence_request: "Respond to the evidence request",
  request_authority: "Request authority-to-act",
  complete_authority_evidence: "Upload authority evidence",
  wait_for_authority_review: "Waiting for authority review",
  submit_bank_details: "Submit bank details",
  respond_to_bank_detail_evidence: "Respond to the bank-detail evidence request",
  wait_for_bank_detail_review: "Waiting for bank-detail review",
  request_verification: "Request bank verification",
  wait_for_verification_review: "Waiting for verification review",
  request_correction: "Request a correction",
  respond_to_correction: "Respond to the correction request",
  resolve_dispute: "Resolve the open dispute",
  request_revocation: "Request revocation",
  none: "No action required",
};

export interface PortalCompanyState {
  claim: PortalClaimStatus;
  authority: PortalAuthorityStatus;
  bankDetail: PortalBankDetailStatus;
  verification: PortalVerificationStatus;
  hasOpenEvidenceRequest?: boolean;
  hasOpenCorrectionForUser?: boolean;
  hasOpenDispute?: boolean;
  verificationExpired?: boolean;
  verificationDisputed?: boolean;
  verificationRevoked?: boolean;
}

/**
 * Deterministic next-step engine. Order of precedence is intentional and
 * must not change without updating tests + SSOT parity guard.
 */
export function computeNextStep(s: PortalCompanyState): PortalNextStep {
  // 1. Claim must exist and be approved first
  if (s.claim === "not_started") return "start_claim";
  if (s.claim === "in_progress") return "complete_claim_evidence";
  if (s.claim === "evidence_requested") return "respond_to_evidence_request";
  if (s.claim === "under_review") return "wait_for_claim_review";
  if (s.claim === "conflicted") return "resolve_dispute";
  if (s.claim === "rejected") return "none"; // terminal
  // claim approved → proceed

  // 2. Open dispute always escalates above further submissions
  if (s.hasOpenDispute) return "resolve_dispute";

  // 3. Outstanding evidence requests
  if (s.hasOpenEvidenceRequest) return "respond_to_evidence_request";

  // 4. Open correction needing user response
  if (s.hasOpenCorrectionForUser) return "respond_to_correction";

  // 5. Authority required before bank details
  if (s.authority === "not_requested") return "request_authority";
  if (s.authority === "in_progress") return "complete_authority_evidence";
  if (s.authority === "evidence_requested") return "respond_to_evidence_request";
  if (s.authority === "under_review") return "wait_for_authority_review";
  if (s.authority === "rejected" || s.authority === "expired" || s.authority === "revoked") {
    return "request_authority";
  }
  // authority approved → proceed

  // 6. Bank details
  if (s.bankDetail === "not_submitted") return "submit_bank_details";
  if (s.bankDetail === "evidence_requested") return "respond_to_bank_detail_evidence";
  if (s.bankDetail === "submitted" || s.bankDetail === "under_review") {
    return "wait_for_bank_detail_review";
  }
  if (s.bankDetail === "rejected") return "submit_bank_details";
  if (s.bankDetail === "revoked") return "submit_bank_details";
  if (s.bankDetail === "revocation_requested") return "wait_for_bank_detail_review";
  // captured_unverified → verification

  // 7. Verification
  if (s.verificationRevoked) return "request_verification";
  if (s.verificationDisputed) return "resolve_dispute";
  if (s.verificationExpired || s.verification === "expired") return "request_verification";
  if (s.verification === "not_available") return "none";
  if (s.verification === "requested" || s.verification === "in_progress") {
    return "wait_for_verification_review";
  }
  if (s.verification === "failed") return "request_verification";
  // verified / manual_verified
  return "none";
}

// =====================================================================
// BLOCKED / EMPTY STATE LABELS
// =====================================================================
export const PORTAL_BLOCKED_LABEL = {
  no_companies: "You have not claimed any companies yet.",
  claim_required: "A claim is required before you can manage this company.",
  authority_required: "Authority-to-act is required before this action.",
  evidence_required: "Compliance has requested more evidence.",
  review_pending: "An Izenzo reviewer is checking this. No action is required from you right now.",
  country_not_ready: "The Business Registry is not yet active in this country.",
  not_claimable: "This registry record is not currently claimable.",
  bank_detail_not_available: "Bank details cannot be submitted at this stage.",
  verification_unavailable: "Verification is not available for this submission.",
  dispute_active: "An active dispute blocks this action until it is resolved.",
  revoked: "This item has been revoked.",
  expired: "This item has expired.",
} as const;

// =====================================================================
// ACKNOWLEDGEMENT COPY (guarded — must appear verbatim on forms)
// =====================================================================
export const PORTAL_CORRECTION_ACK =
  "Submitting a correction request does not immediately change the registry record. The request will be reviewed first.";

export const PORTAL_DISPUTE_ACK =
  "Opening a dispute does not automatically change any approved status. An Izenzo reviewer will assess the dispute.";

export const PORTAL_REVOCATION_BANK_ACK =
  "Revocation may cause payment-status responses to return not verified or not usable.";

export const PORTAL_REVOCATION_AUTHORITY_ACK =
  "Revoking authority-to-act will remove your ability to manage this company's bank details and verification until authority is granted again.";

// =====================================================================
// CORRECTION & DISPUTE CATEGORIES
// =====================================================================
export const PORTAL_CORRECTION_CATEGORIES = [
  "company_name",
  "trading_name",
  "address",
  "registration_number",
  "company_status",
  "officer_member_data",
  "contact_data",
  "source_provenance",
  "duplicate_merge",
  "other",
] as const;

export type PortalCorrectionCategory = (typeof PORTAL_CORRECTION_CATEGORIES)[number];

export const PORTAL_DISPUTE_CATEGORIES = [
  "claim",
  "authority",
  "bank_detail",
  "verification",
  "duplicate_company",
  "incorrect_source_data",
  "other",
] as const;

export type PortalDisputeCategory = (typeof PORTAL_DISPUTE_CATEGORIES)[number];

export const PORTAL_REVOCATION_TARGETS = [
  "authority",
  "bank_detail",
  "bank_verification",
] as const;

export type PortalRevocationTarget = (typeof PORTAL_REVOCATION_TARGETS)[number];

// =====================================================================
// TIMELINE LABELS (whitelist — only these may appear in user timeline)
// =====================================================================
export const PORTAL_TIMELINE_EVENT_LABEL: Record<string, string> = {
  company_imported: "Company imported into the Business Registry",
  claim_started: "Claim started",
  claim_evidence_uploaded: "Claim evidence uploaded",
  claim_submitted: "Claim submitted",
  claim_evidence_requested: "Claim evidence requested",
  claim_approved: "Claim approved",
  claim_rejected: "Claim rejected",
  authority_requested: "Authority-to-act requested",
  authority_evidence_uploaded: "Authority evidence uploaded",
  authority_approved: "Authority approved",
  authority_rejected: "Authority rejected",
  bank_details_submitted: "Bank details submitted",
  bank_detail_evidence_requested: "Bank-detail evidence requested",
  bank_details_captured_unverified: "Bank details captured but not verified",
  bank_detail_rejected: "Bank details rejected",
  verification_requested: "Verification requested",
  verification_in_progress: "Verification in progress",
  verification_completed: "Verification completed",
  verification_failed: "Verification failed",
  verification_expired: "Verification expired",
  verification_disputed: "Verification disputed",
  verification_revoked: "Verification revoked",
  correction_requested: "Correction requested",
  correction_resolved: "Correction resolved",
  dispute_opened: "Dispute opened",
  dispute_resolved: "Dispute resolved",
};

export const PORTAL_TIMELINE_WHITELIST = Object.keys(PORTAL_TIMELINE_EVENT_LABEL);

/** Strip any timeline event not on the safe whitelist. */
export function filterSafeTimeline<T extends { event_name: string }>(events: T[]): T[] {
  const set = new Set(PORTAL_TIMELINE_WHITELIST);
  return events.filter((e) => set.has(e.event_name));
}

// =====================================================================
// SAFE-DATA GUARD HELPER
// Returns true if the object has any field name that matches forbidden
// patterns (raw bank, provider payload, admin notes). Used in tests.
// =====================================================================
const FORBIDDEN_FIELD_PATTERNS = [
  /^account_number$/i,
  /^iban$/i,
  /^branch_code$/i,
  /^swift$/i,
  /^bic$/i,
  /^account_holder$/i,
  /^bank_code$/i,
  /^provider_payload$/i,
  /^raw_provider/i,
  /^admin_note/i,
  /^internal_risk/i,
  /^reviewer_internal/i,
];

export function hasForbiddenField(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    if (FORBIDDEN_FIELD_PATTERNS.some((rx) => rx.test(k))) return true;
  }
  return false;
}
