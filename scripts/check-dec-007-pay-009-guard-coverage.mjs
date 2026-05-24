#!/usr/bin/env node
// DEC-007 / PAY-009 — billing-hold guard coverage.
// 1. Shared module exists.
// 2. token-purchase init wires assertNoBillingHold.
// 3. atomic_token_burn DB function contains BILLING_HOLD_ACTIVE guard.
// 4. Admin endpoints import assertAal2.
// 5. Admin disclaimer copy present in the panel.
import fs from "node:fs";
import path from "node:path";

let failed = false;
function fail(m){ console.error(`[check-dec-007-pay-009-guard-coverage] ${m}`); failed = true; }

if (!fs.existsSync("supabase/functions/_shared/billing-hold-guard.ts"))
  fail("missing supabase/functions/_shared/billing-hold-guard.ts");

const tp = fs.readFileSync("supabase/functions/token-purchase/index.ts", "utf8");
if (!tp.includes("assertNoBillingHold") || !tp.includes("BILLING_HOLD_ACTIVE"))
  fail("token-purchase/index.ts does not wire assertNoBillingHold / BILLING_HOLD_ACTIVE");

const migs = fs.readdirSync("supabase/migrations").filter(f => f.endsWith(".sql"));
const burnHasGuard = migs.some(f => {
  const s = fs.readFileSync(path.join("supabase/migrations", f), "utf8");
  return s.includes("atomic_token_burn") && s.includes("BILLING_HOLD_ACTIVE");
});
if (!burnHasGuard) fail("no migration installs BILLING_HOLD_ACTIVE inside atomic_token_burn");

const ADMIN_FNS = [
  "admin-refund-approve","admin-refund-decline",
  "admin-payment-dispute-record","admin-payment-dispute-resolve-won",
  "admin-payment-dispute-resolve-lost",
  "admin-billing-hold-apply","admin-billing-hold-release",
];
for (const fn of ADMIN_FNS) {
  const p = `supabase/functions/${fn}/index.ts`;
  if (!fs.existsSync(p)) { fail(`missing ${p}`); continue; }
  const s = fs.readFileSync(p, "utf8");
  if (!s.includes("assertAal2")) fail(`${fn} does not import assertAal2`);
  if (!s.includes("NOT_PLATFORM_ADMIN")) fail(`${fn} missing NOT_PLATFORM_ADMIN`);
  if (!s.includes("REASON_REQUIRED")) fail(`${fn} missing REASON_REQUIRED`);
}

const panel = "src/components/admin/AdminBillingReviewPanel.tsx";
if (!fs.existsSync(panel)) fail(`missing ${panel}`);
else {
  const s = fs.readFileSync(panel, "utf8");
  if (!s.includes("DEC_007_PAY_009_ADMIN_DISCLAIMER"))
    fail("AdminBillingReviewPanel missing canonical disclaimer import");
}

if (failed) process.exit(1);
console.log("[check-dec-007-pay-009-guard-coverage] ok");
