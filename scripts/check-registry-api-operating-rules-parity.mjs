#!/usr/bin/env node
/**
 * Batch 29 — Guard: browser SSOT and Deno SSOT for the institutional API
 * operating rules must be byte-identical. Both halves of the platform
 * must reason from the same client decisions.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BROWSER = "src/lib/registry-api-operating-rules.ts";
const DENO = "supabase/functions/_shared/registry-api-operating-rules.ts";

const a = readFileSync(BROWSER);
const b = readFileSync(DENO);
const ha = createHash("sha256").update(a).digest("hex");
const hb = createHash("sha256").update(b).digest("hex");

if (ha !== hb) {
  console.error(
    "❌ Batch 29 SSOT parity FAILED:\n" +
      `  ${BROWSER}                       sha256=${ha}\n` +
      `  ${DENO}    sha256=${hb}\n` +
      "  Copy the browser SSOT verbatim to the Deno mirror.",
  );
  process.exit(1);
}

const REQUIRED = [
  "REGISTRY_API_ALLOWED_CLIENT_TYPES",
  "REGISTRY_API_PUBLIC_SELF_SERVE_PRODUCTION_ENABLED",
  "REGISTRY_API_DEFAULT_ENVIRONMENT",
  "REGISTRY_API_PRODUCTION_GATE_REQUIREMENTS",
  "REGISTRY_API_PRODUCTION_BLOCKING_DECISION_STATES",
  "evaluateProductionGate",
  "REGISTRY_API_SENSITIVE_SCOPES",
  "isSensitiveScope",
  "REGISTRY_API_PROFILE_MISSING_FIELD_LABELS",
  "evaluateProfileStatusUsable",
  "REGISTRY_API_PAYMENT_USABLE_BANK_STATES",
  "REGISTRY_API_PAYMENT_NOT_USABLE_BANK_STATES",
  "evaluatePaymentStatusUsable",
  "PAYMENT_STATUS_API_SAFE_RESPONSE_FIELDS",
  "REGISTRY_API_RAW_BANK_DEFAULT_BLOCKED",
  "REGISTRY_API_RAW_BANK_ENDPOINT_EXISTS",
  "REGISTRY_API_RAW_BANK_EXCEPTION_REQUIREMENTS",
  "evaluateRawBankException",
  "REGISTRY_API_SEARCH_KEYS_ALLOWED",
  "REGISTRY_API_SEARCH_KEYS_SPECIAL_APPROVAL",
  "REGISTRY_API_SEARCH_KEYS_HIDDEN",
  "REGISTRY_API_EXACT_MATCH_REQUIRED_KEYS",
  "REGISTRY_API_FUZZY_ALLOWED_KEYS",
  "classifyApiSearchKey",
  "evaluateApiSearchKey",
  "REGISTRY_API_REQUEST_LOG_REQUIRED_FIELDS",
  "REGISTRY_API_REQUEST_LOG_FORBIDDEN_FIELDS",
  "REGISTRY_API_COMPANY_VISIBLE_LOG_FIELDS",
  "REGISTRY_API_COMPANY_HIDDEN_LOG_FIELDS",
  "REGISTRY_API_COMPANY_LOGS_REQUIRE_DASHBOARD_ENABLED",
  "REGISTRY_API_AUTO_COMPANY_NOTIFICATIONS_ENABLED",
  "REGISTRY_API_CLIENT_SEES_OWN_LOGS_ONLY",
  "buildCompanyVisibleLogSummary",
  "REGISTRY_API_PRODUCTION_LIMITS",
  "REGISTRY_API_SANDBOX_LIMITS",
  "REGISTRY_API_SENSITIVE_ENDPOINT_LIMITS",
  "REGISTRY_API_SENSITIVE_ENDPOINTS",
  "REGISTRY_API_QUOTA_OVERAGE_SUSPEND_THRESHOLD_PCT",
  "REGISTRY_API_REQUIRED_CONTROLS",
  "REGISTRY_API_SUSPENSION_TRIGGERS",
  "evaluateSuspension",
  "REGISTRY_API_CLIENT_SELF_VISIBLE_FIELDS",
  "REGISTRY_API_CLIENT_HIDDEN_FIELDS",
  "REGISTRY_API_OPERATING_WORDING",
  "REGISTRY_API_OPERATING_AUDIT_EVENTS",
  "REGISTRY_API_OPERATING_PARITY_FINGERPRINT",
];
const src = a.toString("utf8");
const missing = REQUIRED.filter(
  (n) => !new RegExp(`export\\s+(const|function|type)\\s+${n}\\b`).test(src),
);
if (missing.length > 0) {
  console.error(
    "❌ Batch 29 SSOT missing required exports:\n - " + missing.join("\n - "),
  );
  process.exit(1);
}

// Invariant pins.
const invariants: Array<[RegExp, string]> = [
  [/REGISTRY_API_PUBLIC_SELF_SERVE_PRODUCTION_ENABLED\s*=\s*false/, "public/self-serve production must be disabled"],
  [/REGISTRY_API_DEFAULT_ENVIRONMENT\s*=\s*"sandbox"/, "default environment must be sandbox"],
  [/REGISTRY_API_RAW_BANK_DEFAULT_BLOCKED\s*=\s*true/, "raw bank default must be blocked"],
  [/REGISTRY_API_RAW_BANK_ENDPOINT_EXISTS\s*=\s*false/, "raw bank endpoint must not exist by default"],
  [/REGISTRY_API_AUTO_COMPANY_NOTIFICATIONS_ENABLED\s*=\s*false/, "auto company notifications must be disabled"],
  [/REGISTRY_API_CLIENT_SEES_OWN_LOGS_ONLY\s*=\s*true/, "API clients must see own logs only"],
  [/REGISTRY_API_QUOTA_OVERAGE_SUSPEND_THRESHOLD_PCT\s*=\s*120/, "suspension threshold must be 120%"],
  [/per_minute:\s*60,\s*per_day:\s*5_000,\s*per_month:\s*100_000/, "production limits must be 60/5000/100000"],
  [/per_minute:\s*30,\s*per_day:\s*1_000,\s*per_month:\s*10_000/, "sandbox limits must be 30/1000/10000"],
  [/per_minute:\s*10,\s*per_day:\s*1_000/, "sensitive endpoint limits must be 10/min, 1000/day"],
];
for (const [re, msg] of invariants) {
  if (!re.test(src)) {
    console.error(`❌ Batch 29 invariant FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log("✓ Batch 29 institutional API operating rules SSOT parity OK");
