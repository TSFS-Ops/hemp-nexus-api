#!/usr/bin/env node
/**
 * Batch 28 — Guard: browser SSOT and Deno SSOT for the bank-detail
 * operating rules must be byte-identical. Both halves of the platform
 * must reason from the same client decisions.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BROWSER = "src/lib/registry-bank-operating-rules.ts";
const DENO = "supabase/functions/_shared/registry-bank-operating-rules.ts";

const a = readFileSync(BROWSER);
const b = readFileSync(DENO);
const ha = createHash("sha256").update(a).digest("hex");
const hb = createHash("sha256").update(b).digest("hex");

if (ha !== hb) {
  console.error(
    "❌ Batch 28 SSOT parity FAILED:\n" +
      `  ${BROWSER}                       sha256=${ha}\n` +
      `  ${DENO}    sha256=${hb}\n` +
      "  Copy the browser SSOT verbatim to the Deno mirror.",
  );
  process.exit(1);
}

const REQUIRED = [
  "BANK_SUBMIT_REQUIRED_AUTHORITY_SCOPE",
  "BANK_SUBMIT_ALSO_ACCEPTED_SCOPE",
  "BANK_SUBMIT_BLOCKED_USER_KINDS",
  "BANK_SUBMIT_BLOCKING_AUTHORITY_STATES",
  "BANK_SUBMIT_CLAIM_APPROVAL_ALONE_UNLOCKS",
  "evaluateBankSubmitGate",
  "BANK_FIELD_GROUPS",
  "BANK_REQUIRED_FIELDS_ZA",
  "BANK_REQUIRED_FIELDS_NG",
  "BANK_FORBIDDEN_FIELD_NG_BVN",
  "BANK_NG_BVN_REQUIRES_SEPARATE_APPROVAL",
  "BANK_REQUIRED_FIELDS_OTHER",
  "requiredBankFields",
  "detectBankFieldGroup",
  "validateBankFields",
  "BANK_ACCOUNT_PURPOSE_LABELS",
  "BANK_V1_MAX_ACTIVE_ACCOUNTS",
  "BANK_V1_OVER_MAX_REQUIRES_ROLES",
  "evaluateNewBankAccount",
  "BANK_THIRD_PARTY_DEFAULT_STATE",
  "BANK_THIRD_PARTY_BLOCKED_STATE",
  "BANK_THIRD_PARTY_REQUIRED_EVIDENCE",
  "BANK_THIRD_PARTY_API_RAW_BLOCKED_BY_DEFAULT",
  "BANK_THIRD_PARTY_API_REQUIRES_TWO_PERSON",
  "evaluateThirdPartyAccount",
  "BANK_BASE_REQUIRED_EVIDENCE",
  "BANK_EVIDENCE_METADATA_FIELDS",
  "BANK_REQUIRES_EVIDENCE_REVIEW_BEFORE",
  "isBankStatusGatedByEvidenceReview",
  "BANK_MASKED_VIEW_ROLES",
  "BANK_UNMASKED_VIEW_ROLES",
  "BANK_UNMASKED_REQUIRES_AAL2",
  "BANK_UNMASKED_REQUIRES_REASON",
  "BANK_UNMASKED_REQUIRES_AUDIT_EVENT",
  "BANK_PUBLIC_USERS_NEVER_SEE_BANK",
  "BANK_API_RAW_BLOCKED_BY_DEFAULT",
  "evaluateUnmaskRequest",
  "BANK_APPROVED_VERIFICATION_TYPES",
  "BANK_DETAIL_STATUS_LABELS",
  "BANK_COMPANY_CONFIRMED_IS_VERIFIED",
  "BANK_MANUAL_CHECKED_IS_PROVIDER_VERIFIED",
  "isBankStatusVerified",
  "BANK_MANUAL_VERIFICATION_LABEL_API",
  "BANK_MANUAL_VERIFICATION_DEMO_COPY",
  "BANK_MANUAL_VERIFICATION_REQUIRES_COMPLIANCE_OWNER",
  "BANK_MANUAL_VERIFICATION_REQUIRES_PLATFORM_ADMIN_DECISION",
  "BANK_MANUAL_VERIFICATION_REQUIRED_EVIDENCE",
  "evaluateManualVerification",
  "BANK_MANUAL_VERIFICATION_VALIDITY_DAYS",
  "BANK_PROVIDER_OR_BANK_OR_INSTITUTION_VALIDITY_DAYS",
  "bankVerificationValidityDays",
  "BANK_IMMEDIATE_EXPIRY_TRIGGERS",
  "BANK_RE_VERIFICATION_TRIGGERS",
  "BANK_NON_USABLE_STATES",
  "BANK_NON_USABLE_UI_WORDING",
  "BANK_NON_USABLE_API_RESPONSE",
  "evaluatePaymentStatusGate",
  "PAYMENT_STATUS_API_SAFE_FIELDS",
  "PAYMENT_STATUS_API_RAW_BANK_BLOCKED_BY_DEFAULT",
  "BANK_OPERATING_WORDING",
  "BANK_OPERATING_AUDIT_EVENTS",
  "REGISTRY_BANK_OPERATING_PARITY_FINGERPRINT",
];
const src = a.toString("utf8");
const missing = REQUIRED.filter(
  (n) => !new RegExp(`export\\s+(const|function|type)\\s+${n}\\b`).test(src),
);
if (missing.length > 0) {
  console.error(
    "❌ Batch 28 SSOT missing required exports:\n - " + missing.join("\n - "),
  );
  process.exit(1);
}

// Invariant pins: company-confirmed and manual_checked must NEVER be verified
// and raw bank output must be blocked by default in API.
if (!/BANK_COMPANY_CONFIRMED_IS_VERIFIED\s*=\s*false/.test(src)) {
  console.error("❌ Batch 28: BANK_COMPANY_CONFIRMED_IS_VERIFIED must be false");
  process.exit(1);
}
if (!/BANK_MANUAL_CHECKED_IS_PROVIDER_VERIFIED\s*=\s*false/.test(src)) {
  console.error("❌ Batch 28: BANK_MANUAL_CHECKED_IS_PROVIDER_VERIFIED must be false");
  process.exit(1);
}
if (!/BANK_API_RAW_BLOCKED_BY_DEFAULT\s*=\s*true/.test(src)) {
  console.error("❌ Batch 28: BANK_API_RAW_BLOCKED_BY_DEFAULT must be true");
  process.exit(1);
}
if (!/PAYMENT_STATUS_API_RAW_BANK_BLOCKED_BY_DEFAULT\s*=\s*true/.test(src)) {
  console.error("❌ Batch 28: PAYMENT_STATUS_API_RAW_BANK_BLOCKED_BY_DEFAULT must be true");
  process.exit(1);
}
if (!/BANK_V1_MAX_ACTIVE_ACCOUNTS\s*=\s*3/.test(src)) {
  console.error("❌ Batch 28: BANK_V1_MAX_ACTIVE_ACCOUNTS must be 3");
  process.exit(1);
}
if (!/BANK_MANUAL_VERIFICATION_VALIDITY_DAYS\s*=\s*90/.test(src)) {
  console.error("❌ Batch 28: BANK_MANUAL_VERIFICATION_VALIDITY_DAYS must be 90");
  process.exit(1);
}
if (!/BANK_PROVIDER_OR_BANK_OR_INSTITUTION_VALIDITY_DAYS\s*=\s*180/.test(src)) {
  console.error("❌ Batch 28: provider/bank/institution validity must be 180");
  process.exit(1);
}
if (!/BANK_SUBMIT_CLAIM_APPROVAL_ALONE_UNLOCKS\s*=\s*false/.test(src)) {
  console.error("❌ Batch 28: claim approval alone must NOT unlock bank submission");
  process.exit(1);
}

console.log("✓ Batch 28 bank-detail operating rules SSOT parity OK");
