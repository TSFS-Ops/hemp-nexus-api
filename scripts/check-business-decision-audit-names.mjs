#!/usr/bin/env node
/**
 * Batch 1 — Verifies parity of business decision category, status enum,
 * and audit event names between the TS SSOT (src/lib/business-decisions.ts)
 * and the Deno mirror (supabase/functions/_shared/business-decisions.ts).
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/business-decisions.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/business-decisions.ts", "utf8");

function extractArray(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const checks = [
  "BUSINESS_DECISION_CATEGORIES",
  "BUSINESS_DECISION_STATUSES",
  "BUSINESS_DECISION_AUDIT_EVENT_NAMES",
];

let failed = false;
for (const name of checks) {
  const a = extractArray(ts, name);
  const b = extractArray(deno, name);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`✗ ${name} drift between TS and Deno SSOT`);
    console.error("  TS:  ", a);
    console.error("  Deno:", b);
    failed = true;
  }
}

// Ensure the writer edge function references each canonical audit name.
const edge = readFileSync("supabase/functions/business-decision-record/index.ts", "utf8");
for (const name of ["business_decision_recorded", "business_decision_status_changed", "business_decision_superseded"]) {
  if (!edge.includes(`"${name}"`)) {
    console.error(`✗ business-decision-record/index.ts does not reference audit name "${name}"`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ business-decision audit name + enum parity OK");
