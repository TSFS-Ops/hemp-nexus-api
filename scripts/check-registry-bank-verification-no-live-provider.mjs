#!/usr/bin/env node
/**
 * Batch 14 — No live provider call paths and no raw bank exposure in any of
 * the seven Batch 14 verification edge functions.
 */
import { readFileSync, readdirSync } from "node:fs";

const FORBIDDEN_LIVE_TOKENS = [
  // Known stub/external bank-verification providers we must NOT call live.
  "cipc.gov", "onfido.com", "globaldatabase", "b2bhint",
  "refinitiv", "yodlee", "plaid", "tink", "trulioo",
  "payfast.co", "stitchmoney", "ozow.com",
  // Direct production endpoint hints
  "/api/verify/production", "/v1/bank-account-verify",
];
const FORBIDDEN_RAW_BANK_FIELDS = [
  "enc_account_number", "enc_iban", "enc_account_holder",
  "raw_account_number", "raw_iban",
];

const fnDir = "supabase/functions";
const targets = readdirSync(fnDir)
  .filter((d) => d.startsWith("registry-bank-verification-"))
  .map((d) => `${fnDir}/${d}/index.ts`);
targets.push("supabase/functions/_shared/registry-bank-verification.ts");
targets.push("src/lib/registry-bank-verification.ts");

let failed = false;
for (const f of targets) {
  const src = readFileSync(f, "utf8");
  const lower = src.toLowerCase();
  for (const tok of FORBIDDEN_LIVE_TOKENS) {
    if (lower.includes(tok)) {
      console.error(`✗ ${f} contains forbidden live-provider token "${tok}"`);
      failed = true;
    }
  }
  for (const tok of FORBIDDEN_RAW_BANK_FIELDS) {
    if (new RegExp(`\\b${tok}\\b`).test(src)) {
      console.error(`✗ ${f} references raw bank field "${tok}"`);
      failed = true;
    }
  }
  // No real fetch to external HTTPS endpoints from B14 functions.
  if (/registry-bank-verification-/.test(f)) {
    const fetchCalls = src.match(/fetch\s*\(\s*["'`]https?:\/\/[^"'`]+/g) ?? [];
    for (const call of fetchCalls) {
      // Allow only the project's own supabase URL (env-derived). Hardcoded https URLs are forbidden.
      console.error(`✗ ${f} contains hard-coded external fetch: ${call}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`✓ Batch 14 no-live-provider + no-raw-bank guard OK (${targets.length} files)`);
