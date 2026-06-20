#!/usr/bin/env node
/**
 * Batch 5 — Pins the state-machine rules of the institutional API:
 *  - the verified-profile API consults isProfileInstitutionallyUsable
 *  - the payment-status API maps bank state via mapBankStateToApiFlag
 *  - both functions consult business_decisions before declaring `usable`
 *  - captured_unverified / pending / failed / expired / revoked / disputed /
 *    provider_unavailable can never produce result_state "usable"
 *    (statically: the only branch that sets `usable` requires paymentFlag
 *    === "verified" AND bd approved AND verified_at + expiry)
 */
import { readFileSync } from "node:fs";

const profile = readFileSync("supabase/functions/registry-institutional-profile-status/index.ts", "utf8");
const payment = readFileSync("supabase/functions/registry-institutional-payment-status/index.ts", "utf8");
const ssotTs = readFileSync("src/lib/registry-institutional-api.ts", "utf8");
const ssotDeno = readFileSync("supabase/functions/_shared/registry-institutional-api.ts", "utf8");

let failed = false;
function must(condition, label) {
  if (!condition) { console.error(`✗ ${label}`); failed = true; }
}

must(profile.includes("isProfileInstitutionallyUsable"), "profile-status must use isProfileInstitutionallyUsable");
must(profile.includes(`from("business_decisions")`), "profile-status must consult business_decisions");
must(profile.includes(`"api_output"`), "profile-status must consult api_output category");

must(payment.includes("mapBankStateToApiFlag"), "payment-status must use mapBankStateToApiFlag");
must(payment.includes(`from("business_decisions")`), "payment-status must consult business_decisions");
must(payment.includes(`paymentFlag === "verified"`), "payment-status verified branch must gate on paymentFlag verified");
must(/verification_method\s*&&\s*[a-zA-Z_]+\.verified_at/.test(payment), "payment-status verified branch must require verification_method AND verified_at");

// mapBankStateToApiFlag must map captured_unverified, verification_pending,
// failed, not_provided, cancelled → not_verified (via the default branch).
for (const ssot of [ssotTs, ssotDeno]) {
  must(/default:\s*\n[\s\S]*?return "not_verified"/.test(ssot), "mapBankStateToApiFlag default branch must return not_verified");
  // Only "verified" maps to verified.
  const verifiedBranch = ssot.match(/case "verified":[\s\S]*?return "verified"/);
  must(!!verifiedBranch, "mapBankStateToApiFlag must map verified → verified");
}

// isProfileInstitutionallyUsable must short-circuit on seed_only + no_coverage.
must(/coverage_state === "seed_only" \|\| input\.coverage_state === "no_coverage"/.test(ssotTs)
  && /coverage_state === "seed_only" \|\| input\.coverage_state === "no_coverage"/.test(ssotDeno),
  "isProfileInstitutionallyUsable must reject seed_only and no_coverage coverage states");

// Claim approval alone / authority approval alone must not satisfy.
must(/business_decision_approved/.test(ssotTs), "SSOT must require business_decision_approved");
must(/profile_verified/.test(ssotTs) && /authority_approved/.test(ssotTs), "SSOT must require both profile_verified and authority_approved");

if (failed) process.exit(1);
console.log("✓ registry-api state-rule guard OK");
