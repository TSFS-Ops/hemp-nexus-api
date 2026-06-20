#!/usr/bin/env node
/**
 * Batch 6 — Outreach approval state SSOT is enforced by parity guard
 * (check-registry-outreach-draft-state-parity.mjs) and the database CHECK
 * constraint. This guard additionally enforces that every approval state
 * referenced by the review edge function appears in the SSOT.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-outreach.ts", "utf8");
const review = readFileSync("supabase/functions/registry-outreach-review/index.ts", "utf8");

const ssotMatch = ts.match(/REGISTRY_OUTREACH_APPROVAL_STATES\s*=\s*\[([\s\S]*?)\]/);
const ssot = (ssotMatch?.[1] ?? "").match(/"([a-z_]+)"/g)?.map(s => s.replace(/"/g, "")) ?? [];

const REFERENCED = ["queued", "in_review", "approved", "changes_requested", "rejected", "cancelled"];
let failed = false;
for (const r of REFERENCED) {
  if (!ssot.includes(r)) { console.error(`✗ approval state "${r}" referenced by review function missing from SSOT`); failed = true; }
  if (!review.includes(`"${r}"`)) { console.error(`✗ approval state "${r}" missing from registry-outreach-review handler`); failed = true; }
}
if (failed) process.exit(1);
console.log(`✓ Batch 6 outreach approval state parity passed`);
