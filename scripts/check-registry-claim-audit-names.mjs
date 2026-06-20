#!/usr/bin/env node
/**
 * Batch 3 — Pins audit event names emitted by registry claim edge functions.
 * Every name in REGISTRY_CLAIM_AUDIT_EVENT_NAMES must be referenced by at
 * least one edge function index.ts in supabase/functions/registry-company-*.
 */
import { readFileSync, readdirSync } from "node:fs";

const ts = readFileSync("src/lib/registry-claims.ts", "utf8");
const m = ts.match(/REGISTRY_CLAIM_AUDIT_EVENT_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const;/);
if (!m) { console.error("could not extract REGISTRY_CLAIM_AUDIT_EVENT_NAMES"); process.exit(1); }
const names = Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);

const dirs = readdirSync("supabase/functions").filter((d) => d.startsWith("registry-company-"));
const sources = dirs.map((d) => readFileSync(`supabase/functions/${d}/index.ts`, "utf8")).join("\n");

let failed = false;
for (const n of names) {
  if (!sources.includes(`"${n}"`)) {
    console.error(`✗ audit name "${n}" is not emitted by any registry-company-* edge function`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ registry-claim audit-name coverage OK");
