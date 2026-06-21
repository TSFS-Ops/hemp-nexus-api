#!/usr/bin/env node
/**
 * Batch 10 — Lifecycle SSOT parity guard.
 *
 * Pins src/lib/registry-record-lifecycle.ts ↔
 *     supabase/functions/_shared/registry-record-lifecycle.ts so they
 *     can never drift on lifecycle states, claim activation states,
 *     availability results, public reasons, public labels, transitions,
 *     identity fields, stale defaults, approval roles, audit names or
 *     the forbidden wording list.
 */
import { readFileSync } from "node:fs";

const TS = "src/lib/registry-record-lifecycle.ts";
const DENO = "supabase/functions/_shared/registry-record-lifecycle.ts";

const SYMBOLS = [
  "REGISTRY_RECORD_LIFECYCLE_STATES",
  "REGISTRY_CLAIM_ACTIVATION_STATES",
  "REGISTRY_CLAIM_AVAILABILITY_RESULTS",
  "REGISTRY_CLAIM_PUBLIC_REASONS",
  "REGISTRY_PUBLIC_LIFECYCLE_LABELS",
  "REGISTRY_INTERNAL_ONLY_LIFECYCLE_STATES",
  "REGISTRY_LIFECYCLE_TRANSITIONS",
  "REGISTRY_IDENTITY_FIELDS",
  "REGISTRY_STALE_DEFAULTS_DAYS",
  "REGISTRY_LIFECYCLE_APPROVAL_ROLES",
  "REGISTRY_LIFECYCLE_AUDIT_EVENT_NAMES",
  "REGISTRY_BATCH10_FORBIDDEN_WORDING",
  "evaluateClaimAvailability",
  "isAllowedLifecycleTransition",
  "publicLifecycleLabel",
];

const failures = [];
let tsSrc, denoSrc;
try {
  tsSrc = readFileSync(TS, "utf8");
  denoSrc = readFileSync(DENO, "utf8");
} catch (e) {
  console.error(`[batch10 parity] cannot read SSOT files: ${e.message}`);
  process.exit(1);
}

for (const sym of SYMBOLS) {
  if (!tsSrc.includes(sym)) failures.push(`missing in ${TS}: ${sym}`);
  if (!denoSrc.includes(sym)) failures.push(`missing in ${DENO}: ${sym}`);
}

// Extract the literal string members of a `const X = [...] as const` declaration.
function extractArrayLiteral(src, name) {
  const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`);
  const m = src.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const ARRAY_SSOTS = [
  "REGISTRY_RECORD_LIFECYCLE_STATES",
  "REGISTRY_CLAIM_ACTIVATION_STATES",
  "REGISTRY_CLAIM_AVAILABILITY_RESULTS",
  "REGISTRY_PUBLIC_LIFECYCLE_LABELS",
  "REGISTRY_IDENTITY_FIELDS",
  "REGISTRY_LIFECYCLE_APPROVAL_ROLES",
  "REGISTRY_LIFECYCLE_AUDIT_EVENT_NAMES",
  "REGISTRY_BATCH10_FORBIDDEN_WORDING",
];
for (const name of ARRAY_SSOTS) {
  const a = extractArrayLiteral(tsSrc, name);
  const b = extractArrayLiteral(denoSrc, name);
  if (!a || !b) {
    failures.push(`cannot extract array literal for ${name}`);
    continue;
  }
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    failures.push(`drift in ${name}: TS=${JSON.stringify(a)} DENO=${JSON.stringify(b)}`);
  }
}

if (failures.length) {
  console.error("[check-registry-record-lifecycle-parity] FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("[check-registry-record-lifecycle-parity] OK");
