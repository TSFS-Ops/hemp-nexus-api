#!/usr/bin/env node
/**
 * Phase 1 — Manual outreach safe-label drift guard.
 *
 * The canonical label "Izenzo logged manual contact outside the platform.
 * This is not a system-sent message." MUST appear in every Phase 1 surface
 * that renders or writes manual-outreach state. No surface may claim that
 * manual SMS/WhatsApp contact was system-sent or provider-delivered.
 */
import { readFileSync } from "node:fs";

const LABEL = "Izenzo logged manual contact outside the platform. This is not a system-sent message.";

const REQUIRED = [
  "src/lib/notification-channel-readiness.ts",
  "supabase/functions/_shared/notification-channel-readiness.ts",
  "supabase/functions/manual-outreach-contact-log/index.ts",
];

const FORBIDDEN_PHRASES = [
  "sms was sent",
  "whatsapp was sent",
  "sms delivered",
  "whatsapp delivered",
  "provider-sent sms",
  "provider-sent whatsapp",
];

let failed = false;
for (const f of REQUIRED) {
  const src = readFileSync(f, "utf8");
  if (!src.includes(LABEL)) {
    console.error(`✗ ${f}: missing canonical manual-contact label`);
    failed = true;
  }
}
for (const f of [
  "src/pages/admin/notifications/ChannelReadiness.tsx",
  "supabase/functions/manual-outreach-contact-log/index.ts",
]) {
  const lower = readFileSync(f, "utf8").toLowerCase();
  for (const p of FORBIDDEN_PHRASES) {
    if (lower.includes(p)) {
      console.error(`✗ ${f}: forbidden phrase "${p}"`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("✓ Manual outreach safe-label and forbidden-wording guard OK");
