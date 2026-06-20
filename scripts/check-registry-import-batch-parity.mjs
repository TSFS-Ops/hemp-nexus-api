#!/usr/bin/env node
/**
 * Batch 2 — Verifies parity of import batch states + audit event names
 * between the TS SSOT and the Deno mirror.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-import-batches.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-import-batches.ts", "utf8");

function extractArray(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const checks = ["IMPORT_BATCH_STATES", "IMPORT_BATCH_AUDIT_EVENT_NAMES"];
let failed = false;
for (const name of checks) {
  const a = extractArray(ts, name);
  const b = extractArray(deno, name);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`✗ ${name} drift between TS and Deno SSOT`);
    failed = true;
  }
}

const edge = readFileSync("supabase/functions/registry-import-batch-manage/index.ts", "utf8");
for (const name of [
  "registry_import_batch_created",
  "registry_import_batch_state_changed",
  "registry_import_batch_validation_recorded",
  "registry_import_batch_published",
  "registry_import_batch_rolled_back",
]) {
  if (!edge.includes(`"${name}"`)) {
    console.error(`✗ registry-import-batch-manage does not reference audit name "${name}"`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ registry-import-batch TS ↔ Deno parity OK");
