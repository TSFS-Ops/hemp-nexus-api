#!/usr/bin/env node
/**
 * Batch 6 — no provider integration AND no real registry data ingestion in
 * the Batch 6 surfaces. Mirrors the Batch 4/5 guards but scoped to the
 * Batch 6 file set.
 */
import { readFileSync } from "node:fs";

const FORBIDDEN = [
  "cipc", "onfido", "globaldatabase", "b2bhint",
  "dow jones", "dowjones", "refinitiv",
  "payfast", "stripe.com/v1/charges",
  // External dispatchers (no-auto-send guard also covers these but we
  // include them here for the Batch 6 scope as well)
  "resend.com", "sendgrid", "twilio.com", "postmark", "mailgun",
];

const FILES = [
  "supabase/functions/registry-ai-outreach-draft/index.ts",
  "supabase/functions/registry-outreach-review/index.ts",
  "supabase/functions/registry-outreach-log-send/index.ts",
  "supabase/functions/registry-admin-operations-summary/index.ts",
  "supabase/functions/registry-client-readiness-summary/index.ts",
  "src/pages/admin/registry/Operations.tsx",
  "src/pages/admin/registry/OutreachDrafts.tsx",
  "src/pages/admin/registry/OutreachApprovals.tsx",
  "src/pages/admin/registry/DoNotContact.tsx",
  "src/pages/registry/Readiness.tsx",
];

let failed = false;
for (const f of FILES) {
  const src = readFileSync(f, "utf8").toLowerCase();
  for (const w of FORBIDDEN) {
    if (src.includes(w)) {
      console.error(`✗ ${f}: forbidden provider/dispatcher reference "${w}"`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("✓ Batch 6 no-provider / no-ingestion guard passed");
