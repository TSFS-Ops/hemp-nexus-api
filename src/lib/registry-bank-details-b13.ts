/**
 * Batch 13 — Consent-Based Bank-Detail Submission & Review SSOT (browser mirror).
 *
 * Separate from src/lib/registry-bank-details.ts (Batch 4) so that the existing
 * Batch 4 parity guard remains pinned. This file SUPERSETS Batch 4 with the
 * full submission lifecycle, evidence categories, consent scopes, country
 * field requirements, risk flag types, review actions, public labels and
 * audit-event names introduced in Batch 13.
 *
 * Mirror: supabase/functions/_shared/registry-bank-details-b13.ts
 * Pinned by: scripts/check-registry-bank-detail-b13-parity.mjs
 *            scripts/check-registry-bank-detail-b13-no-verified.mjs
 */

import {
  REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
  maskAccountToken,
} from "./registry-bank-details";

export { REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY, maskAccountToken };

/** Submission lifecycle statuses introduced in Batch 13. */
export const REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES = [
  "draft",
  "submitted",
  "evidence_required",
  "under_review",
  "more_evidence_requested",
  "evidence_resubmitted",
  "captured_unverified",
  "rejected",
  "cancelled",
  "withdrawn",
  "revocation_requested",
  "revoked",
  "disputed",
  "expired",
  "superseded",
] as const;
export type RegistryBankDetailB13SubmissionStatus =
  (typeof REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES)[number];

/**
 * NONE of the Batch 13 submission statuses count as "verified". The only
 * verified state lives in the Batch 4 bank-detail state model
 * (`REGISTRY_BANK_DETAIL_VERIFIED_STATE`) and Batch 13 must never grant it.
 */
export const REGISTRY_BANK_DETAIL_B13_NOT_VERIFIED_STATUSES: RegistryBankDetailB13SubmissionStatus[] = [
  ...REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES,
];

/** Evidence categories accepted on a bank-detail submission. */
export const REGISTRY_BANK_DETAIL_B13_EVIDENCE_CATEGORIES = [
  "bank_confirmation_letter",
  "bank_statement",
  "stamped_bank_document",
  "account_confirmation_document",
  "cancelled_cheque",
  "board_or_company_mandate",
  "authority_reference",
  "account_holder_name_explanation",
  "third_party_account_justification",
  "declaration",
  "other_supporting_evidence",
] as const;
export type RegistryBankDetailB13EvidenceCategory =
  (typeof REGISTRY_BANK_DETAIL_B13_EVIDENCE_CATEGORIES)[number];

export const REGISTRY_BANK_DETAIL_B13_EVIDENCE_STATES = [
  "uploaded",
  "metadata_only",
  "pending_review",
  "accepted",
  "rejected",
  "expired",
  "superseded",
  "withdrawn",
] as const;
export type RegistryBankDetailB13EvidenceState =
  (typeof REGISTRY_BANK_DETAIL_B13_EVIDENCE_STATES)[number];

/** Consent scopes for the controlled bank-detail submission. */
export const REGISTRY_BANK_DETAIL_B13_CONSENT_SCOPES = [
  "bank_detail_storage",
  "bank_detail_review",
  "bank_detail_masked_display",
  "bank_detail_status_response",
  "bank_detail_reverification",
  "bank_detail_dispute_handling",
  "bank_detail_audit_retention",
] as const;
export type RegistryBankDetailB13ConsentScope =
  (typeof REGISTRY_BANK_DETAIL_B13_CONSENT_SCOPES)[number];

/** Authority scopes that gate Batch 13 actions. */
export const REGISTRY_BANK_DETAIL_B13_AUTHORITY_SCOPES = [
  "bank_detail_submission",
  "bank_detail_update",
  "bank_detail_revocation_request",
] as const;
export type RegistryBankDetailB13AuthorityScope =
  (typeof REGISTRY_BANK_DETAIL_B13_AUTHORITY_SCOPES)[number];

export const REGISTRY_BANK_DETAIL_B13_ACTION_SCOPE_MAP: Record<
  "submit" | "update" | "revoke",
  RegistryBankDetailB13AuthorityScope
