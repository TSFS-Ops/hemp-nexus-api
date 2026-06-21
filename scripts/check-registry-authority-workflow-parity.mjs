#!/usr/bin/env node
/**
 * Batch 12 — TS ↔ Deno parity for authority workflow SSOT.
 */
import { readFileSync } from "node:fs";
const ts = readFileSync("src/lib/registry-authority-workflow.ts", "utf8");
const deno = readFileSync(
  "supabase/functions/_shared/registry-authority-workflow.ts",
  "utf8",
);

function extractArray(src, name) {
  const m = src.match(
    new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"),
  );
  if (!m) throw new Error(`missing ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}
function extractString(src, name) {
  const m = src.match(
    new RegExp(`export const ${name}\\s*=\\s*"([^"]+)"`, "m"),
  );
  if (!m) throw new Error(`missing ${name}`);
  return m[1];
}

const arrays = [
  "REGISTRY_AUTHORITY_B12_STATES",
  "REGISTRY_AUTHORITY_SCOPES",
  "REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES",
  "REGISTRY_AUTHORITY_EVIDENCE_STATES",
  "REGISTRY_AUTHORITY_SCOPE_DECISION_STATES",
  "REGISTRY_AUTHORITY_REVIEW_ACTIONS",
  "REGISTRY_AUTHORITY_ACTIVE_CHECK_RESULTS",
  "REGISTRY_AUTHORITY_DISPUTE_OUTCOMES",
  "REGISTRY_AUTHORITY_B12_AUDIT_EVENT_NAMES",
];
const strings = [
  "REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT",
  "REGISTRY_AUTHORITY_B12_PUBLIC_APPROVAL_NOTICE",
  "REGISTRY_AUTHORITY_B12_PUBLIC_REJECTION_NOTICE",
  "REGISTRY_AUTHORITY_B12_PUBLIC_NEXT_STEP_BANK",
];

let failed = false;
for (const n of arrays) {
  const a = extractArray(ts, n);
  const b = extractArray(deno, n);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`✗ ${n} drift`);
    failed = true;
  }
}
for (const n of strings) {
  if (extractString(ts, n) !== extractString(deno, n)) {
    console.error(`✗ ${n} copy drift`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("✓ registry-authority-workflow TS ↔ Deno parity OK");
