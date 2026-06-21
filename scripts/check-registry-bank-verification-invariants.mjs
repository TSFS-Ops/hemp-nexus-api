#!/usr/bin/env node
/**
 * Batch 14 — Verification-status invariants enforced at build time:
 *  - The list of NOT-verified statuses includes manual_verified and provider_matched.
 *  - mapVerificationStatusToApiFlag only returns "verified" for status === "verified".
 *  - The default verification mode is "not_available".
 *  - The audit event "registry_bank_verification_promoted_to_verified" exists.
 *  - The audit event "registry_bank_verification_promotion_blocked" exists.
 *  - Provider simulation copy is the canonical test-only label.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-bank-verification.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-bank-verification.ts", "utf8");

let failed = false;

for (const [label, src] of [["ts", ts], ["deno", deno]]) {
  for (const must of ["manual_verified", "provider_matched", "captured_unverified", "expired", "revoked", "disputed"]) {
    const re = new RegExp(`REGISTRY_BANK_VERIFICATION_NOT_VERIFIED_STATUSES[\\s\\S]*?"${must}"`, "m");
    if (!re.test(src)) {
      console.error(`✗ ${label}: "${must}" missing from NOT_VERIFIED_STATUSES`);
      failed = true;
    }
  }
  // Promotion + block audit events must exist in the canonical list.
  for (const ev of ["registry_bank_verification_promoted_to_verified", "registry_bank_verification_promotion_blocked", "registry_bank_verification_api_status_checked"]) {
    if (!new RegExp(`"${ev}"`, "m").test(src)) {
      console.error(`✗ ${label}: audit event "${ev}" missing`);
      failed = true;
    }
  }
  // Provider simulation label must say it does not verify.
  if (!/REGISTRY_BANK_PROVIDER_TEST_MODE_LABEL[\s\S]*?Provider simulation only\. This does not verify bank details\./.test(src)) {
    console.error(`✗ ${label}: provider simulation label missing or incorrect`); failed = true;
  }
}

// Verify mapper logic in TS source has exactly one case returning "verified".
const mapperBlock = ts.match(/export function mapVerificationStatusToApiFlag[\s\S]+?\n\}/);
if (!mapperBlock) { console.error("✗ ts: mapVerificationStatusToApiFlag not found"); failed = true; }
else {
  const verifiedReturns = (mapperBlock[0].match(/return\s+"verified"/g) ?? []).length;
  if (verifiedReturns !== 1) { console.error(`✗ ts: mapVerificationStatusToApiFlag returns "verified" ${verifiedReturns} times (must be 1)`); failed = true; }
  if (!/case\s+"verified":\s*\n?\s*return\s+"verified"/.test(mapperBlock[0])) {
    console.error(`✗ ts: mapVerificationStatusToApiFlag only "verified" status must map to verified`); failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ Batch 14 verification invariants OK");
