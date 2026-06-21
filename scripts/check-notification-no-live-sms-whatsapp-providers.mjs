#!/usr/bin/env node
/**
 * Phase 1 — No live SMS/WhatsApp provider integrations.
 *
 * Scans Phase 1 edge functions + SSOT libs to ensure no live provider SDK,
 * URL, or credential identifier is referenced.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "twilio", "messagebird", "vonage", "nexmo", "plivo", "africastalking",
  "clickatell", "infobip", "whatsapp-business", "whatsapp-cloud", "wa.me/api",
  "graph.facebook.com/v", "graph.facebook.com/whatsapp",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "WHATSAPP_API_TOKEN", "WHATSAPP_BUSINESS",
];

const TARGETS = [
  "src/lib/notification-channel-readiness.ts",
  "src/pages/admin/notifications/ChannelReadiness.tsx",
  "supabase/functions/_shared/notification-channel-readiness.ts",
  "supabase/functions/notification-channel-readiness-list/index.ts",
  "supabase/functions/notification-channel-readiness-update/index.ts",
  "supabase/functions/notification-channel-skip-record/index.ts",
  "supabase/functions/manual-outreach-contact-log/index.ts",
];

let failed = false;
for (const f of TARGETS) {
  const src = readFileSync(f, "utf8").toLowerCase();
  for (const tok of FORBIDDEN) {
    if (src.includes(tok.toLowerCase())) {
      console.error(`✗ ${f}: forbidden Phase 1 provider token "${tok}"`);
      failed = true;
    }
  }
  // Phase 1 must NEVER state SMS/WhatsApp was sent or delivered
  if (/(sms|whatsapp)[^a-z0-9]+(sent|delivered)\s+to/i.test(src)) {
    console.error(`✗ ${f}: Phase 1 must not assert SMS/WhatsApp was sent or delivered`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ No live SMS/WhatsApp provider integration references in Phase 1");
