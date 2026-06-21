#!/usr/bin/env node
/**
 * Batch 11 — Ensures no edge function in the batch-11 set performs auto outreach
 * or marks bank/authority/profile/api as verified on claim approval.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dirs = [
  "supabase/functions/registry-claim-start",
  "supabase/functions/registry-claim-submit",
  "supabase/functions/registry-claim-evidence-upload",
  "supabase/functions/registry-claim-status",
  "supabase/functions/registry-claim-review",
  "supabase/functions/registry-claim-conflict-resolve",
  "supabase/functions/registry-claim-notification-log",
];

const FORBIDDEN_PATTERNS = [
  /resend/i,
  /sendgrid/i,
  /twilio/i,
  /whatsapp/i,
  /sms/i,
  /authority_status\s*=\s*['"]approved/i,
  /bank_detail_status\s*=\s*['"]verified/i,
  /profile_verified\s*=\s*true/i,
  /api_output_allowed\s*=\s*true/i,
];

let failed = false;
for (const d of dirs) {
  let files = [];
  try { files = readdirSync(d).map((f) => join(d, f)); } catch { continue; }
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(src)) {
        console.error(`✗ ${f} contains forbidden pattern ${re}`);
        failed = true;
      }
    }
  }
}
if (failed) process.exit(1);
console.log("✓ batch-11 no-auto-send / no-side-effect guard OK");
