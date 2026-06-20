#!/usr/bin/env node
/**
 * Batch 6 — There must be NO automatic send path. Verifies that:
 *   - No Batch 6 edge function references an external email/SMS/WhatsApp
 *     dispatch SDK (resend, sendgrid, twilio, postmark, mailgun, mailchimp,
 *     ses, plivo, vonage, messagebird).
 *   - The mandatory no-auto-send copy appears in the SSOT and in the
 *     review/send-log functions and in admin outreach UI surfaces.
 */
import { readFileSync } from "node:fs";

const FORBIDDEN_DISPATCHERS = [
  "resend.com", "sendgrid", "twilio", "postmark", "mailgun", "mailchimp",
  "ses-smtp", "@aws-sdk/client-ses", "plivo", "vonage", "messagebird",
];

const TARGETS = [
  "supabase/functions/registry-ai-outreach-draft/index.ts",
  "supabase/functions/registry-outreach-review/index.ts",
  "supabase/functions/registry-outreach-log-send/index.ts",
  "supabase/functions/registry-admin-operations-summary/index.ts",
  "supabase/functions/registry-client-readiness-summary/index.ts",
];

let failed = false;
for (const f of TARGETS) {
  const src = readFileSync(f, "utf8");
  for (const dispatcher of FORBIDDEN_DISPATCHERS) {
    if (src.toLowerCase().includes(dispatcher)) {
      console.error(`✗ ${f}: forbidden external dispatcher reference "${dispatcher}"`);
      failed = true;
    }
  }
}

// Mandatory copy presence
const COPY = "AI may draft outreach, but it must not send outreach automatically";
for (const f of [
  "src/lib/registry-outreach.ts",
  "supabase/functions/_shared/registry-outreach.ts",
  "supabase/functions/registry-outreach-review/index.ts",
  "supabase/functions/registry-outreach-log-send/index.ts",
  "supabase/functions/registry-admin-operations-summary/index.ts",
  "src/pages/admin/registry/OutreachDrafts.tsx",
  "src/pages/admin/registry/OutreachApprovals.tsx",
  "src/pages/admin/registry/Operations.tsx",
]) {
  const src = readFileSync(f, "utf8");
  if (!src.includes(COPY) && !src.includes("REGISTRY_OUTREACH_NO_AUTO_SEND_COPY")) {
    console.error(`✗ ${f}: mandatory no-auto-send copy missing`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ Batch 6 no-auto-send guard passed");
