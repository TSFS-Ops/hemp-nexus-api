#!/usr/bin/env node
/**
 * Batch 2 — Asserts every Batch 2 audit event name declared in the SSOTs is
 * referenced by exactly one writer edge function.
 */
import { readFileSync } from "node:fs";

const PROV = readFileSync("src/lib/registry-provenance.ts", "utf8");
const COV  = readFileSync("src/lib/registry-country-coverage.ts", "utf8");
const IMP  = readFileSync("src/lib/registry-import-batches.ts", "utf8");

function names(src, key) {
  const m = src.match(new RegExp(`export const ${key}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  return Array.from((m?.[1] ?? "").matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const expected = [
  ...names(PROV, "REGISTRY_PROVENANCE_AUDIT_EVENT_NAMES").map((n) => [n, "supabase/functions/registry-provenance-record/index.ts"]),
  ...names(COV, "COUNTRY_COVERAGE_AUDIT_EVENT_NAMES").map((n) => [n, "supabase/functions/registry-country-coverage-update/index.ts"]),
  ...names(IMP, "IMPORT_BATCH_AUDIT_EVENT_NAMES").map((n) => [n, "supabase/functions/registry-import-batch-manage/index.ts"]),
];

let failed = false;
for (const [name, file] of expected) {
  const src = readFileSync(file, "utf8");
  if (!src.includes(`"${name}"`)) {
    console.error(`✗ ${file} does not emit canonical audit name "${name}"`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`✓ Batch 2 audit-name coverage OK (${expected.length} names)`);
