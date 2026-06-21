/**
 * Batch 13 — Consent-Based Bank-Detail Submission & Review SSOT (Deno mirror).
 * Mirror of src/lib/registry-bank-details-b13.ts. Do not drift.
 *
 * Pinned by scripts/check-registry-bank-detail-b13-parity.mjs.
 */

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

export const REGISTRY_BANK_DETAIL_B13_HOLDER_KINDS = [
  "company",
  "individual",
  "third_party",
] as const;

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

export const REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS_NO_REASON: RegistryBankDetailB13ReviewAction[] =
  ["assign_reviewer"];

export const REGISTRY_BANK_DETAIL_B13_UNMASK_REASONS = [
  "compliance_investigation",
  "dispute_resolution",
  "payment_failure_diagnosis",
  "regulatory_request",
  "internal_audit",
] as const;

export const REGISTRY_BANK_DETAIL_B13_PUBLIC_STATUS_LABELS = [
  "No bank details available",
  "Bank details submitted for review",
  "Bank details captured but not verified",
  "Bank-detail review required",
  "Bank details disputed",
  "Bank details revoked",
  "Bank details expired",
] as const;

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

export const REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING =
  "Submitted bank details are captured for review. They are not verified unless and until the bank-detail status separately says verified.";
export const REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT =
  "I understand that accepting this submission only records bank details as captured/unverified. It does not verify the bank details.";
export const REGISTRY_BANK_DETAIL_B13_ACCEPT_PUBLIC_NOTICE =
  "Bank details captured for review. This does not mean the bank details are verified.";

export function isBankDetailB13Verified(
  _s: RegistryBankDetailB13SubmissionStatus,
): boolean {
  return false;
}

export async function computeAccountFingerprintSha256(parts: {
  countryCode?: string | null;
  bankCode?: string | null;
  branchCode?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
}): Promise<string> {
  const normalize = (v: string | null | undefined) =>
    (v ?? "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const key = [
    normalize(parts.countryCode),
    normalize(parts.bankCode),
    normalize(parts.branchCode),
    normalize(parts.accountNumber),
    normalize(parts.iban),
  ].join("|");
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return (
    "sha256:" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

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