> = {
  submit: "bank_detail_submission",
  update: "bank_detail_update",
  revoke: "bank_detail_revocation_request",
};

/** Risk flag types raised against submissions. */
export const REGISTRY_BANK_DETAIL_B13_RISK_FLAG_TYPES = [
  "account_holder_mismatch",
  "individual_holder_for_company",
  "third_party_account",
  "bank_country_company_mismatch",
  "bank_country_jurisdiction_mismatch",
  "duplicate_fingerprint_on_other_company",
  "submitter_is_professional_representative",
  "authority_expires_soon",
  "evidence_missing",
  "evidence_expired",
] as const;
export type RegistryBankDetailB13RiskFlagType =
  (typeof REGISTRY_BANK_DETAIL_B13_RISK_FLAG_TYPES)[number];

export const REGISTRY_BANK_DETAIL_B13_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "blocked",
] as const;
export type RegistryBankDetailB13RiskLevel =
  (typeof REGISTRY_BANK_DETAIL_B13_RISK_LEVELS)[number];

/** Account holder kinds. */
export const REGISTRY_BANK_DETAIL_B13_HOLDER_KINDS = [
  "company",
  "individual",
  "third_party",
] as const;
export type RegistryBankDetailB13HolderKind =
  (typeof REGISTRY_BANK_DETAIL_B13_HOLDER_KINDS)[number];

/** Admin review actions. Every action except `assign_reviewer` requires a reason. */
export const REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS = [
  "start_review",
  "request_more_evidence",
  "accept_evidence_item",
  "reject_evidence_item",
  "accept_captured_unverified",
  "reject_submission",
  "mark_disputed",
  "request_revocation",
  "approve_revocation",
  "expire_submission",
  "supersede_submission",
  "assign_reviewer",
  "add_internal_note",
  "request_unmask_access",
] as const;
export type RegistryBankDetailB13ReviewAction =
  (typeof REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS)[number];

export const REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS_NO_REASON: RegistryBankDetailB13ReviewAction[] = [
  "assign_reviewer",
];

/** Unmask access reasons (free text expected, with these canonical seed reasons). */
export const REGISTRY_BANK_DETAIL_B13_UNMASK_REASONS = [
  "compliance_investigation",
  "dispute_resolution",
  "payment_failure_diagnosis",
  "regulatory_request",
  "internal_audit",
] as const;
export type RegistryBankDetailB13UnmaskReason =
  (typeof REGISTRY_BANK_DETAIL_B13_UNMASK_REASONS)[number];

/** Public-facing status labels. Only these labels may appear publicly. */
export const REGISTRY_BANK_DETAIL_B13_PUBLIC_STATUS_LABELS = [
  "No bank details available",
  "Bank details submitted for review",
  "Bank details captured but not verified",
  "Bank-detail review required",
  "Bank details disputed",
  "Bank details revoked",
  "Bank details expired",
] as const;

/** Audit event names emitted by Batch 13. */
export const REGISTRY_BANK_DETAIL_B13_AUDIT_EVENT_NAMES = [
  "registry_bank_detail_started",
  "registry_bank_detail_submitted",
  "registry_bank_detail_evidence_uploaded",
  "registry_bank_detail_evidence_metadata_added",
  "registry_bank_detail_consent_accepted",
  "registry_bank_detail_review_started",
  "registry_bank_detail_more_evidence_requested",
  "registry_bank_detail_evidence_resubmitted",
  "registry_bank_detail_evidence_reviewed",
  "registry_bank_detail_captured_unverified",
  "registry_bank_detail_rejected",
  "registry_bank_detail_disputed",
  "registry_bank_detail_revocation_requested",
  "registry_bank_detail_revoked",
  "registry_bank_detail_expired",
  "registry_bank_detail_superseded",
  "registry_bank_detail_risk_flag_added",
  "registry_bank_detail_duplicate_fingerprint_detected",
  "registry_bank_detail_unmask_requested",
  "registry_bank_detail_unmask_viewed",
  "registry_bank_detail_note_added",
  "registry_bank_detail_notification_logged",
] as const;
export type RegistryBankDetailB13AuditEventName =
  (typeof REGISTRY_BANK_DETAIL_B13_AUDIT_EVENT_NAMES)[number];

