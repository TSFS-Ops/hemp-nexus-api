#!/usr/bin/env node
/**
 * Batch 12 — Authority notification log-only guard.
 * The Batch 12 authority notification edge function must never call email/sms/whatsapp providers.
 */
import { readFileSync, existsSync } from "node:fs";
const target = "supabase/functions/registry-authority-notification-log/index.ts";
if (!existsSync(target)) {
  console.error(`✗ missing ${target}`);
  process.exit(1);
}
const src = readFileSync(target, "utf8");
const BAD = [/resend\./i, /sendgrid/i, /twilio/i, /whatsapp/i, /mailgun/i, /\bfetch\(.*api\.resend/i];
const hits = BAD.filter((r) => r.test(src));
if (hits.length) {
  console.error(`✗ batch-12 authority notifier must be log-only, found provider refs: ${hits}`);
  process.exit(1);
}
if (!/sent_externally:\s*false/.test(src)) {
  console.error(`✗ batch-12 authority notifier must persist sent_externally:false`);
  process.exit(1);
}
console.log("✓ batch-12 authority notifier is log-only");
