#!/usr/bin/env node
/**
 * Batch 2 — Verifies parity of country coverage states + audit event names
 * between the TS SSOT and the Deno mirror.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-country-coverage.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-country-coverage.ts", "utf8");

function extractArray(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const checks = ["COUNTRY_COVERAGE_STATES", "COUNTRY_COVERAGE_AUDIT_EVENT_NAMES"];
let failed = false;
for (const name of checks) {
  const a = extractArray(ts, name);
  const b = extractArray(deno, name);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`✗ ${name} drift between TS and Deno SSOT`);
    failed = true;
  }
}

const edge = readFileSync("supabase/functions/registry-country-coverage-update/index.ts", "utf8");
for (const name of [
  "registry_country_coverage_state_changed",
  "registry_country_coverage_wording_changed",
]) {
  if (!edge.includes(`"${name}"`)) {
    console.error(`✗ registry-country-coverage-update does not reference audit name "${name}"`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ registry-country-coverage TS ↔ Deno parity OK");
