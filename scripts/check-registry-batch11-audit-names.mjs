#!/usr/bin/env node
/**
 * Batch 11 — Audit-name coverage.
 *
 * Every name in REGISTRY_CLAIM_WORKFLOW_AUDIT_EVENT_NAMES must appear at
 * least once across the new batch-11 edge functions OR the existing
 * registry-company-claim function. This prevents silent removal of an audit
 * event when a function is refactored.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ssot = readFileSync("src/lib/registry-claim-workflow.ts", "utf8");
const m = ssot.match(/REGISTRY_CLAIM_WORKFLOW_AUDIT_EVENT_NAMES = \[([\s\S]*?)\] as const;/);
if (!m) { console.error("✗ cannot read audit name SSOT"); process.exit(1); }
const names = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);

const dirs = [
  "supabase/functions/registry-claim-start",
  "supabase/functions/registry-claim-submit",
  "supabase/functions/registry-claim-evidence-upload",
  "supabase/functions/registry-claim-status",
  "supabase/functions/registry-claim-review",
  "supabase/functions/registry-claim-conflict-resolve",
  "supabase/functions/registry-claim-notification-log",
  "supabase/functions/registry-company-claim",
];
const blob = dirs
  .flatMap((d) => { try { return readdirSync(d).map((f) => join(d, f)); } catch { return []; } })
  .map((p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } })
  .join("\n");

let failed = false;
for (const n of names) {
  if (!blob.includes(`"${n}"`)) {
    console.error(`✗ batch-11 audit name not emitted: ${n}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("✓ batch-11 claim audit names emitted");
