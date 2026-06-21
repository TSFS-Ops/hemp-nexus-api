#!/usr/bin/env node
// Batch 17 guard — operations UI and edge functions must not display raw bank
// fields, full API keys or provider payloads.
import fs from "node:fs";
import path from "node:path";

const FILES = [
  "src/lib/registry-operations-centre-ssot.ts",
  "src/pages/admin/registry/operations/Centre.tsx",
  "src/pages/admin/registry/operations/Queue.tsx",
  "src/pages/admin/registry/operations/Risk.tsx",
  "src/pages/admin/registry/operations/Slas.tsx",
  "src/pages/admin/registry/operations/Readiness.tsx",
  "src/pages/admin/registry/operations/Audit.tsx",
  "supabase/functions/registry-operations-summary/index.ts",
  "supabase/functions/registry-operations-queue/index.ts",
  "supabase/functions/registry-operations-risk/index.ts",
  "supabase/functions/registry-operations-slas/index.ts",
  "supabase/functions/registry-operations-readiness/index.ts",
  "supabase/functions/registry-operations-audit/index.ts",
];

// Banned `.select(...)` columns — substring matches on prose are intentionally avoided.
const BANNED_SELECT = /\.select\([^)]*\b(account_number|iban|branch_code|swift|bic|account_holder|bank_code)\b/i;
const BANNED_RAW = /\b(provider_payload|raw_provider_result|raw_provider_payload|full_api_key|api_key_secret|secret_key)\b/;

let failed = false;
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  if (BANNED_SELECT.test(src)) {
    console.error(`[batch-17] raw bank field selected in ${f}`);
    failed = true;
  }
  // SSOT file declares the forbidden patterns — exempt.
  if (f.endsWith("registry-operations-centre-ssot.ts")) continue;
  // Audit edge function whitelists keys to strip — exempt the keys list, scan the rest.
  if (f.endsWith("registry-operations-audit/index.ts")) {
    const withoutWhitelist = src.replace(/FORBIDDEN_PAYLOAD_KEYS[\s\S]*?\]\);/, "");
    if (BANNED_RAW.test(withoutWhitelist)) {
      console.error(`[batch-17] forbidden raw payload field in ${f}`);
      failed = true;
    }
    continue;
  }
  if (BANNED_RAW.test(src)) {
    console.error(`[batch-17] forbidden raw payload/key field in ${f}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("[batch-17] operations no-raw-bank guard OK");
