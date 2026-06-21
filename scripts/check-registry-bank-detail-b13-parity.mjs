#!/usr/bin/env node
/**
 * Batch 13 — TS ↔ Deno parity guard for the bank-detail submission & review SSOT.
 *
 * Pins parity of:
 *   - REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES
 *   - REGISTRY_BANK_DETAIL_B13_EVIDENCE_CATEGORIES
 *   - REGISTRY_BANK_DETAIL_B13_EVIDENCE_STATES
 *   - REGISTRY_BANK_DETAIL_B13_CONSENT_SCOPES
 *   - REGISTRY_BANK_DETAIL_B13_AUTHORITY_SCOPES
 *   - REGISTRY_BANK_DETAIL_B13_RISK_FLAG_TYPES
 *   - REGISTRY_BANK_DETAIL_B13_RISK_LEVELS
 *   - REGISTRY_BANK_DETAIL_B13_HOLDER_KINDS
 *   - REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS
 *   - REGISTRY_BANK_DETAIL_B13_UNMASK_REASONS
 *   - REGISTRY_BANK_DETAIL_B13_PUBLIC_STATUS_LABELS
 *   - REGISTRY_BANK_DETAIL_B13_AUDIT_EVENT_NAMES
 *
 * Also asserts the mandatory consent wording, accept acknowledgement wording
 * and public acceptance notice match across browser + Deno.
 */
import { readFileSync } from "node:fs";
const ts = readFileSync("src/lib/registry-bank-details-b13.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-bank-details-b13.ts", "utf8");

function extract(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`missing ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}
function extractString(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*"([^"]+)"`, "m"));
  if (!m) throw new Error(`missing ${name}`);
  return m[1];
}

const arrayNames = [
  "REGISTRY_BANK_DETAIL_B13_SUBMISSION_STATUSES",
  "REGISTRY_BANK_DETAIL_B13_EVIDENCE_CATEGORIES",
  "REGISTRY_BANK_DETAIL_B13_EVIDENCE_STATES",
  "REGISTRY_BANK_DETAIL_B13_CONSENT_SCOPES",
  "REGISTRY_BANK_DETAIL_B13_AUTHORITY_SCOPES",
  "REGISTRY_BANK_DETAIL_B13_RISK_FLAG_TYPES",
  "REGISTRY_BANK_DETAIL_B13_RISK_LEVELS",
  "REGISTRY_BANK_DETAIL_B13_HOLDER_KINDS",
  "REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS",
  "REGISTRY_BANK_DETAIL_B13_UNMASK_REASONS",
  "REGISTRY_BANK_DETAIL_B13_PUBLIC_STATUS_LABELS",
  "REGISTRY_BANK_DETAIL_B13_AUDIT_EVENT_NAMES",
];
const stringNames = [
  "REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING",
  "REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT",
  "REGISTRY_BANK_DETAIL_B13_ACCEPT_PUBLIC_NOTICE",
];

let failed = false;
for (const n of arrayNames) {
  const a = extract(ts, n), b = extract(deno, n);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`✗ ${n} drift\n  ts:   ${JSON.stringify(a)}\n  deno: ${JSON.stringify(b)}`);
    failed = true;
  }
}
for (const n of stringNames) {
  const a = extractString(ts, n), b = extractString(deno, n);
  if (a !== b) { console.error(`✗ ${n} drift`); failed = true; }
}
if (failed) process.exit(1);
console.log("✓ registry-bank-details-b13 TS ↔ Deno parity OK");
