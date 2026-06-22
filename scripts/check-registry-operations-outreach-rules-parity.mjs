#!/usr/bin/env node
/**
 * Batch 30 — Guard: browser SSOT and Deno SSOT for the operations /
 * outreach / notifications / readiness operating rules must be
 * byte-identical, expose the required exports, and pin invariants.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BROWSER = "src/lib/registry-operations-outreach-rules.ts";
const DENO = "supabase/functions/_shared/registry-operations-outreach-rules.ts";

const a = readFileSync(BROWSER);
const b = readFileSync(DENO);
const ha = createHash("sha256").update(a).digest("hex");
const hb = createHash("sha256").update(b).digest("hex");
if (ha !== hb) {
  console.error(
    "❌ Batch 30 SSOT parity FAILED:\n" +
      `  ${BROWSER}                                       sha256=${ha}\n` +
      `  ${DENO}    sha256=${hb}\n` +
      "  Copy the browser SSOT verbatim to the Deno mirror.",
  );
  process.exit(1);
}

const REQUIRED = [
  "REGISTRY_OPS_AI_ALLOWED_DRAFT_CATEGORIES",
  "REGISTRY_OPS_AI_DRAFT_ONLY",
  "REGISTRY_OPS_AI_MAY_AUTO_SEND",
  "REGISTRY_OPS_AI_DRAFT_REQUIRED_METADATA",
  "REGISTRY_OPS_AI_FIELDS_ALLOWED",
  "REGISTRY_OPS_AI_FIELDS_MASKED",
  "REGISTRY_OPS_AI_FIELDS_ADMIN_ONLY",
  "REGISTRY_OPS_AI_FIELDS_BLOCKED",
  "classifyAiField",
  "evaluateAiDraftGate",
  "REGISTRY_OPS_AI_ALWAYS_FORBIDDEN_PHRASES",
  "REGISTRY_OPS_AI_CONDITIONAL_FORBIDDEN_PHRASES",
  "REGISTRY_OPS_AI_REQUIRED_SAFE_PHRASES",
  "scanForbiddenWording",
  "REGISTRY_OPS_OUTREACH_APPROVAL_ROLES",
  "REGISTRY_OPS_OUTREACH_TWO_PERSON_CATEGORIES",
  "REGISTRY_OPS_OUTREACH_ONE_PERSON_CATEGORIES",
  "evaluateOutreachApproval",
  "REGISTRY_OPS_SENDING_MODE",
  "REGISTRY_OPS_WHATSAPP_ENABLED",
  "REGISTRY_OPS_SMS_ENABLED",
  "REGISTRY_OPS_AI_AUTO_SEND_ENABLED",
  "REGISTRY_OPS_REAL_EMAIL_REQUIRES_APPROVED_CHANNEL",
  "REGISTRY_OPS_REAL_EMAIL_REQUIRES_APPROVED_TEMPLATE",
  "REGISTRY_OPS_REAL_EMAIL_REQUIRES_HUMAN_APPROVAL",
  "REGISTRY_OPS_OUTREACH_STATUSES",
  "evaluateRealEmailSendGate",
  "REGISTRY_OPS_DNC_SCOPES",
  "REGISTRY_OPS_DNC_EFFECTS",
  "REGISTRY_OPS_DNC_ADD_ROLES",
  "REGISTRY_OPS_DNC_REMOVE_ROLES_REQUIRED",
  "REGISTRY_OPS_DNC_DEFAULT_EXPIRY",
  "REGISTRY_OPS_DNC_REVIEW_INTERVAL_MONTHS",
  "REGISTRY_OPS_DNC_AUDIT_REQUIRED_FIELDS",
  "evaluateDncAdd",
  "evaluateDncRemove",
  "REGISTRY_OPS_QUEUE_PRIORITY_ORDER",
  "REGISTRY_OPS_SLAS_BUSINESS_DAYS",
  "REGISTRY_OPS_OVERDUE_AUTO_APPROVE_ENABLED",
  "REGISTRY_OPS_OVERDUE_CREATES_ADMIN_ALERT",
  "evaluateOverdue",
  "REGISTRY_OPS_ADMIN_ALERTS",
  "REGISTRY_OPS_COMPLIANCE_ALERTS",
  "REGISTRY_OPS_COMMERCIAL_ALERTS",
  "REGISTRY_OPS_ALERT_AUTO_EXTERNAL_SEND_ENABLED",
  "REGISTRY_OPS_NOTIFICATION_CHANNELS",
  "REGISTRY_OPS_NOTIFICATION_FUTURE_DISABLED_CHANNELS",
  "REGISTRY_OPS_NOTIFICATION_MATRIX",
  "notificationChannelsFor",
  "REGISTRY_OPS_WHATSAPP_DISABLED_LABEL",
  "REGISTRY_OPS_SMS_DISABLED_LABEL",
  "REGISTRY_OPS_WHATSAPP_SMS_ENABLE_REQUIREMENTS",
  "REGISTRY_OPS_MANUAL_CONTACT_LOG_REPRESENTS_SMS_OR_WHATSAPP",
  "REGISTRY_OPS_READINESS_AUDIENCES",
  "REGISTRY_OPS_READINESS_DEFAULT_AUDIENCE",
  "REGISTRY_OPS_READINESS_EXTERNAL_HIDDEN_FIELDS",
  "readinessAudienceProjection",
  "projectReadinessForAudience",
  "REGISTRY_OPS_CLIENT_SAFE_WORDING",
  "REGISTRY_OPS_READINESS_SECTIONS",
  "REGISTRY_OPS_READINESS_REQUIRED_LABELS",
  "REGISTRY_OPS_READINESS_BUILD_VS_DATA_COLLAPSED",
  "REGISTRY_OPS_AUDIT_EVENTS",
  "REGISTRY_OPS_OPERATING_PARITY_FINGERPRINT",
];
const src = a.toString("utf8");
const missing = REQUIRED.filter(
  (n) => !new RegExp(`export\\s+(const|function|type)\\s+${n}\\b`).test(src),
);
if (missing.length > 0) {
  console.error(
    "❌ Batch 30 SSOT missing required exports:\n - " + missing.join("\n - "),
  );
  process.exit(1);
}

const invariants = [
  [/REGISTRY_OPS_AI_DRAFT_ONLY\s*=\s*true/, "AI must be draft-only"],
  [/REGISTRY_OPS_AI_MAY_AUTO_SEND\s*=\s*false/, "AI must not auto-send"],
  [/REGISTRY_OPS_AI_AUTO_SEND_ENABLED\s*=\s*false/, "AI auto-send must be disabled"],
  [/REGISTRY_OPS_WHATSAPP_ENABLED\s*=\s*false/, "WhatsApp must be disabled"],
  [/REGISTRY_OPS_SMS_ENABLED\s*=\s*false/, "SMS must be disabled"],
  [/REGISTRY_OPS_MANUAL_CONTACT_LOG_REPRESENTS_SMS_OR_WHATSAPP\s*=\s*false/, "manual contact log cannot represent SMS/WhatsApp"],
  [/REGISTRY_OPS_OVERDUE_AUTO_APPROVE_ENABLED\s*=\s*false/, "overdue items must never auto-approve"],
  [/REGISTRY_OPS_OVERDUE_CREATES_ADMIN_ALERT\s*=\s*true/, "overdue items must raise admin alert"],
  [/REGISTRY_OPS_ALERT_AUTO_EXTERNAL_SEND_ENABLED\s*=\s*false/, "alerts must not auto-send externally"],
  [/REGISTRY_OPS_READINESS_DEFAULT_AUDIENCE\s*=\s*"internal_admin"/, "readiness default audience must be internal_admin"],
  [/REGISTRY_OPS_READINESS_BUILD_VS_DATA_COLLAPSED\s*=\s*false/, "build readiness and data readiness must not be collapsed"],
  [/REGISTRY_OPS_REAL_EMAIL_REQUIRES_APPROVED_CHANNEL\s*=\s*true/, "real email requires approved channel"],
  [/REGISTRY_OPS_REAL_EMAIL_REQUIRES_APPROVED_TEMPLATE\s*=\s*true/, "real email requires approved template"],
  [/REGISTRY_OPS_REAL_EMAIL_REQUIRES_HUMAN_APPROVAL\s*=\s*true/, "real email requires human approval"],
  [/"WhatsApp not configured"/, "WhatsApp disabled label must be canonical"],
  [/"SMS not configured"/, "SMS disabled label must be canonical"],
  [/bank_detail_review_initial:\s*1/, "bank-detail initial SLA must be 1 business day"],
  [/authority_to_act_review:\s*2/, "authority review SLA must be 2 business days"],
  [/claim_review:\s*2/, "claim review SLA must be 2 business days"],
  [/data_disputes_corrections_triage:\s*3/, "dispute/correction triage SLA must be 3 business days"],
  [/data_disputes_corrections_resolution:\s*10/, "dispute/correction resolution SLA must be 10 business days"],
  [/api_client_approval:\s*5/, "API client approval SLA must be 5 business days"],
  [/outreach_approval:\s*1/, "outreach approval SLA must be 1 business day"],
];
for (const [re, msg] of invariants) {
  if (!re.test(src)) {
    console.error(`❌ Batch 30 invariant FAILED: ${msg}`);
    process.exit(1);
  }
}

// Queue priority order must be 1..10 in the exact client sequence.
const expectedQueueOrder = [
  "bank_detail_review",
  "authority_to_act_review",
  "claim_review",
  "data_disputes_corrections",
  "import_batch_review_quarantine",
  "duplicate_review_merge",
  "api_client_approval",
  "provider_country_readiness_review",
  "outreach_approval",
  "stale_expired_readiness_review",
];
for (let i = 0; i < expectedQueueOrder.length; i++) {
  const re = new RegExp(`rank:\\s*${i + 1},\\s*queue:\\s*"${expectedQueueOrder[i]}"`);
  if (!re.test(src)) {
    console.error(`❌ Batch 30 queue priority FAILED at rank ${i + 1}: expected "${expectedQueueOrder[i]}"`);
    process.exit(1);
  }
}

console.log("✓ Batch 30 operations / outreach / notifications / readiness SSOT parity OK");
