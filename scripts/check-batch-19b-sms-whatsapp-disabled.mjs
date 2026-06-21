#!/usr/bin/env node
/** Batch 19B — SMS/WhatsApp Phase 1 disabled wording guard.
 *  The SSOT must declare both disabled and provide the user-facing copy. */
import fs from "node:fs";

const SSOT = "src/lib/registry-client-decisions-19b.ts";
const src = fs.readFileSync(SSOT, "utf8");
const must = [
  /sms:\s*"disabled_in_phase_1"/,
  /whatsapp:\s*"disabled_in_phase_1"/,
  /BATCH_19B_SMS_DISABLED_COPY[\s\S]{0,80}disabled in Phase 1/i,
  /BATCH_19B_WHATSAPP_DISABLED_COPY[\s\S]{0,80}disabled in Phase 1/i,
  /BATCH_19B_DO_NOT_CONTACT_SUPPRESSION_COPY[\s\S]{0,160}suppressed/i,
];
let bad = 0;
for (const re of must) {
  if (!re.test(src)) {
    console.error(`[batch-19b] missing Phase 1 disabled wording: ${re}`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log("[batch-19b] SMS/WhatsApp Phase 1 disabled guard ok");
