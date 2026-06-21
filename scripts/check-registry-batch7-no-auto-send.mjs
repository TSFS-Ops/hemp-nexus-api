#!/usr/bin/env node
// Batch 7 — Reaffirm no auto-send path for SMS/WhatsApp/email outreach in the
// new functions delivered by this batch. The outreach drafter/review gate
// remains the only writer surface; new functions in this batch must NOT call
// any provider SDK or webhook.
import { readFileSync } from "node:fs";

const FILES = [
  "supabase/functions/registry-new-company-request/index.ts",
  "supabase/functions/registry-company-correction-request/index.ts",
];

const BANNED = [
  /twilio/i, /messagebird/i, /vonage/i, /infobip/i, /clickatell/i,
  /sendgrid/i, /mailgun/i, /postmark/i,
  /\bsms\b\s*(?:send|dispatch)/i,
  /\bwhatsapp\b\s*(?:send|dispatch)/i,
  /fetch\s*\(\s*['"]https?:\/\/(?:api\.)?(?:twilio|messagebird|sendgrid|mailgun)/i,
];

let failed = false;
for (const f of FILES) {
  const src = readFileSync(f, "utf8");
  for (const re of BANNED) {
    if (re.test(src)) {
      console.error(`[batch7-no-auto-send] ${f} matched ${re}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log("[batch7-no-auto-send] OK");
