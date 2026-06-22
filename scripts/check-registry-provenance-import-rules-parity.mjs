#!/usr/bin/env node
/**
 * Batch 25 — Guard: browser SSOT and Deno SSOT for the registry
 * provenance/country/import/duplicate rules MUST stay byte-identical
 * except for their "(browser)" / "(Deno mirror)" marker. Fails the
 * build on any drift so the gates, states, thresholds and wording
 * cannot silently diverge between the React app and edge functions.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const BROWSER = "src/lib/registry-provenance-import-rules.ts";
const DENO = "supabase/functions/_shared/registry-provenance-import-rules.ts";

const FAILS = [];
const fail = (m) => FAILS.push(m);

if (!existsSync(BROWSER)) fail(`Missing browser SSOT at ${BROWSER}`);
if (!existsSync(DENO)) fail(`Missing Deno SSOT at ${DENO}`);
if (FAILS.length > 0) {
  console.error("Batch 25 provenance-import parity guard FAILED:\n - " + FAILS.join("\n - "));
  process.exit(1);
}

function normalise(src) {
  return src
    .replace(
      /Batch 25 — Provenance \/ Country \/ Import \/ Duplicate SSOT \((browser|Deno mirror)\)\./,
      "Batch 25 — Provenance / Country / Import / Duplicate SSOT.",
    )
    .replace(/\r\n/g, "\n")
    .trimEnd();
}

const browser = normalise(readFileSync(BROWSER, "utf8"));
const deno = normalise(readFileSync(DENO, "utf8"));

const bHash = createHash("sha256").update(browser).digest("hex");
const dHash = createHash("sha256").update(deno).digest("hex");

if (bHash !== dHash) {
  fail(
    `SSOT drift detected.\n   browser sha256=${bHash}\n   deno    sha256=${dHash}\n   Re-copy: cp ${BROWSER} ${DENO} and re-add the "(Deno mirror)" marker.`,
  );
}

const REQUIRED_EXPORTS = [
  "REGISTRY_SOURCE_TYPES",
  "REGISTRY_SOURCE_REQUIRED_FIELDS",
  "REGISTRY_SOURCED_ONLY_SOURCE_TYPES",
  "REGISTRY_LICENSED_DATASET_WORDING",
  "REGISTRY_FIELD_VERIFICATION_METHODS",
  "REGISTRY_FIELD_PROVENANCE_METADATA",
  "REGISTRY_FIELD_PROVENANCE_REQUIRED",
  "REGISTRY_FIELD_USAGE_FLAGS",
  "REGISTRY_MANUAL_REVIEW_FIELD_GROUPS",
  "REGISTRY_PUBLIC_CORE_FIELDS",
  "REGISTRY_SOURCE_PRIORITY_ORDER",
  "REGISTRY_CONFLICT_PUBLIC_WORDING",
  "REGISTRY_CONFLICT_API_STATUS",
  "REGISTRY_COUNTRY_CAPABILITIES",
  "REGISTRY_COUNTRY_WORKFLOW_STATES",
  "REGISTRY_SEARCHABLE_COUNTRY_MINIMUM_ITEMS",
  "REGISTRY_RECOMMENDED_DISPLAY_FIELDS",
  "REGISTRY_PROVENANCE_READINESS_LABELS",
  "REGISTRY_PRE_IMPORT_CHECKLIST",
  "REGISTRY_PRODUCTION_IMPORT_EXTRA_ITEMS",
  "REGISTRY_IMPORT_REQUIRED_FIELDS",
  "REGISTRY_IMPORT_QUARANTINE_IF_MISSING_FIELDS",
  "REGISTRY_IMPORT_OPTIONAL_FIELDS",
  "REGISTRY_IMPORT_EXCLUDED_FIELDS",
  "REGISTRY_IMPORT_QUARANTINE_REASON_CODES",
  "REGISTRY_BATCH_SYSTEMIC_FAILURE_REASONS",
  "REGISTRY_BATCH_CRITICAL_FIELD_FAILURE_THRESHOLD_RATIO",
  "REGISTRY_DUPLICATE_THRESHOLDS",
  "REGISTRY_DUPLICATE_MERGE_RISK_TRIGGERS",
  "REGISTRY_DUPLICATE_MERGE_AUDIT_REQUIREMENTS",
  "REGISTRY_PROVENANCE_IMPORT_AUDIT_NAMES",
  "REGISTRY_PROVENANCE_IMPORT_RULES_PARITY_FINGERPRINT",
  "missingSourceDescriptorField",
  "isLicensedDatasetVerified",
  "missingFieldProvenance",
  "isFieldPublicAllowed",
  "isPublicCoreFieldAllowed",
  "compareSourcePriority",
  "resolveSourceConflict",
  "isCountryCapabilityReady",
  "missingSearchableMinimum",
  "missingPreImportChecklistItem",
  "validateImportRow",
  "evaluateBatchOutcome",
  "classifyDuplicate",
  "classifyMergeRisk",
  "evaluateDuplicateMerge",
];
for (const name of REQUIRED_EXPORTS) {
  const re = new RegExp(`export\\s+(const|function|type)\\s+${name}\\b`);
  if (!re.test(browser)) fail(`Browser SSOT missing required export: ${name}`);
  if (!re.test(deno)) fail(`Deno SSOT missing required export: ${name}`);
}

if (FAILS.length > 0) {
  console.error("Batch 25 provenance-import parity guard FAILED:\n - " + FAILS.join("\n - "));
  process.exit(1);
}
console.log("Batch 25 provenance-import parity guard OK.");
