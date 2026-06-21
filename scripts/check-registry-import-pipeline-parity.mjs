#!/usr/bin/env node
// Batch 9 — pin the Deno + browser SSOT for the import pipeline.
// Compares the exported arrays so neither side can drift silently.
import fs from "node:fs";

const a = fs.readFileSync("supabase/functions/_shared/registry-import-pipeline.ts", "utf8");
const b = fs.readFileSync("src/lib/registry-import-pipeline.ts", "utf8");

const ARRAYS = [
  "SOURCE_FILE_TYPES",
  "TARGET_FIELDS",
  "FIELD_VISIBILITY_TIERS",
  "FORBIDDEN_PUBLIC_TARGET_FIELDS",
  "VALIDATION_OUTCOMES",
  "DUPLICATE_CONFIDENCE_LEVELS",
  "QUARANTINE_REASON_CODES",
  "IMPORT_PIPELINE_AUDIT_EVENT_NAMES",
  "FORBIDDEN_IMPORT_RECORD_WORDING",
];

function extract(name, src) {
  const re = new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`array ${name} not found`);
  return m[1]
    .split(",")
    .map(s => s.replace(/\/\/.*$/g, "").trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .sort();
}

let failed = false;
for (const name of ARRAYS) {
  const da = extract(name, a);
  const db = extract(name, b);
  if (JSON.stringify(da) !== JSON.stringify(db)) {
    console.error(`Drift in ${name}:`);
    console.error("  Deno:", da);
    console.error("  Web :", db);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`registry-import-pipeline-parity OK (${ARRAYS.length} arrays)`);
