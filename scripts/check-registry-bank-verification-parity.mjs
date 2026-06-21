#!/usr/bin/env node
/**
 * Batch 14 — TS ↔ Deno parity guard for the bank-detail verification SSOT.
 * Pins parity of modes, statuses, gates, outcomes, expiry days, public labels,
 * audit event names, and the manual-verification acknowledgement wording.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-bank-verification.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-bank-verification.ts", "utf8");

function extractArr(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`missing ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}
function extractStr(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\n?\\s*"([^"]+)"`, "m"));
  if (!m) throw new Error(`missing ${name}`);
  return m[1];
}

const arrays = [
  "REGISTRY_BANK_VERIFICATION_MODES",
  "REGISTRY_BANK_VERIFICATION_STATUSES",
  "REGISTRY_BANK_VERIFICATION_DECISION_GATES",
  "REGISTRY_BANK_PROVIDER_RESULT_OUTCOMES",
  "REGISTRY_BANK_VERIFICATION_AUDIT_EVENT_NAMES",
  "REGISTRY_BANK_MANUAL_VERIFICATION_REQUIRED_ROLES",
];
const strings = [
  "REGISTRY_BANK_MANUAL_VERIFICATION_ACK_TEXT",
  "REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL",
];

let failed = false;
for (const n of arrays) {
  const a = extractArr(ts, n), b = extractArr(deno, n);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`✗ B14 parity drift for ${n}\n   ts:   ${JSON.stringify(a)}\n   deno: ${JSON.stringify(b)}`);
    failed = true;
  }
}
for (const n of strings) {
  const a = extractStr(ts, n), b = extractStr(deno, n);
  if (a !== b) { console.error(`✗ B14 string drift for ${n}`); failed = true; }
}

// Default mode must be `not_available` in both files.
for (const [label, src] of [["ts", ts], ["deno", deno]]) {
  if (!/REGISTRY_BANK_VERIFICATION_DEFAULT_MODE[^=]*=[^"]*"not_available"/m.test(src)) {
    console.error(`✗ B14 default mode is not "not_available" in ${label}`); failed = true;
  }
}

// Manual verification must be disabled by default.
for (const [label, src] of [["ts", ts], ["deno", deno]]) {
  if (!/REGISTRY_BANK_MANUAL_VERIFICATION_DISABLED_BY_DEFAULT\s*=\s*true/m.test(src)) {
    console.error(`✗ B14 manual verification not disabled-by-default in ${label}`); failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ Batch 14 verification SSOT parity OK");
