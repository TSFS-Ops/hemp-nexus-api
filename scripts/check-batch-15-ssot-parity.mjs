#!/usr/bin/env node
/**
 * Batch 15 — Pins canonical SSOT arrays between TS browser SSOT and Deno mirror.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-api-hardening.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-api-hardening.ts", "utf8");

function extractArray(src, name) {
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`could not extract ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const checks = [
  "REGISTRY_API_MODES",
  "REGISTRY_API_CLIENT_LIFECYCLE_STATUSES",
  "REGISTRY_API_KEY_TYPES",
  "REGISTRY_API_HARDENED_SCOPES",
  "REGISTRY_API_FORBIDDEN_SCOPES",
  "REGISTRY_API_HARDENED_RESULT_STATES",
  "REGISTRY_API_RATE_LIMIT_PROFILE_KEYS",
  "REGISTRY_API_HARDENED_AUDIT_EVENT_NAMES",
  "REGISTRY_API_FORBIDDEN_RESPONSE_FIELDS",
  "REGISTRY_API_NOT_VERIFIED_BANK_STATES",
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
console.log("✓ batch-15 SSOT parity OK");
