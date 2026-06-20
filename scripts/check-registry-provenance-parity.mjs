#!/usr/bin/env node
/**
 * Batch 2 — Verifies parity of registry provenance enums + audit event names
 * between the TS SSOT and the Deno mirror.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-provenance.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-provenance.ts", "utf8");

function extractArray(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const checks = [
  "REGISTRY_SOURCE_TYPES",
  "REGISTRY_LICENCE_STATUSES",
  "REGISTRY_CONFIDENCE_BANDS",
  "REGISTRY_VERIFICATION_LEVELS",
  "REGISTRY_PROVENANCE_AUDIT_EVENT_NAMES",
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

const edge = readFileSync("supabase/functions/registry-provenance-record/index.ts", "utf8");
for (const name of [
  "registry_source_recorded",
  "registry_source_updated",
  "registry_source_licence_recorded",
  "registry_field_provenance_recorded",
]) {
  if (!edge.includes(`"${name}"`)) {
    console.error(`✗ registry-provenance-record/index.ts does not reference audit name "${name}"`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ registry-provenance TS ↔ Deno parity OK");
