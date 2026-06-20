#!/usr/bin/env node
/**
 * Batch 3 — Verifies parity of claim states + audit event names + search labels
 * between the TS SSOT and the Deno mirror.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-claims.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-claims.ts", "utf8");

function extractArray(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const checks = [
  "REGISTRY_CLAIM_STATES",
  "REGISTRY_CLAIM_AUDIT_EVENT_NAMES",
  "REGISTRY_SEARCH_RESULT_LABELS",
];
let failed = false;
for (const name of checks) {
  const a = extractArray(ts, name);
  const b = extractArray(deno, name);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`✗ ${name} drift between TS and Deno SSOT`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ registry-claims TS ↔ Deno parity OK");
