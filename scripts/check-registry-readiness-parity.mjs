#!/usr/bin/env node
/**
 * Batch 1 — Verifies parity of readiness state enum + audit event names
 * between the TS SSOT (src/lib/registry-readiness.ts) and the Deno mirror
 * (supabase/functions/_shared/registry-readiness.ts).
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-readiness.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-readiness.ts", "utf8");

function extractArray(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const checks = [
  "REGISTRY_READINESS_STATES",
  "REGISTRY_READINESS_AUDIT_EVENT_NAMES",
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

if (failed) process.exit(1);
console.log("✓ registry-readiness TS ↔ Deno parity OK");