/** Country-specific bank field requirements. */
export interface RegistryBankDetailB13CountryRequirements {
  countryCode: string;
  requiredFields: string[];
  optionalFields: string[];
}

export const REGISTRY_BANK_DETAIL_B13_COUNTRY_REQUIREMENTS: Record<
  string,
  RegistryBankDetailB13CountryRequirements
> = {
  ZA: {
    countryCode: "ZA",
    requiredFields: [
      "account_holder_name",
      "bank_name",
      "account_number",
      "branch_code",
      "account_type",
      "currency_code",
      "company_reference",
    ],
    optionalFields: ["bank_code", "branch_name"],
  },
  NG: {
    countryCode: "NG",
    requiredFields: [
      "account_holder_name",
      "bank_name",
      "account_number",
      "account_type",
      "currency_code",
      "company_reference",
    ],
    optionalFields: ["bank_code", "branch_name"],
  },
  DEFAULT: {
    countryCode: "DEFAULT",
    requiredFields: [
      "account_holder_name",
      "bank_name",
      "currency_code",
      "country_code",
      "company_reference",
    ],
    optionalFields: [
      "account_number",
      "iban",
      "swift_bic",
      "routing_number",
      "sort_code",
      "branch_name",
      "bank_code",
    ],
  },
};

export function getBankDetailCountryRequirements(
  countryCode: string,
): RegistryBankDetailB13CountryRequirements {
  const k = (countryCode || "").toUpperCase();
  return (
    REGISTRY_BANK_DETAIL_B13_COUNTRY_REQUIREMENTS[k] ??
    REGISTRY_BANK_DETAIL_B13_COUNTRY_REQUIREMENTS.DEFAULT
  );
}

/** Returns the list of required fields missing from `provided`. */
export function findMissingBankFields(
  countryCode: string,
  provided: Record<string, unknown>,
): string[] {
  const req = getBankDetailCountryRequirements(countryCode);
  return req.requiredFields.filter((f) => {
    const v = provided[f];
    return v === undefined || v === null || v === "";
  });
}

/** Mandatory consent wording — pinned by Batch 13 wording guard. */
export const REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING =
  "Submitted bank details are captured for review. They are not verified unless and until the bank-detail status separately says verified.";

/** Mandatory admin acceptance acknowledgement wording — pinned by guard. */
export const REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT =
  "I understand that accepting this submission only records bank details as captured/unverified. It does not verify the bank details.";

/** Mandatory admin acceptance public message — pinned by guard. */
export const REGISTRY_BANK_DETAIL_B13_ACCEPT_PUBLIC_NOTICE =
  "Bank details captured for review. This does not mean the bank details are verified.";

/** Forbidden wording fragments — they would imply verification that Batch 13 cannot grant. */
export const REGISTRY_BANK_DETAIL_B13_FORBIDDEN_WORDING = [
  "bank details verified",
  "account verified",
  "verified bank account",
  "institutionally usable",
];

/** Returns true if a B13 status is institutionally usable. Always false in Batch 13. */
export function isBankDetailB13Verified(
  _s: RegistryBankDetailB13SubmissionStatus,
): boolean {
  return false;
}

/** Compute an account fingerprint suitable for duplicate detection. */
export function computeAccountFingerprint(parts: {
  countryCode?: string | null;
  bankCode?: string | null;
  branchCode?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
}): string {
  const normalize = (v: string | null | undefined) =>
    (v ?? "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const key = [
    normalize(parts.countryCode),
    normalize(parts.bankCode),
    normalize(parts.branchCode),
    normalize(parts.accountNumber),
    normalize(parts.iban),
  ].join("|");
  // Lightweight deterministic hash; full SHA-256 is performed server-side.
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return "fp_" + (h >>> 0).toString(16);
}

/** Detect simple account-holder vs company-name mismatch (heuristic). */
export function accountHolderLikelyMismatch(
  holder: string,
  companyName: string,
): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const a = norm(holder);
  const b = norm(companyName);
  if (!a || !b) return false;
  if (a === b) return false;
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  let shared = 0;
  for (const t of aTokens) if (bTokens.has(t)) shared++;
  return shared === 0;
}
