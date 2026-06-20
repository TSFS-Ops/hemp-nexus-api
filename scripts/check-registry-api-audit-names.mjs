#!/usr/bin/env node
/**
 * Batch 5 — Asserts every name in REGISTRY_API_AUDIT_EVENT_NAMES is emitted
 * by at least one batch-5 registry-api-* edge function.
 */
import { readFileSync, readdirSync } from "node:fs";

const ts = readFileSync("src/lib/registry-institutional-api.ts", "utf8");
const m = ts.match(/REGISTRY_API_AUDIT_EVENT_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const;/);
if (!m) { console.error("could not extract REGISTRY_API_AUDIT_EVENT_NAMES"); process.exit(1); }
const names = Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);

const dirs = readdirSync("supabase/functions").filter(
  (d) => d.startsWith("registry-institutional-") || d.startsWith("registry-api-")
);
const sources = dirs.map((d) => readFileSync(`supabase/functions/${d}/index.ts`, "utf8")).join("\n");

let failed = false;
for (const n of names) {
  if (!sources.includes(`"${n}"`)) {
    console.error(`✗ audit name "${n}" is not emitted by any registry-institutional-* / registry-api-* edge function`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ registry-api audit-name coverage OK");
