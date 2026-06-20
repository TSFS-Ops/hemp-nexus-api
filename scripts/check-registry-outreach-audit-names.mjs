#!/usr/bin/env node
/**
 * Batch 6 — every audit name in REGISTRY_OUTREACH_AUDIT_EVENT_NAMES must be
 * emitted by at least one Batch 6 edge function.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-outreach.ts", "utf8");
const m = ts.match(/REGISTRY_OUTREACH_AUDIT_EVENT_NAMES\s*=\s*\[([\s\S]*?)\]/);
const names = (m?.[1] ?? "").match(/"([a-z_]+)"/g)?.map(s => s.replace(/"/g, "")) ?? [];

const files = [
  "supabase/functions/registry-ai-outreach-draft/index.ts",
  "supabase/functions/registry-outreach-review/index.ts",
  "supabase/functions/registry-outreach-log-send/index.ts",
  "supabase/functions/registry-admin-operations-summary/index.ts",
  "supabase/functions/registry-client-readiness-summary/index.ts",
].map(f => readFileSync(f, "utf8")).join("\n");

let failed = false;
for (const n of names) {
  if (!files.includes(n)) {
    console.error(`✗ audit event name "${n}" is declared in SSOT but never emitted by a Batch 6 edge function`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`✓ Batch 6 outreach audit-name coverage passed (${names.length} names)`);
