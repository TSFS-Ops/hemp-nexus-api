#!/usr/bin/env node
/**
 * Batch 5 — Pins canonical scopes, result states, audit event names,
 * environments, client statuses, and key statuses between the browser
 * SSOT and the Deno mirror.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-institutional-api.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-institutional-api.ts", "utf8");

function extractArray(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const checks = [
  "REGISTRY_API_ENVIRONMENTS",
  "REGISTRY_API_CLIENT_STATUSES",
  "REGISTRY_API_KEY_STATUSES",
  "REGISTRY_API_SCOPES",
  "REGISTRY_API_RESULT_STATES",
  "REGISTRY_API_AUDIT_EVENT_NAMES",
  "REGISTRY_API_PAYMENT_STATUS_FLAGS",
  "REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS",
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
console.log("✓ registry-institutional-api TS ↔ Deno parity OK");
