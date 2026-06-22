#!/usr/bin/env node
/**
 * Batch 27 — Guard: browser SSOT and Deno SSOT for the claim/authority
 * operating rules must be byte-identical. Both halves of the platform
 * reason from the same client decisions.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BROWSER = "src/lib/registry-claim-authority-rules.ts";
const DENO = "supabase/functions/_shared/registry-claim-authority-rules.ts";

const a = readFileSync(BROWSER);
const b = readFileSync(DENO);
const ha = createHash("sha256").update(a).digest("hex");
const hb = createHash("sha256").update(b).digest("hex");

if (ha !== hb) {
  console.error(
    "❌ Batch 27 SSOT parity FAILED:\n" +
      `  ${BROWSER}                       sha256=${ha}\n` +
      `  ${DENO}    sha256=${hb}\n` +
      "  Copy the browser SSOT verbatim to the Deno mirror.",
  );
  process.exit(1);
}

// Cheap presence check on the canonical exports.
const REQUIRED = [
  "CLAIM_AUTHORITY_REQUIRES_VERIFIED_EMAIL",
  "evaluateClaimGate",
  "CLAIMANT_ROLES",
  "CLAIMANT_ROLE_DISPOSITION",
  "REGISTRY_LEGAL_FORMS",
  "CLAIM_EVIDENCE_BY_LEGAL_FORM",
  "CLAIM_EVIDENCE_REFRESH_MONTHS",
  "isEvidenceFresh",
  "UNLISTED_CLAIMANT_REVIEW_STATE",
  "UNLISTED_CLAIMANT_BLOCKED_CAPABILITIES",
  "CLAIM_STATES",
  "CLAIM_CONFLICT_STATES",
  "claimReviewerRoleFor",
  "CLAIM_APPROVAL_UNLOCKS",
  "CLAIM_APPROVAL_DOES_NOT_UNLOCK",
  "CLAIM_APPROVED_LIMITED_WORDING",
  "AUTHORITY_SCOPES",
  "AUTHORITY_TWO_PERSON_SCOPES",
  "AUTHORITY_COMPLIANCE_OWNER_REQUIRED_SCOPES",
  "AUTHORITY_FORBIDDEN_CAPABILITIES",
  "AUTHORITY_STATES",
  "AUTHORITY_DEFAULT_EXPIRY_MONTHS_GENERAL",
  "AUTHORITY_DEFAULT_EXPIRY_MONTHS_BANK_OR_API",
  "defaultExpiryMonthsForScope",
  "AUTHORITY_SENSITIVE_ACTIONS",
  "AUTHORITY_BLOCKING_STATES",
  "blocksSensitiveAction",
  "evaluateAuthorityAction",
  "AUTHORITY_FULL_REQUIRES_COMPLIANCE_OWNER",
  "AUTHORITY_FULL_IS_DEFAULT",
  "CLAIM_AUTHORITY_WORDING",
  "CLAIM_AUTHORITY_AUDIT_EVENTS",
  "REGISTRY_CLAIM_AUTHORITY_PARITY_FINGERPRINT",
];
const src = a.toString("utf8");
const missing = REQUIRED.filter(
  (n) => !new RegExp(`export\\s+(const|function|type)\\s+${n}\\b`).test(src),
);
if (missing.length > 0) {
  console.error(
    "❌ Batch 27 SSOT missing required exports:\n - " + missing.join("\n - "),
  );
  process.exit(1);
}

console.log("✓ Batch 27 claim/authority SSOT parity OK");
