#!/usr/bin/env node
/**
 * Batch 6 — Do-not-contact enforcement parity. Verifies that:
 *   1. The DNC table is consulted by both the draft generator and the
 *      approval writer.
 *   2. The dnc audit event name is emitted somewhere in the review
 *      function (mark_do_not_contact / suppress paths).
 */
import { readFileSync } from "node:fs";

const draft = readFileSync("supabase/functions/registry-ai-outreach-draft/index.ts", "utf8");
const review = readFileSync("supabase/functions/registry-outreach-review/index.ts", "utf8");
const sendLog = readFileSync("supabase/functions/registry-outreach-log-send/index.ts", "utf8");

let failed = false;
for (const [name, src] of [
  ["registry-ai-outreach-draft", draft],
  ["registry-outreach-review", review],
  ["registry-outreach-log-send", sendLog],
]) {
  if (!src.includes("registry_outreach_do_not_contact")) {
    console.error(`✗ ${name}: does not consult DNC list`);
    failed = true;
  }
}
if (!review.includes("registry_outreach_do_not_contact_added")) {
  console.error("✗ registry-outreach-review: missing audit name registry_outreach_do_not_contact_added");
  failed = true;
}
if (!review.includes("registry_outreach_suppressed")) {
  console.error("✗ registry-outreach-review: missing audit name registry_outreach_suppressed");
  failed = true;
}
if (failed) process.exit(1);
console.log("✓ Batch 6 DNC enforcement parity passed");
