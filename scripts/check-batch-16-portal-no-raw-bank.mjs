#!/usr/bin/env node
// Batch 16 guard — no raw bank fields in company portal pages or SSOT.
import fs from "node:fs";
import path from "node:path";

const FILES = [
  "src/lib/registry-company-portal-ssot.ts",
  "src/pages/registry/MyCompanies.tsx",
  "src/pages/registry/MyCompanyDetail.tsx",
  "src/pages/registry/MyCompanyEvidence.tsx",
  "src/pages/registry/MyCompanyCorrections.tsx",
  "src/pages/registry/MyCompanyDisputes.tsx",
  "src/pages/registry/MyCompanyRevocations.tsx",
  "supabase/functions/registry-my-companies/index.ts",
];

// Only flag .select("...") strings containing raw bank columns — the
// SSOT helper documents these as forbidden field names, so substring
// matches on prose are intentionally avoided.
const BANNED_SELECT = /\.select\([^)]*\b(account_number|iban|branch_code|swift|bic|account_holder|bank_code)\b/i;
const BANNED_RAW = /\b(provider_payload|raw_provider_result|admin_internal_note)\b/;

let failed = false;
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  if (BANNED_SELECT.test(src)) {
    console.error(`[batch-16] raw bank field selected in ${f}`);
    failed = true;
  }
  // The SSOT file declares the forbidden patterns — exempt from raw scan.
  if (f.endsWith("registry-company-portal-ssot.ts")) continue;
  if (BANNED_RAW.test(src)) {
    console.error(`[batch-16] forbidden raw payload/admin field in ${f}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("[batch-16] portal no-raw-bank guard OK");
