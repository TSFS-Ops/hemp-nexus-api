#!/usr/bin/env node
/**
 * Batch 24 — Guard: browser SSOT and Deno SSOT for the registry
 * operating rules MUST stay byte-identical except for their leading
 * "(browser)" / "(Deno mirror)" header comment. Fails the build on
 * ANY drift so the gates, states, wording and approval rules cannot
 * silently diverge between the React app and edge functions.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const BROWSER = "src/lib/registry-operating-rules.ts";
const DENO = "supabase/functions/_shared/registry-operating-rules.ts";

const FAILS = [];
const fail = (m) => FAILS.push(m);

if (!existsSync(BROWSER)) fail(`Missing browser SSOT at ${BROWSER}`);
if (!existsSync(DENO)) fail(`Missing Deno SSOT at ${DENO}`);
if (FAILS.length > 0) {
  console.error("Batch 24 operating-rules parity guard FAILED:\n - " + FAILS.join("\n - "));
  process.exit(1);
}

function normalise(src) {
  return src
    .replace(/Batch 24 — Registry Operating Rules SSOT \((browser|Deno mirror)\)\./,
             "Batch 24 — Registry Operating Rules SSOT.")
    .replace(/\r\n/g, "\n")
    .trimEnd();
}

const browser = normalise(readFileSync(BROWSER, "utf8"));
const deno = normalise(readFileSync(DENO, "utf8"));

const bHash = createHash("sha256").update(browser).digest("hex");
const dHash = createHash("sha256").update(deno).digest("hex");

if (bHash !== dHash) {
  fail(`SSOT drift detected.\n   browser sha256=${bHash}\n   deno    sha256=${dHash}\n   Re-copy: cp ${BROWSER} ${DENO} and re-add the "(Deno mirror)" header.`);
}

// Required exports must exist in BOTH files (cheap textual presence check).
const REQUIRED_EXPORTS = [
  "REGISTRY_READINESS_STATES",
  "REGISTRY_PUBLIC_SEARCH_BLOCKED_STATES",
  "REGISTRY_API_OUTPUT_BLOCKED_STATES",
  "REGISTRY_FIELD_GROUPS",
  "REGISTRY_COUNTRY_CAPABILITY_STATES",
  "REGISTRY_APPROVAL_ROLES",
  "REGISTRY_REQUIRED_APPROVAL_COUNT",
  "REGISTRY_REQUIRED_APPROVAL_ROLES",
  "REGISTRY_BUSINESS_DECISION_TYPES",
  "REGISTRY_BUSINESS_DECISION_REVIEW_DAYS",
  "REGISTRY_BUSINESS_DECISION_IMMEDIATE_REVIEW_TRIGGERS",
  "REGISTRY_PROTECTED_WORDING",
  "REGISTRY_ALWAYS_BLOCKED_WORDING",
  "REGISTRY_FALLBACK_WORDING",
  "REGISTRY_READINESS_LABELS",
  "REGISTRY_OPERATING_RULES_AUDIT_NAMES",
  "REGISTRY_READINESS_DASHBOARD_SECTIONS",
  "isPublicSearchAllowed",
  "isApiOutputAllowed",
  "isDemoAllowed",
  "hasSufficientApprovals",
  "isBusinessDecisionCurrent",
  "isWordingAllowed",
  "missingReadinessChangeField",
  "REGISTRY_OPERATING_RULES_PARITY_FINGERPRINT",
];
for (const name of REQUIRED_EXPORTS) {
  if (!new RegExp(`export\\s+(const|function|type)\\s+${name}\\b`).test(browser)) {
    fail(`Browser SSOT missing required export: ${name}`);
  }
  if (!new RegExp(`export\\s+(const|function|type)\\s+${name}\\b`).test(deno)) {
    fail(`Deno SSOT missing required export: ${name}`);
  }
}

if (FAILS.length > 0) {
  console.error("Batch 24 operating-rules parity guard FAILED:\n - " + FAILS.join("\n - "));
  process.exit(1);
}
console.log("Batch 24 operating-rules parity guard OK.");
