#!/usr/bin/env node
/**
 * Batch 5 — Hard guarantee: the four Batch 5 edge functions must not pull
 * in any external provider, AI outreach, or live verification dependency.
 */
import { readFileSync } from "node:fs";

const FILES = [
  "supabase/functions/registry-institutional-profile-status/index.ts",
  "supabase/functions/registry-institutional-payment-status/index.ts",
  "supabase/functions/registry-api-client-manage/index.ts",
  "supabase/functions/registry-api-usage-log/index.ts",
];

const FORBIDDEN = [
  "cipc", "onfido", "globaldatabase", "b2bhint",
  "dow jones", "dowjones", "refinitiv", "payfast", "paystack",
  "openai", "anthropic", "lovable_ai", "gemini",
  "outreach", "send-email", "send_email", "resend",
];

let failed = false;
for (const f of FILES) {
  const src = readFileSync(f, "utf8").toLowerCase();
  for (const tok of FORBIDDEN) {
    if (src.includes(tok)) {
      console.error(`✗ forbidden Batch 5 dependency "${tok}" found in ${f}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("✓ registry batch 5 no-provider / no-AI guard OK");
